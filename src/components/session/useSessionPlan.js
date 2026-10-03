// The session's plan, shared by the Plan screen and the floating "Cooking now" card: the recipes
// (scaled), what is done, what is under way on a timer, the deadlines, and the plan from now.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { planSession, writtenMs } from '../../lib/planner.js'
import { flattenSteps } from '../../lib/links.js'
import { scaleRecipe } from '../../lib/recipeCalc.js'
import { setStepsDone } from '../../lib/session.js'
import { remaining, useTimers } from '../../lib/timers.js'

export const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()
// A time of day, with the weekday when it is not today.
export const when = (ms, now) => (sameDay(ms, now) ? clock(ms) : `${new Date(ms).toLocaleDateString([], { weekday: 'short' })} ${clock(ms)}`)

// A colour per recipe, the same in light and dark templates.
export const LANES = ['24 75% 52%', '212 70% 55%', '158 55% 42%', '276 52% 58%', '332 62% 55%', '43 80% 46%']

// The step a timer belongs to: "<recipe>:step:3[:ms]" → "3", "<recipe>:<sub>:step:3[:ms]" → "<sub>:3".
export function stepKeyOfTimer(rid, key) {
  const k = String(key || '')
  if (!k.startsWith(`${rid}:`)) return null
  const m = /^(?:(.+?):)?step:(\d+)(?::\d+)?$/.exec(k.slice(rid.length + 1))
  return m ? (m[1] ? `${m[1]}:${m[2]}` : m[2]) : null
}

const HOURS = 'qdplus_hours'
export const lastHours = () => { try { return JSON.parse(localStorage.getItem(HOURS) || 'null') } catch (_) { return null } }
export const rememberHours = (h) => { try { localStorage.setItem(HOURS, JSON.stringify(h)) } catch (_) { /* storage unavailable */ } }

// The floating "Cooking now" card can be closed; the Plan shows it again.
const FLOAT_HIDDEN = 'qdplus_float_hidden'
let floatHidden = (() => { try { return localStorage.getItem(FLOAT_HIDDEN) === '1' } catch (_) { return false } })()
const floatSubs = new Set()
export function setFloatHidden(v) {
  floatHidden = !!v
  try { localStorage.setItem(FLOAT_HIDDEN, v ? '1' : '0') } catch (_) { /* storage unavailable */ }
  floatSubs.forEach((f) => f())
}
export const useFloatHidden = () => useSyncExternalStore((f) => { floatSubs.add(f); return () => floatSubs.delete(f) }, () => floatHidden)

const APPLIED = 'qdplus_timer_done' // timers whose end already ticked their step off
const readApplied = () => { try { return new Set(JSON.parse(localStorage.getItem(APPLIED) || '[]')) } catch (_) { return new Set() } }
const keepApplied = (set) => { try { localStorage.setItem(APPLIED, JSON.stringify([...set].slice(-200))) } catch (_) { /* storage unavailable */ } }

export function useSessionPlan({ session, recipesById, library, change }) {
  const entries = (session?.recipes || []).map((e) => ({ raw: recipesById.get(e.id), factor: Number(e.factor) || 1 })).filter((e) => e.raw && !e.raw._lite)
  const sig = entries.map((e) => `${e.raw.id}:${e.raw.updated_at}:${e.factor}`).join(',')
  const scaled = useMemo(() => entries.map((e) => ({ recipe: e.factor !== 1 ? scaleRecipe(e.raw, e.factor) : e.raw, factor: e.factor })), [sig])
  const steps = useMemo(() => Object.fromEntries(scaled.map(({ recipe }) => [recipe.id, flattenSteps(recipe, library)])), [scaled, library])
  const doneSig = JSON.stringify(entries.map((e) => session?.progress?.[e.raw.id]?.steps || []))
  const done = useMemo(() => Object.fromEntries(entries.map((e) => [e.raw.id, new Set(session?.progress?.[e.raw.id]?.steps || [])])), [doneSig])
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id) }, [])
  const { timers, now: tnow } = useTimers()

  // Steps under way: a timer was started on them. To the minute, so the plan is not redone every second.
  const startedSig = JSON.stringify(entries.map((e) => {
    const rid = e.raw.id
    const mine = timers.filter((t) => t.state !== 'idle' && stepKeyOfTimer(rid, t.key) != null)
    if (!mine.length) return [rid, null]
    const left = Math.max(...mine.map((t) => (t.state === 'running' ? remaining(t, tnow) : t.state === 'paused' ? t.left || 0 : 0)))
    return [rid, { keys: [...new Set(mine.map((t) => stepKeyOfTimer(rid, t.key)))], until: Math.ceil(left / 60000) * 60000 }]
  }))
  const started = useMemo(() => Object.fromEntries(JSON.parse(startedSig).filter(([, v]) => v).map(([rid, v]) => [rid, { keys: new Set(v.keys), until: v.until }])), [startedSig])

  const dueSig = JSON.stringify(session?.plan || {})
  const due = useMemo(() => Object.fromEntries(entries.map((e) => {
    const iso = session?.plan?.recipes?.[e.raw.id]?.ready_by || session?.plan?.ready_by
    return [e.raw.id, iso ? Date.parse(iso) - now : null]
  })), [dueSig, now, sig])
  // Your shift and sleep times: the session's, or the last ones you set on this device.
  const hours = session?.plan?.hours ?? lastHours()
  const hoursSig = JSON.stringify(hours || null)
  const plan = useMemo(() => planSession(scaled, library, { done, due, started, hours, nowAt: now }), [scaled, library, done, due, started, hoursSig, now])

  // When a step's timer runs out, the step is done (once — "Not done" afterwards is respected).
  // Only a timer as long as what the step says: a 30-minute fold timer does not end a 3-hour rise.
  useEffect(() => {
    if (!change) return
    const applied = readApplied()
    let grew = false
    for (const t of timers) {
      if (t.state !== 'done' || applied.has(t.id)) continue
      for (const e of entries) {
        const k = stepKeyOfTimer(e.raw.id, t.key)
        if (k == null) continue
        const s = (steps[e.raw.id] || []).find((x) => String(x.key) === k)
        if (!s) continue
        applied.add(t.id); grew = true
        const need = writtenMs(s.text)
        if (!done[e.raw.id]?.has(s.key) && (!need || (t.duration || 0) >= need * 0.9)) change(setStepsDone(e.raw.id, [s.key]))
      }
    }
    if (grew) keepApplied(applied)
  }, [timers, steps, done, change])

  return { entries, scaled, steps, done, started, plan, now, timers, tnow, hours }
}
