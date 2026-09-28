import { useState } from 'react'
import { Maximize2, Minimize2, Pause, Play, RotateCcw, Timer as TimerIcon, X } from 'lucide-react'
import Menu, { useMenuClose } from './ui/Menu.jsx'
import {
  addTime, clearFinished, fmtClock, pauseTimer, remaining, removeTimer, resetTimer, restartTimer, resumeTimer,
  setBig, setDockOpen, startTimer, stopRinging, useTimers,
} from '../lib/timers.js'
import { fmtDuration, parseDurationInput } from '../lib/durations.js'

const presetLabel = (min) => (min < 60 ? `${min} min` : `${+(min / 60).toFixed(1)} h`)

// ── Top bar: opens the timers; shows the next one to finish while any runs ──
export function TimersButton() {
  const { timers, now, dockOpen } = useTimers()
  const running = timers.filter((t) => t.state === 'running')
  const ringing = timers.some((t) => t.ringing)
  const soonest = running.reduce((a, t) => (!a || t.endsAt < a.endsAt ? t : a), null)
  return (
    <button
      className={`Q-hbtn Q-timers-btn${ringing ? ' ringing' : running.length ? ' on' : ''}${soonest || ringing ? '' : ' icon'}`}
      onClick={() => setDockOpen(!dockOpen)} title="Timers" aria-label="Timers"
    >
      <TimerIcon size={17} />
      {ringing ? <span className="t">Time's up</span> : soonest && <span className="t">{fmtClock(remaining(soonest, now))}</span>}
      {running.length > 1 && <span className="n">{running.length}</span>}
    </button>
  )
}

// ── The timers panel (and, enlarged, the kitchen "timer mode") ──
export function TimerDock() {
  const { timers, now, dockOpen, big } = useTimers()
  const [amount, setAmount] = useState('')
  const [name, setName] = useState('')
  if (!dockOpen) return null

  // Timers of one recipe together: each preparation runs in parallel with the others.
  const groups = []
  timers.forEach((t) => {
    const title = t.recipeTitle || ''
    let g = groups.find((x) => x.title === title)
    if (!g) { g = { title, list: [] }; groups.push(g) }
    g.list.push(t)
  })
  groups.sort((a, b) => (a.title ? 1 : 0) - (b.title ? 1 : 0))
  const ms = parseDurationInput(amount)
  function start(duration) {
    startTimer({ label: name.trim() || fmtDuration(duration), duration })
    setName(''); setAmount('')
  }

  return (
    <div className={`Q-timers${big ? ' big' : ''}`} role="dialog" aria-label="Timers">
      <div className="Q-timers-head">
        <b>Timers</b>
        <span className="sp" />
        {timers.some((t) => t.state === 'done' && !t.ringing) && <button className="Q-link" onClick={clearFinished}>Clear finished</button>}
        <button className="Q-icon-btn" onClick={() => setBig(!big)} title={big ? 'Back to the small panel' : 'Timer mode: big, for the kitchen'} aria-label={big ? 'Smaller' : 'Timer mode'}>
          {big ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button className="Q-icon-btn" onClick={() => setDockOpen(false)} aria-label="Close timers"><X size={16} /></button>
      </div>
      <div className="Q-timers-list">
        {!timers.length && <p className="Q-timers-empty">No timers yet. Start one here, or tap a time in a recipe step.</p>}
        {groups.map((g) => (
          <div key={g.title || '_'} className="Q-timers-group">
            {g.title && <div className="Q-timers-gh">{g.title}</div>}
            {g.list.map((t) => <TimerRow key={t.id} t={t} now={now} />)}
          </div>
        ))}
      </div>
      <form className="Q-timers-new" onSubmit={(e) => { e.preventDefault(); if (ms) start(ms) }}>
        <div className="Q-timers-presets">
          {[1, 3, 5, 10, 15, 30, 60].map((m) => <button type="button" key={m} onClick={() => start(m * 60000)}>{presetLabel(m)}</button>)}
        </div>
        <div className="Q-timers-custom">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Timer name" />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12 min, 1h30…" aria-label="Duration" />
          <button className="btn primary sm" disabled={!ms}>Start</button>
        </div>
      </form>
    </div>
  )
}

function TimerRow({ t, now }) {
  const left = remaining(t, now)
  const pct = t.duration ? Math.min(100, (1 - left / t.duration) * 100) : 100
  return (
    <div className={`Q-timer ${t.state}${t.ringing ? ' ringing' : ''}`}>
      <div className="Q-timer-main">
        <div className="Q-timer-label" title={t.label}>{t.label}</div>
        <div className="Q-timer-clock">{t.state === 'done' ? (t.ringing ? 'Time’s up' : 'Done') : fmtClock(left)}</div>
      </div>
      <div className="Q-timer-bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="Q-timer-actions">
        {t.ringing && <button className="stop" onClick={() => stopRinging(t.id)}>Stop</button>}
        {t.state === 'running' && <button onClick={() => pauseTimer(t.id)} title="Pause" aria-label="Pause"><Pause size={15} /></button>}
        {t.state === 'paused' && <button onClick={() => resumeTimer(t.id)} title="Resume" aria-label="Resume"><Play size={15} /></button>}
        {(t.state === 'idle' || (t.state === 'done' && !t.ringing)) && <button onClick={() => restartTimer(t.id)} title="Start again" aria-label="Start again"><Play size={15} /></button>}
        <button onClick={() => addTime(t.id, 60000)} title="Add a minute">+1 min</button>
        {(t.state === 'running' || t.state === 'paused') && <button onClick={() => resetTimer(t.id)} title="Reset" aria-label="Reset"><RotateCcw size={14} /></button>}
        <span className="sp" />
        <button onClick={() => removeTimer(t.id)} title="Remove" aria-label="Remove"><X size={15} /></button>
      </div>
    </div>
  )
}

// ── A time written in a step ("40 min"): tap to start it; while it runs it counts down ──
export function TimerChip({ tkey, label, recipeId, recipeTitle, ms, text }) {
  const { timers, now } = useTimers()
  const t = timers.find((x) => x.key === tkey)
  const live = t && t.state !== 'idle'
  function onClick(e) {
    e.stopPropagation()
    if (t?.ringing) { stopRinging(t.id); return }
    if (!live || t.state === 'done') startTimer({ key: tkey, label, recipeId, recipeTitle, duration: ms })
    else setDockOpen(true)
  }
  const title = !live ? `Start a ${text} timer` : t.state === 'done' ? 'Start it again' : 'Show timers'
  return (
    <button type="button" className={`Q-tchip${live ? ` ${t.state}` : ''}${t?.ringing ? ' ringing' : ''}`} onClick={onClick} title={title}>
      <TimerIcon size={12} />
      {!live ? text : t.ringing ? 'Time’s up' : t.state === 'done' ? `${text} ✓` : fmtClock(remaining(t, now))}
    </button>
  )
}

// ── A timer for a part of the method, a recipe, or a step without a written time ──
function Presets({ onPick }) {
  const close = useMenuClose()
  const [amount, setAmount] = useState('')
  const ms = parseDurationInput(amount)
  const pick = (d) => { onPick(d); close() }
  return (
    <div className="Q-tmenu" onClick={(e) => e.stopPropagation()}>
      <div className="Q-tmenu-grid">
        {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => <button type="button" key={m} onClick={() => pick(m * 60000)}>{presetLabel(m)}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (ms) pick(ms) }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Other: 12 min, 1h30…" aria-label="Duration" />
        <button className="btn primary sm" disabled={!ms}>Start</button>
      </form>
    </div>
  )
}

export function TimerPresets({ label, recipeId, recipeTitle, tkey = null }) {
  return <Presets onPick={(duration) => startTimer({ key: tkey, label: label || fmtDuration(duration), recipeId, recipeTitle, duration })} />
}

export function TimerMenu({ label, recipeId, recipeTitle, tkey, className = '' }) {
  const { timers, now } = useTimers()
  const t = tkey && timers.find((x) => x.key === tkey && x.state !== 'idle')
  return (
    // Clicks inside (and in the menu, which React bubbles through here) must not tick the step.
    <span className={`Q-tmenu-wrap ${className}`} onClick={(e) => e.stopPropagation()}>
      {t && t.state !== 'done'
        ? <button type="button" className={`Q-tchip ${t.state}${t.ringing ? ' ringing' : ''}`} onClick={() => setDockOpen(true)}><TimerIcon size={12} />{fmtClock(remaining(t, now))}</button>
        : (
          <Menu
            width={236} align="start"
            trigger={(p) => <button type="button" className="Q-step-tbtn" onClick={p.toggle} title={`Timer: ${label}`} aria-label={`Timer for ${label}`}><TimerIcon size={13} /></button>}
          >
            <div className="Q-menu-label">Timer · {label}</div>
            <TimerPresets label={label} recipeId={recipeId} recipeTitle={recipeTitle} tkey={tkey} />
          </Menu>
        )}
    </span>
  )
}

// ── Next timer of a recipe, for the recipe lists (parallel preparations at a glance) ──
export function RecipeTimerBadge({ recipeId }) {
  const { timers, now } = useTimers()
  const mine = timers.filter((t) => t.recipeId === recipeId && (t.state === 'running' || t.ringing))
  if (!mine.length) return null
  if (mine.some((t) => t.ringing)) return <span className="Q-list-timer ringing"><TimerIcon size={11} />Time’s up</span>
  const soonest = mine.reduce((a, t) => (t.endsAt < a.endsAt ? t : a))
  return <span className="Q-list-timer"><TimerIcon size={11} />{fmtClock(remaining(soonest, now))}{mine.length > 1 ? ` +${mine.length - 1}` : ''}</span>
}
