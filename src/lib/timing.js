// How long the work really takes. Chef mode times each step by itself; any step can also be timed
// by hand with a stopwatch. Every time goes to `step_times` (supabase/migrations/20261001_step_times.sql);
// from them the app learns a step's typical time (the median), shows it, and plans with it.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from './supabase.js'

const MIN_MS = 3000 // a glance at a step is not work
const MAX_MS = 12 * 3600 * 1000
const PENDING = 'qdplus_time_pending' // times not saved yet (offline), sent with the next ones

const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d } catch (_) { return d } }
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (_) { /* storage unavailable */ } }

// ── Recording ────────────────────────────────────────────────────────────────
// { recipeId, stepKey, stepText, sessionId, factor, source, startedAt (ms), endedAt (ms), activeMs }
export async function recordStepTime(t) {
  const ms = Math.round(t.activeMs ?? (t.endedAt - t.startedAt))
  if (!(ms >= MIN_MS) || !t.recipeId) return
  const row = {
    recipe_id: t.recipeId, step_key: String(t.stepKey), step_text: String(t.stepText || '').slice(0, 500),
    session_id: t.sessionId || null, factor: Number(t.factor) || 1, source: t.source || 'chef',
    started_at: new Date(t.startedAt).toISOString(), ended_at: new Date(t.endedAt || Date.now()).toISOString(),
    active_ms: Math.min(ms, MAX_MS),
  }
  const rows = [...readJson(PENDING, []), row]
  const { error } = await supabase.from('step_times').insert(rows)
  writeJson(PENDING, error ? rows.slice(-200) : [])
  if (!error) statsVersion += 1
}

// ── Stopwatches (time a step by hand) ────────────────────────────────────────
// [{ key, recipeId, stepKey, stepText, sessionId, factor, startedAt, pausedMs, pausedAt }]
const WATCHES = 'qdplus_watches'
let watches = readJson(WATCHES, [])
const subs = new Set()
const emit = () => { writeJson(WATCHES, watches); subs.forEach((f) => f()) }
let tick = Date.now()
setInterval(() => { if (watches.length) { tick = Date.now(); subs.forEach((f) => f()) } }, 1000)
const snapshot = () => tick + watches.length
export function useWatches() {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, snapshot)
  return { watches, now: Date.now() }
}
export const watchFor = (key) => watches.find((w) => w.key === key) || null
export const watchElapsed = (w, now = Date.now()) => (w ? (w.pausedAt || now) - w.startedAt - (w.pausedMs || 0) : 0)
export function startWatch(info) {
  if (watchFor(info.key)) return
  watches = [...watches, { ...info, startedAt: Date.now(), pausedMs: 0, pausedAt: null }]
  emit()
}
export function toggleWatchPause(key) {
  watches = watches.map((w) => {
    if (w.key !== key) return w
    if (w.pausedAt) return { ...w, pausedMs: (w.pausedMs || 0) + (Date.now() - w.pausedAt), pausedAt: null }
    return { ...w, pausedAt: Date.now() }
  })
  emit()
}
// Stops it and keeps the time; returns the milliseconds.
export function stopWatch(key) {
  const w = watchFor(key)
  if (!w) return 0
  const ms = watchElapsed(w)
  watches = watches.filter((x) => x.key !== key)
  emit()
  recordStepTime({ ...w, source: 'manual', endedAt: Date.now(), activeMs: ms })
  return ms
}
export function cancelWatch(key) { watches = watches.filter((x) => x.key !== key); emit() }

// ── Learning ─────────────────────────────────────────────────────────────────
// Off for now (2026-10-01): the times you took are still recorded, but nothing shows or plans with
// them until this is developed further — the plan works from what the steps say.
const USE_LEARNED = false
let statsVersion = 0
const textKey = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, ' ').trim()
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

// The times of these recipes, summed up: by recipe and step, and by what a step says (so a step
// written the same way in another recipe has a guess too).
export async function loadStepStats(recipeIds) {
  const ids = [...new Set(recipeIds.filter(Boolean))]
  if (!ids.length) return { byKey: {}, byText: {} }
  const { data, error } = await supabase.from('step_times').select('recipe_id, step_key, step_text, active_ms').in('recipe_id', ids).limit(5000)
  if (error) throw error
  const k = {}, t = {}
  for (const r of data || []) {
    ;(k[`${r.recipe_id}|${r.step_key}`] ||= { ms: [], text: r.step_text }).ms.push(r.active_ms)
    const tk = textKey(r.step_text)
    if (tk) (t[tk] ||= []).push(r.active_ms)
  }
  const byKey = Object.fromEntries(Object.entries(k).map(([key, v]) => [key, { ms: median(v.ms), n: v.ms.length, text: v.text }]))
  const byText = Object.fromEntries(Object.entries(t).map(([key, v]) => [key, { ms: median(v), n: v.length }]))
  return { byKey, byText }
}
export function useStepStats(recipeIds, enabled = true) {
  const sig = [...new Set(recipeIds.filter(Boolean))].sort().join(',')
  const [stats, setStats] = useState({ byKey: {}, byText: {} })
  const [v, setV] = useState(statsVersion)
  useEffect(() => { const id = setInterval(() => { if (v !== statsVersion) setV(statsVersion) }, 2000); return () => clearInterval(id) }, [v])
  useEffect(() => {
    if (!USE_LEARNED || !enabled || !sig) return undefined
    let live = true
    loadStepStats(sig.split(',')).then((s) => { if (live) setStats(s) }).catch(() => { /* works without */ })
    return () => { live = false }
  }, [sig, enabled, v])
  return stats
}
// A step's typical time: its own (when the step still says the same), else the same words elsewhere.
export function typicalMs(stats, recipeId, stepKey, stepText) {
  const own = stats?.byKey?.[`${recipeId}|${stepKey}`]
  if (own && (!own.text || textKey(own.text) === textKey(stepText))) return own.ms
  return stats?.byText?.[textKey(stepText)]?.ms ?? null
}
export function fmtSpan(ms) {
  if (ms == null || !(ms >= 0)) return ''
  const m = Math.round(ms / 60000)
  if (m < 1) return `${Math.round(ms / 1000)} s`
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}
export function fmtWatch(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}

// ── The session's clock ──────────────────────────────────────────────────────
// clock: { start, end, paused_ms, paused_at } — ISO times, milliseconds.
export function clockElapsed(c, now = Date.now()) {
  if (!c?.start) return 0
  const start = Date.parse(c.start)
  const stop = c.end ? Date.parse(c.end) : c.paused_at ? Date.parse(c.paused_at) : now
  return Math.max(0, stop - start - (c.paused_ms || 0))
}
export const clockRunning = (c) => !!c?.start && !c.end && !c.paused_at
