import { useState } from 'react'
import { ChevronUp, LayoutList, Minus, Timer as TimerIcon, X } from 'lucide-react'
import { fmtClock, remaining } from '../../lib/timers.js'
import { useHeyChef } from '../../lib/heychef.js'
import { LANES, setFloatHidden, stepKeyOfTimer, useFloatHidden, useSessionPlan, when } from './useSessionPlan.js'
import { toast } from '../ui/Toaster.jsx'

const OPEN = 'qdplus_float_open'
const short = (t, n = 70) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 2).trimEnd()}…` : s }

// "Cooking now": floats over the session (and chef mode) with every recipe on the go, each at its
// step, in the order they come — numbered and joined by a line, so what goes first and what
// follows reads at a glance. A recipe waiting on a timer shows the countdown; a tap opens chef
// mode on that step.
export default function FloatingPlan({ session, recipesById, library, change, onOpenPlan, onChefAt }) {
  const { entries, plan, now, timers, tnow } = useSessionPlan({ session, recipesById, library, change })
  const hey = useHeyChef()
  const hidden = useFloatHidden()
  // Open on a computer, folded to one line on a phone — until you choose.
  const [open, setOpenState] = useState(() => {
    try { const v = localStorage.getItem(OPEN); if (v != null) return v === '1' } catch (_) { /* ignore */ }
    return !window.matchMedia?.('(max-width: 700px)').matches
  })
  // Over chef mode on a phone it starts folded, so the step stays in view.
  const [chefOpen, setChefOpen] = useState(false)
  const phone = window.matchMedia?.('(max-width: 700px)').matches
  const overChef = hey.chefOpen && phone
  const setOpen = (v) => {
    if (overChef) { setChefOpen(v); return }
    setOpenState(v); try { localStorage.setItem(OPEN, v ? '1' : '0') } catch (_) { /* ignore */ }
  }

  const rows = entries.map((e, ri) => {
    const rid = e.raw.id
    const mine = plan.items.filter((it) => it.rid === rid)
    // Its timer while it counts — or rings; one that ran out quietly has done its job.
    const timer = timers.filter((t) => t.state !== 'idle' && (t.state !== 'done' || t.ringing) && stepKeyOfTimer(rid, t.key) != null)
      .sort((a, b) => remaining(b, tnow) - remaining(a, tnow))[0] || null
    return { rid, ri, title: e.raw.title, step: mine[0] || null, then: mine[1] || null, timer }
  }).filter((r) => r.step || r.timer)
    .sort((a, b) => (a.step ? a.step.start : Infinity) - (b.step ? b.step.start : Infinity))
  if (!rows.length || hidden) return null
  // Closed: gone until "Show Cooking now" on the Plan (or Undo, right away).
  const close = () => {
    setFloatHidden(true)
    toast('“Cooking now” closed — the Plan can show it again', { action: { label: 'Undo', onClick: () => setFloatHidden(false) } })
  }

  const at = (ms) => (ms <= 60000 ? 'now' : ms < 60 * 60000 ? `in ${Math.round(ms / 60000)} min` : when(now + ms, now))
  const timeLeft = (t) => (t.ringing || t.state === 'done' ? 'time’s up' : fmtClock(t.state === 'paused' ? t.left || 0 : remaining(t, tnow)))
  const lead = rows[0]
  const shown = overChef ? chefOpen : open

  return (
    <aside className={`Q-float${shown ? ' open' : ''}${hey.chefOpen ? ' over-chef' : ''}`} aria-label="Cooking now">
      {shown ? (
        <>
          <div className="Q-float-head">
            <b>Cooking now</b>
            <span className="sp" />
            <button type="button" className="Q-icon-btn" onClick={onOpenPlan} title="Open the plan" aria-label="Open the plan"><LayoutList size={16} /></button>
            <button type="button" className="Q-icon-btn" onClick={() => setOpen(false)} title="Minimize" aria-label="Minimize" aria-expanded="true"><Minus size={16} /></button>
            <button type="button" className="Q-icon-btn" onClick={close} title="Close" aria-label="Close Cooking now"><X size={16} /></button>
          </div>
          <ol className="Q-float-list">
            {rows.map((r, k) => (
              <li key={r.rid} className={`Q-float-row${r.step && r.step.start <= 60000 ? ' now' : ''}`} style={{ '--lane': LANES[r.ri % LANES.length] }}>
                <span className="dot" aria-hidden="true">{k + 1}</span>
                <button type="button" className="body" disabled={!r.step} onClick={() => r.step && onChefAt(r.rid, r.step.key, r.step.text)} title={r.step ? 'Chef mode on this step' : undefined}>
                  <span className="rec">{r.title}</span>
                  {r.timer && <span className={`wait${r.timer.ringing ? ' ringing' : ''}`}><TimerIcon size={11} /> {timeLeft(r.timer)}</span>}
                  {r.step && <span className="step">{r.step.n}. {short(r.step.text)}</span>}
                  {r.then && <span className="then">then {short(r.then.text, 44)} · {at(r.then.start)}</span>}
                </button>
                <span className="at">{r.step ? at(r.step.start) : ''}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="Q-float-pillrow">
          <button type="button" className="Q-float-pill" onClick={() => setOpen(true)} aria-expanded="false" title="Show the list" style={{ '--lane': LANES[lead.ri % LANES.length] }}>
            <span className="dot" aria-hidden="true">1</span>
            <span className="txt"><b>{lead.title}</b>{lead.step ? ` · ${short(lead.step.text, 48)}` : ''}</span>
            <span className="at">{lead.step ? at(lead.step.start) : timeLeft(lead.timer)}</span>
            {rows.length > 1 && <span className="more">+{rows.length - 1}</span>}
            <ChevronUp size={15} />
          </button>
          <button type="button" className="Q-float-x" onClick={close} title="Close" aria-label="Close Cooking now"><X size={15} /></button>
        </div>
      )}
    </aside>
  )
}
