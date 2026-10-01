import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlarmClock, Check, ChefHat, ChevronDown, ExternalLink, Pause, Play, RotateCcw, Timer as TimerIcon, Undo2 } from 'lucide-react'
import { planSession } from '../../lib/planner.js'
import { flattenSteps } from '../../lib/links.js'
import { findDurations } from '../../lib/durations.js'
import { parseSections, scaleRecipe } from '../../lib/recipeCalc.js'
import { computeStepUses } from '../../lib/stepIngredients.js'
import { cachedPlan } from '../../lib/cookPlan.js'
import { clockElapsed, clockRunning, fmtSpan, fmtWatch, startWatch, stopWatch, useStepStats, useWatches, watchElapsed, watchFor } from '../../lib/timing.js'
import { clockPause, clockReset, clockResume, clockStart, setReadyBy, toggleProgress } from '../../lib/session.js'
import { fmtClock, remaining, startTimer, useTimers } from '../../lib/timers.js'

// A colour per recipe, the same in light and dark templates.
const LANES = ['24 75% 52%', '212 70% 55%', '158 55% 42%', '276 52% 58%', '332 62% 55%', '43 80% 46%']
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()
const when = (ms, now) => (sameDay(ms, now) ? clock(ms) : `${new Date(ms).toLocaleDateString([], { weekday: 'short' })} ${clock(ms)}`)
// <input type="datetime-local"> speaks local time without a zone.
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null)

// The session's control center: every recipe's tasks side by side, planned from now with the times
// learned from your cooking — what to do now, what comes next, when each recipe will be ready (and
// whether that meets the time you want it), and each task opening up to its ingredients and timers.
export default function ControlCenter({ session, recipesById, library, change, onOpenRecipe, onChefAt }) {
  const entries = (session?.recipes || []).map((e) => ({ raw: recipesById.get(e.id), factor: Number(e.factor) || 1 })).filter((e) => e.raw)
  const scaled = useMemo(() => entries.map((e) => ({ recipe: e.factor !== 1 ? scaleRecipe(e.raw, e.factor) : e.raw, factor: e.factor })),
    [entries.map((e) => `${e.raw.id}:${e.raw.updated_at}:${e.factor}`).join(',')])
  const doneSig = JSON.stringify(entries.map((e) => session?.progress?.[e.raw.id]?.steps || []))
  const done = useMemo(() => Object.fromEntries(entries.map((e) => [e.raw.id, new Set(session?.progress?.[e.raw.id]?.steps || [])])), [doneSig])
  const stats = useStepStats(entries.map((e) => e.raw.id).concat(library.map((r) => r.id)).slice(0, 400))
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id) }, [])
  const dueSig = JSON.stringify(session?.plan || {})
  const due = useMemo(() => Object.fromEntries(entries.map((e) => {
    const iso = session?.plan?.recipes?.[e.raw.id]?.ready_by || session?.plan?.ready_by
    return [e.raw.id, iso ? Date.parse(iso) - now : null]
  })), [dueSig, now, entries.length])
  const plan = useMemo(() => planSession(scaled, library, stats, { done, due }), [scaled, stats, done, library, due])
  const [open, setOpen] = useState(null) // `${recipe id}|${step key}` of the task shown open
  const [showTimeline, setShowTimeline] = useState(false)
  const { timers, now: tnow } = useTimers()

  const readyAll = session?.plan?.ready_by || null
  const allDone = now + plan.total
  const doNow = plan.items.filter((it) => it.start <= 60000)
  const waitingNow = timers.filter((t) => (t.state === 'running' || t.ringing) && entries.some((e) => t.recipeId === e.raw.id))
  const totalSteps = entries.reduce((n, e, i) => n + flattenSteps(scaled[i].recipe, library).length, 0)
  const doneSteps = entries.reduce((n, e) => n + (done[e.raw.id]?.size || 0), 0)

  // Deadlines: when a recipe will be ready by this plan, against when it should be.
  const status = (rid) => {
    const due = session?.plan?.recipes?.[rid]?.ready_by || readyAll
    const end = now + (plan.ends[rid] || 0)
    if (!due) return { end }
    const slack = Date.parse(due) - end
    const startBy = Date.parse(due) - (plan.alone[rid] || 0)
    return { end, due: Date.parse(due), slack, startBy, late: slack < 0 }
  }
  const tips = useMemo(() => {
    const out = []
    entries.forEach((e) => {
      const s = status(e.raw.id)
      if (!s.due || !plan.alone[e.raw.id]) return
      const started = done[e.raw.id]?.size > 0
      if (s.startBy < now) out.push({ kind: 'late', text: `${e.raw.title} still needs ${fmtSpan(plan.alone[e.raw.id])} even on its own — it can’t be ready before ${when(now + plan.alone[e.raw.id], now)}. Start it now, or move its time.` })
      else if (s.late) out.push({ kind: 'late', text: `${e.raw.title} would be ready at ${when(s.end, now)}, ${fmtSpan(-s.slack)} after ${when(s.due, now)}: the other recipes need you at the same time. Move one of the times, or get a hand.` })
      else if (s.startBy > now + 5 * 60000) out.push({ kind: 'plan', text: `${e.raw.title}: ${started ? 'pick it up again' : 'start'} by ${when(s.startBy, now)} at the latest to have it ready at ${when(s.due, now)}.` })
    })
    plan.tips.slice(1).forEach((t) => out.push({ kind: 'tip', text: `${when(now + t.at, now)} — ${t.text}` }))
    return out.slice(0, 5)
  }, [plan, now, session?.plan])

  if (!entries.length) {
    return (
      <div className="Q-cc">
        <div className="Q-sess-head"><div><h1>Control center</h1><p>Add recipes to the session to see their tasks here, side by side.</p></div></div>
      </div>
    )
  }
  return (
    <div className="Q-cc">
      <div className="Q-cc-head">
        <div>
          <h1>Control center</h1>
          <p>
            {doneSteps} of {totalSteps} tasks done · {plan.items.length ? <>all done about <b>{when(allDone, now)}</b></> : 'all done'}
            {readyAll && plan.items.length > 0 && <span className={allDone > Date.parse(readyAll) ? 'late' : 'ok'}> · {allDone > Date.parse(readyAll) ? `${fmtSpan(allDone - Date.parse(readyAll))} late` : 'on time'}</span>}
          </p>
        </div>
        <label className="Q-cc-due">
          <span>Everything ready by</span>
          <input type="datetime-local" value={toLocalInput(readyAll)} onChange={(e) => change(setReadyBy(null, fromLocalInput(e.target.value)))} aria-label="Everything ready by" />
        </label>
      </div>

      <SessionClock session={session} change={change} />

      {(doNow.length > 0 || waitingNow.length > 0) && (
        <section className="Q-cc-now" aria-label="Do now">
          {doNow.slice(0, 1).map((it) => (
            <div key={`${it.rid}|${it.key}`} className="Q-cc-nowcard" style={{ '--lane': LANES[it.ri % LANES.length] }}>
              <div className="lbl">Do now</div>
              <div className="what"><span className="rec">{it.title}{it.sub ? ` · ${it.sub}` : ''}</span><span className="txt">{it.text}</span></div>
              <div className="meta">{fmtSpan(it.workEnd - it.start)} hands-on{it.wait ? ` · then ${fmtSpan(it.wait)} waiting` : ''}{it.learned ? ' · your time' : ''}</div>
              <div className="acts">
                {findDurations(it.text).slice(0, 1).map((d) => (
                  <button key={d.ms} className="btn primary sm" onClick={() => startTimer({ key: `${it.tkey}:${d.ms}`, label: it.text.slice(0, 60), name: it.title, duration: d.ms, recipeId: it.rid, recipeTitle: it.title })}><TimerIcon size={14} /> Start {d.label}</button>
                ))}
                <button className="btn ghost sm" onClick={() => change(toggleProgress(it.rid, 'steps', it.key))}><Check size={14} /> Done</button>
                <button className="btn ghost sm" onClick={() => onChefAt(it.rid, it.key, it.text)}><ChefHat size={14} /> Chef mode</button>
              </div>
            </div>
          ))}
          {waitingNow.length > 0 && (
            <div className="Q-cc-waiting" aria-label="Running">
              {waitingNow.map((t) => <span key={t.id} className={t.ringing ? 'ringing' : ''}><TimerIcon size={12} />{t.name || t.label} · {t.ringing ? 'time’s up' : fmtClock(remaining(t, tnow))}</span>)}
            </div>
          )}
        </section>
      )}

      {tips.length > 0 && (
        <ul className="Q-cc-tips">
          {tips.map((t, i) => <li key={i} className={t.kind}>{t.kind === 'late' ? <AlarmClock size={14} /> : null}{t.text}</li>)}
        </ul>
      )}

      <div className="Q-cc-lanes" role="list">
        {entries.map((e, ri) => (
          <Lane
            key={e.raw.id} ri={ri} raw={e.raw} recipe={scaled[ri].recipe} factor={e.factor} library={library} plan={plan} done={done[e.raw.id]}
            status={status(e.raw.id)} now={now} open={open} setOpen={setOpen} change={change} timers={timers} tnow={tnow} session={session}
            onOpenRecipe={onOpenRecipe} onChefAt={onChefAt}
          />
        ))}
      </div>

      <button type="button" className={`Q-cc-tl-toggle${showTimeline ? ' open' : ''}`} onClick={() => setShowTimeline((v) => !v)} aria-expanded={showTimeline}>
        Timeline <ChevronDown size={14} />
      </button>
      {showTimeline && <Timeline entries={entries} plan={plan} now={now} />}
    </div>
  )
}

// One recipe: its deadline, when it will be ready, and its tasks in order.
function Lane({ ri, raw, recipe, factor, library, plan, done, status, now, open, setOpen, change, timers, tnow, session, onOpenRecipe, onChefAt }) {
  const headId = useId()
  const steps = useMemo(() => flattenSteps(recipe, library), [recipe, library])
  const planned = new Map(plan.items.filter((it) => it.rid === raw.id).map((it) => [String(it.key), it]))
  const todo = steps.filter((s) => !done?.has(s.key))
  const finished = steps.filter((s) => done?.has(s.key))
  const [showDone, setShowDone] = useState(false)
  const listRef = useRef(null)
  // Ticking a task off closes it and puts the keyboard on the task that is next.
  const toggleDone = (s, isDone) => {
    change(toggleProgress(raw.id, 'steps', s.key))
    setOpen(null)
    if (!isDone) setTimeout(() => listRef.current?.querySelector('.Q-cc-task-head')?.focus(), 0)
  }
  const due = session?.plan?.recipes?.[raw.id]?.ready_by || null
  // The ingredients each step uses (the same reading as chef mode), worked out when a task opens.
  const openHere = open && open.startsWith(`${raw.id}|`)
  const uses = useMemo(() => {
    if (!openHere) return null
    const chef = steps.map((s) => ({ i: s.key, text: s.text, part: s.part, src: s.src.id, srcTitle: s.src.title }))
    const sources = {}
    steps.forEach((s) => { if (!sources[s.src.id]) sources[s.src.id] = { title: s.src.title, sections: parseSections(s.src.recipe.ingredients || []) } })
    if (!sources[recipe.id]) sources[recipe.id] = { title: '', sections: parseSections(recipe.ingredients || []) }
    const plans = {}
    Object.keys(sources).forEach((id) => { const r = id === raw.id ? raw : library.find((x) => x.id === id); const p = r && cachedPlan(r); if (p) plans[id] = p })
    const per = computeStepUses({ steps: chef, sources, recipeId: recipe.id, plans })
    return new Map(steps.map((s, k) => [String(s.key), per[k]]))
  }, [openHere, steps])

  const card = (s, isDone) => {
    const id = `${raw.id}|${s.key}`
    const it = planned.get(String(s.key))
    const own = typeof s.key === 'number'
    const srcIdx = own ? String(s.key) : String(s.key).split(':').pop()
    const tkey = own ? `${raw.id}:step:${s.key}` : `${raw.id}:${s.src.id}:step:${srcIdx}`
    const t = timers.find((x) => (x.key === tkey || String(x.key || '').startsWith(`${tkey}:`)) && x.state !== 'idle' && x.state !== 'done')
    const isOpen = open === id
    const wkey = `w:${s.src.id}:${srcIdx}`
    return (
      <li key={id} className={`Q-cc-task${isDone ? ' done' : ''}${isOpen ? ' open' : ''}${it && it.start <= 60000 && !isDone ? ' now' : ''}`}>
        <button type="button" className="Q-cc-task-head" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} aria-controls={`${id}-body`}>
          <span className="n" aria-hidden="true">{isDone ? <Check size={13} /> : s.n}</span>
          <span className="txt">{s.src.title ? <em>{s.src.title} · </em> : null}{s.text}</span>
          <span className="when">
            {isDone ? 'done' : t ? <b>{t.ringing ? 'time’s up' : fmtClock(remaining(t, tnow))}</b> : it ? (it.start <= 60000 ? 'now' : when(now + it.start, now)) : ''}
          </span>
        </button>
        {isOpen && (
          <div className="Q-cc-task-body" id={`${id}-body`} role="region" aria-label={`Step ${s.n}`}>
            {it && !isDone && (
              <div className="Q-cc-task-meta">
                {it.start <= 60000 ? 'Now' : `At ${when(now + it.start, now)}`} · {fmtSpan(it.workEnd - it.start)} hands-on{it.wait ? ` + ${fmtSpan(it.wait)} waiting` : ''}{it.learned ? ' · your usual time' : ''}
              </div>
            )}
            <p className="full">{s.text}</p>
            {uses?.get(String(s.key))?.length > 0 && (
              <ul className="Q-cc-ings" aria-label="Ingredients for this step">
                {uses.get(String(s.key)).map((u, k) => (
                  <li key={k} className={u.made ? 'made' : ''}><b>{u.qty || ''}</b><span>{u.made ? '↳ ' : ''}{u.d.name}{u.note && <small>{u.note}</small>}</span></li>
                ))}
              </ul>
            )}
            <div className="Q-cc-task-acts">
              {!isDone && findDurations(s.text).slice(0, 2).map((d) => (
                <button key={d.ms} className="btn primary sm" onClick={() => startTimer({ key: `${tkey}:${d.ms}`, label: s.text.slice(0, 60), name: raw.title, duration: d.ms, recipeId: raw.id, recipeTitle: raw.title })}>
                  <TimerIcon size={14} /> {d.label}
                </button>
              ))}
              <button className="btn ghost sm" onClick={() => toggleDone(s, isDone)}>{isDone ? <><Undo2 size={14} /> Not done</> : <><Check size={14} /> Done</>}</button>
              {!isDone && <WatchButton wkey={wkey} info={{ key: wkey, recipeId: s.src.id, stepKey: srcIdx, stepText: s.text, sessionId: session?.id || null, factor }} />}
              <button className="btn ghost sm" onClick={() => onChefAt(raw.id, s.key, s.text)}><ChefHat size={14} /> Chef mode</button>
              <button className="btn ghost sm" onClick={() => onOpenRecipe(raw.id)}><ExternalLink size={14} /> Recipe</button>
            </div>
          </div>
        )}
      </li>
    )
  }

  return (
    <section className="Q-cc-lane" role="listitem" aria-labelledby={headId} style={{ '--lane': LANES[ri % LANES.length] }}>
      <header className="Q-cc-lane-head">
        <h2 id={headId}>{raw.title}{factor !== 1 && <span className="x">×{+factor.toFixed(2)}</span>}</h2>
        <div className="Q-cc-lane-status">
          {todo.length === 0 ? <span className="ok">Ready</span> : (
            <>
              <span>Ready about <b>{when(status.end, now)}</b></span>
              {status.due && <span className={status.late ? 'late' : 'ok'}>{status.late ? `${fmtSpan(-status.slack)} late` : `${fmtSpan(status.slack)} to spare`}</span>}
            </>
          )}
        </div>
        <div className="Q-cc-bar" aria-hidden="true"><i style={{ width: `${steps.length ? (finished.length / steps.length) * 100 : 0}%` }} /></div>
        <label className="Q-cc-lane-due">
          <span>Ready by</span>
          <input type="datetime-local" value={toLocalInput(due)} onChange={(e) => change(setReadyBy(raw.id, fromLocalInput(e.target.value)))} aria-label={`${raw.title} ready by`} />
        </label>
      </header>
      <ol className="Q-cc-tasks" ref={listRef}>
        {todo.map((s) => card(s, false))}
      </ol>
      {finished.length > 0 && (
        <>
          <button type="button" className="Q-cc-done-toggle" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>{finished.length} done <ChevronDown size={13} /></button>
          {showDone && <ol className="Q-cc-tasks">{finished.map((s) => card(s, true))}</ol>}
        </>
      )}
    </section>
  )
}

function WatchButton({ wkey, info }) {
  const { now } = useWatches()
  const w = watchFor(wkey)
  return w
    ? <button className="btn ghost sm Q-cc-watching" onClick={() => stopWatch(wkey)}><Pause size={13} /> {fmtWatch(watchElapsed(w, now))}</button>
    : <button className="btn ghost sm" onClick={() => startWatch(info)}><Play size={13} /> Time it</button>
}

function SessionClock({ session, change }) {
  const [now, setNow] = useState(Date.now())
  const running = clockRunning(session?.clock)
  useEffect(() => { if (!running) return undefined; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [running])
  const c = session?.clock || {}
  return (
    <div className="Q-plan-clock">
      <TimerIcon size={16} />
      <b>{fmtWatch(clockElapsed(c, now))}</b>
      <span>{!c.start ? 'Session clock' : running ? 'cooking' : c.end ? 'finished' : 'paused'}</span>
      <span className="sp" />
      {!c.start && <button className="btn primary sm" onClick={() => change(clockStart())}><Play size={13} /> Start</button>}
      {running && <button className="btn ghost sm" onClick={() => change(clockPause())}><Pause size={13} /> Pause</button>}
      {c.paused_at && <button className="btn primary sm" onClick={() => change(clockResume())}><Play size={13} /> Resume</button>}
      {c.start && <button className="Q-icon-btn" title="Reset the clock" aria-label="Reset the session clock" onClick={() => { if (window.confirm('Reset the session clock?')) change(clockReset()) }}><RotateCcw size={14} /></button>}
    </div>
  )
}

// Every recipe's remaining tasks on one line of time, from now.
function Timeline({ entries, plan, now }) {
  const scale = plan.total > 0 ? 100 / plan.total : 0
  const hours = Math.ceil(plan.total / 3600000)
  const every = plan.total > 6 * 3600000 ? 2 : 1
  return (
    <div className="Q-plan-gantt">
      <div className="Q-plan-axis">
        {Array.from({ length: Math.floor(hours / every) + 1 }, (_, h) => h * every).map((h) => (
          <span key={h} style={{ left: `${Math.min(100, h * 3600000 * scale)}%` }}>{clock(now + h * 3600000)}</span>
        ))}
      </div>
      {entries.map((e, ri) => (
        <div key={e.raw.id} className="Q-plan-row" style={{ '--lane': LANES[ri % LANES.length] }}>
          <div className="Q-plan-name">{e.raw.title}</div>
          <div className="Q-plan-lane">
            {plan.items.filter((it) => it.ri === ri).map((it, k) => (
              <span key={k} className="Q-plan-step" style={{ left: `${it.start * scale}%`, width: `${Math.max(0.6, (it.end - it.start) * scale)}%` }} title={`${it.text}\n${fmtSpan(it.workEnd - it.start)} hands-on${it.wait ? ` + ${fmtSpan(it.wait)} waiting` : ''}`}>
                <i className="work" style={{ width: `${((it.workEnd - it.start) / Math.max(1, it.end - it.start)) * 100}%` }} />
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
