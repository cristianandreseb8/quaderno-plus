import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlarmClock, Check, ChefHat, ChevronDown, ExternalLink, GanttChart, Pause, Play, RotateCcw, SkipForward, Timer as TimerIcon, Undo2 } from 'lucide-react'
import { findDurations } from '../../lib/durations.js'
import { parseSections } from '../../lib/recipeCalc.js'
import { computeStepUses } from '../../lib/stepIngredients.js'
import { cachedPlan } from '../../lib/cookPlan.js'
import { clockElapsed, clockRunning, fmtSpan, fmtWatch, startWatch, stopWatch, useWatches, watchElapsed, watchFor } from '../../lib/timing.js'
import { clockPause, clockReset, clockResume, clockStart, setPlanHours, setReadyBy, setSteps, setStepsDone, toggleProgress } from '../../lib/session.js'
import { fmtClock, remaining, startTimer } from '../../lib/timers.js'
import { toast } from '../ui/Toaster.jsx'
import { qtyCol } from '../../lib/qtyCol.js'
import { LANES, rememberHours, setFloatHidden, stepKeyOfTimer, useFloatHidden, useSessionPlan, when } from './useSessionPlan.js'
import Timeline from './Timeline.jsx'
import HoursBar from './HoursBar.jsx'

// <input type="datetime-local"> speaks local time without a zone.
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null)

// The session's plan: every recipe's tasks side by side, planned from now with the times the steps
// give — what to do now, what comes next, when each recipe will be ready (and whether that meets
// the time you want it), and each task opening up to its ingredients and timers. A step that
// leaves you waiting (resting, fermenting, baking) lets the plan go straight on with another recipe.
export default function ControlCenter({ session, recipesById, library, change, onOpenRecipe, onChefAt }) {
  const { entries, scaled, steps, done, started, plan, now, timers, tnow, hours } = useSessionPlan({ session, recipesById, library, change })
  const [open, setOpen] = useState(null) // `${recipe id}|${step key}` of the task shown open
  const floatHidden = useFloatHidden()
  // The timeline shows from the start; hiding it is remembered.
  const [showTimeline, setShowTimelineState] = useState(() => { try { return localStorage.getItem('qdplus_tl_hidden') !== '1' } catch (_) { return true } })
  const setShowTimeline = (v) => { setShowTimelineState(v); try { localStorage.setItem('qdplus_tl_hidden', v ? '0' : '1') } catch (_) { /* ignore */ } }
  // A step picked on the timeline opens its task below.
  const pick = (rid, key) => {
    const id = `${rid}|${key}`
    setOpen(id)
    setTimeout(() => document.getElementById(`task-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }), 30)
  }
  const saveHours = (h) => { change(setPlanHours(h)); rememberHours(h) }

  const readyAll = session?.plan?.ready_by || null
  const allDone = now + plan.total
  const first = plan.items[0]
  const waitingNow = timers.filter((t) => (t.state === 'running' || t.ringing) && entries.some((e) => t.recipeId === e.raw.id))
  const totalSteps = entries.reduce((n, e) => n + (steps[e.raw.id]?.length || 0), 0)
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
      const going = done[e.raw.id]?.size > 0 || !!started[e.raw.id]
      if (s.startBy < now) out.push({ kind: 'late', text: `${e.raw.title} still needs ${fmtSpan(plan.alone[e.raw.id])} even on its own — it can’t be ready before ${when(now + plan.alone[e.raw.id], now)}. Start it now, start it from a later step, or move its time.` })
      else if (s.late) out.push({ kind: 'late', text: `${e.raw.title} would be ready at ${when(s.end, now)}, ${fmtSpan(-s.slack)} after ${when(s.due, now)}: the other recipes need you at the same time. Move one of the times, or get a hand.` })
      else if (s.startBy > now + 5 * 60000) out.push({ kind: 'plan', text: `${e.raw.title}: ${going ? 'pick it up again' : 'start'} by ${when(s.startBy, now)} at the latest to have it ready at ${when(s.due, now)}.` })
    })
    plan.tips.filter((t) => t.kind !== 'start').forEach((t) => out.push({ kind: t.kind || 'tip', text: `${when(now + t.at, now)} — ${t.text}` }))
    return out.slice(0, 6)
  }, [plan, now, session?.plan])

  if (!entries.length) {
    return (
      <div className="Q-cc">
        <div className="Q-sess-head"><div><h1>Plan</h1><p>Add recipes to the session to see their tasks here, side by side.</p></div></div>
      </div>
    )
  }
  return (
    <div className="Q-cc">
      <div className="Q-cc-head">
        <div>
          <h1>Plan</h1>
          <p>
            {doneSteps} of {totalSteps} tasks done · {plan.total > 0 ? <>all done about <b>{when(allDone, now)}</b></> : 'all done'}
            {readyAll && plan.total > 0 && <span className={allDone > Date.parse(readyAll) ? 'late' : 'ok'}> · {allDone > Date.parse(readyAll) ? `${fmtSpan(allDone - Date.parse(readyAll))} late` : 'on time'}</span>}
          </p>
          {floatHidden && <button type="button" className="Q-link Q-cc-float-on" onClick={() => setFloatHidden(false)}>Show “Cooking now” while you cook</button>}
        </div>
        <label className="Q-cc-due">
          <span>Everything ready by</span>
          <input type="datetime-local" value={toLocalInput(readyAll)} onChange={(e) => change(setReadyBy(null, fromLocalInput(e.target.value)))} aria-label="Everything ready by" />
        </label>
      </div>

      <HoursBar hours={hours} onSave={saveHours} />
      {showTimeline
        ? <Timeline entries={entries} plan={plan} now={now} onPick={pick} onHide={() => setShowTimeline(false)} />
        : <button type="button" className="Q-cc-tl-show" onClick={() => setShowTimeline(true)}><GanttChart size={15} /> Show the timeline</button>}

      <SessionClock session={session} change={change} />

      {(first || waitingNow.length > 0) && (
        <section className="Q-cc-now" aria-label="Do now">
          {first && (
            <div key={`${first.rid}|${first.key}`} className={`Q-cc-nowcard${first.start > 60000 ? ' later' : ''}`} style={{ '--lane': LANES[first.ri % LANES.length] }}>
              <div className="lbl">{first.start <= 60000 ? 'Do now' : `Nothing to do until ${when(now + first.start, now)} — then`}</div>
              <div className="what"><span className="rec">{first.title}{first.sub ? ` · ${first.sub}` : ''}</span><span className="txt">{first.text}</span></div>
              <div className="meta">{fmtSpan(first.workEnd - first.start)} hands-on{first.wait ? ` · then ${fmtSpan(first.wait)} waiting — the plan goes on with the other recipes` : ''}</div>
              <div className="acts">
                {findDurations(first.text).slice(0, 1).map((d) => (
                  <button key={d.ms} className="btn primary sm" onClick={() => startTimer({ key: `${first.tkey}:${d.ms}`, label: first.text.slice(0, 60), name: first.title, duration: d.ms, recipeId: first.rid, recipeTitle: first.title })}><TimerIcon size={14} /> Start {d.label}</button>
                ))}
                <button className="btn ghost sm" onClick={() => change(setStepsDone(first.rid, [first.key]))}><Check size={14} /> Done</button>
                <button className="btn ghost sm" onClick={() => onChefAt(first.rid, first.key, first.text)}><ChefHat size={14} /> Chef mode</button>
              </div>
            </div>
          )}
          {waitingNow.length > 0 && (
            <div className="Q-cc-waiting" aria-label="Running">
              {waitingNow.map((t) => <span key={t.id} className={t.ringing ? 'ringing' : ''}><TimerIcon size={12} />{t.name || t.label} · {t.ringing ? 'time’s up' : fmtClock(remaining(t, tnow))}</span>)}
            </div>
          )}
        </section>
      )}

      {tips.length > 0 && (
        <ul className="Q-cc-tips">
          {tips.map((t, i) => <li key={i} className={t.kind}>{t.kind === 'late' || t.kind === 'warn' ? <AlarmClock size={14} /> : null}{t.text}</li>)}
        </ul>
      )}

      <div className="Q-cc-lanes" role="list">
        {entries.map((e, ri) => (
          <Lane
            key={e.raw.id} ri={ri} raw={e.raw} recipe={scaled[ri].recipe} factor={e.factor} library={library} plan={plan} done={done[e.raw.id]}
            steps={steps[e.raw.id] || []} status={status(e.raw.id)} now={now} open={open} setOpen={setOpen} change={change} timers={timers} tnow={tnow}
            session={session} onOpenRecipe={onOpenRecipe} onChefAt={onChefAt}
          />
        ))}
      </div>

    </div>
  )
}

// One recipe: its deadline, when it will be ready, and its tasks in order.
function Lane({ ri, raw, recipe, factor, library, plan, done, steps, status, now, open, setOpen, change, timers, tnow, session, onOpenRecipe, onChefAt }) {
  const headId = useId()
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
  // Start the recipe at this step: everything before it counts as done (the refreshes made days
  // ago, a dough already in the fridge).
  const startHere = (s) => {
    const before = steps.slice(0, steps.findIndex((x) => x.key === s.key)).filter((x) => !done?.has(x.key)).map((x) => x.key)
    if (!before.length) return
    const prev = [...(done || [])]
    change(setStepsDone(raw.id, before))
    toast(`${raw.title} starts at step ${s.n}`, { action: { label: 'Undo', onClick: () => change(setSteps(raw.id, prev)) } })
  }
  const startOver = () => {
    const prev = [...(done || [])]
    change(setSteps(raw.id, []))
    toast(`${raw.title}: every step to do again`, { action: { label: 'Undo', onClick: () => change(setSteps(raw.id, prev)) } })
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
    const t = timers.find((x) => x.state !== 'idle' && stepKeyOfTimer(raw.id, x.key) === String(s.key))
    const waiting = !isDone && t && (t.state === 'running' || t.state === 'paused')
    const isOpen = open === id
    const wkey = `w:${s.src.id}:${srcIdx}`
    const k = steps.findIndex((x) => x.key === s.key)
    const canStartHere = !isDone && steps.slice(0, k).some((x) => !done?.has(x.key))
    return (
      <li key={id} className={`Q-cc-task${isDone ? ' done' : ''}${isOpen ? ' open' : ''}${waiting ? ' waiting' : ''}${it && it.start <= 60000 && !isDone ? ' now' : ''}`}>
        <button type="button" id={`task-${id}`} className="Q-cc-task-head" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} aria-controls={`${id}-body`}>
          <span className="n" aria-hidden="true">{isDone ? <Check size={13} /> : s.n}</span>
          <span className="txt">{s.src.title ? <em>{s.src.title} · </em> : null}{s.text}</span>
          <span className="when">
            {isDone ? 'done' : t ? <b>{t.ringing || t.state === 'done' ? 'time’s up' : fmtClock(remaining(t, tnow))}</b> : it ? (it.start <= 60000 ? 'now' : when(now + it.start, now)) : ''}
          </span>
        </button>
        {isOpen && (
          <div className="Q-cc-task-body" id={`${id}-body`} role="region" aria-label={`Step ${s.n}`}>
            {waiting && <div className="Q-cc-task-meta">Under way — the plan goes on with the other recipes until the timer ends.</div>}
            {it && !isDone && !waiting && (
              <div className="Q-cc-task-meta">
                {it.start <= 60000 ? 'Now' : `At ${when(now + it.start, now)}`} · {fmtSpan(it.workEnd - it.start)} hands-on{it.wait ? ` + ${fmtSpan(it.wait)} waiting` : ''}
              </div>
            )}
            <p className="full">{s.text}</p>
            {uses?.get(String(s.key))?.length > 0 && (
              <ul className="Q-cc-ings" aria-label="Ingredients for this step" style={qtyCol(uses.get(String(s.key)).map((u) => u.qty))}>
                {uses.get(String(s.key)).map((u, j) => (
                  <li key={j} className={u.made ? 'made' : ''}><b>{u.qty || ''}</b><span>{u.made ? '↳ ' : ''}{u.d.name}{u.note && <small>{u.note}</small>}</span></li>
                ))}
              </ul>
            )}
            <div className="Q-cc-task-acts">
              {!isDone && !waiting && findDurations(s.text).slice(0, 2).map((d) => (
                <button key={d.ms} className="btn primary sm" onClick={() => startTimer({ key: `${tkey}:${d.ms}`, label: s.text.slice(0, 60), name: raw.title, duration: d.ms, recipeId: raw.id, recipeTitle: raw.title })}>
                  <TimerIcon size={14} /> {d.label}
                </button>
              ))}
              <button className="btn ghost sm" onClick={() => toggleDone(s, isDone)}>{isDone ? <><Undo2 size={14} /> Not done</> : <><Check size={14} /> Done</>}</button>
              {canStartHere && <button className="btn ghost sm" onClick={() => startHere(s)} title="Every step before this one counts as done"><SkipForward size={14} /> Start here</button>}
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
          <div className="Q-cc-done-row">
            <button type="button" className="Q-cc-done-toggle" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>{finished.length} done <ChevronDown size={13} /></button>
            <button type="button" className="Q-cc-done-toggle" onClick={startOver}>Start over</button>
          </div>
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
