import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Timer as TimerIcon } from 'lucide-react'
import { startTimer } from '../lib/timers.js'
import { parseDurationInput } from '../lib/durations.js'
import { presetLabel } from './Timers.jsx'

// Options for one step (or part) of the method, opened by holding it down on a phone or with a
// right click: start its written time, any other timer, edit its text, and a few step actions.
// A sheet from the bottom on phones, a small card on wider screens.
// `edit`: { text, onSave(text) } when the step can be changed.
export default function StepSheet({ title, subtitle, durations = [], tkeyBase, timer, actions = [], edit = null, onClose }) {
  const [amount, setAmount] = useState('')
  const [editing, setEditing] = useState(null) // the text being written, while editing
  const ms = parseDurationInput(amount)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function start(duration, key) {
    startTimer({ ...timer, key, duration })
    onClose()
  }

  const host = document.querySelector('.Q') || document.body
  if (editing != null) {
    const save = () => { const t = editing.trim(); if (t && t !== edit.text) edit.onSave(t); onClose() }
    return createPortal(
      <div className="Q-sheet-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <form className="Q-sheet" role="dialog" aria-label={`Edit ${title}`} onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="Q-sheet-grip" aria-hidden="true" />
          <div className="Q-sheet-head"><b>Edit · {title}</b></div>
          <textarea
            className="Q-sheet-edit" value={editing} autoFocus rows={4} aria-label="Text"
            onChange={(e) => setEditing(e.target.value.replace(/\r?\n/g, ' '))}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() } }}
          />
          <div className="Q-sheet-edit-foot">
            <button type="button" className="btn ghost sm" onClick={() => setEditing(null)}>Back</button>
            <button className="btn primary sm" disabled={!editing.trim()}>Save</button>
          </div>
        </form>
      </div>,
      host,
    )
  }
  return createPortal(
    <div className="Q-sheet-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="Q-sheet" role="dialog" aria-label={title}>
        <div className="Q-sheet-grip" aria-hidden="true" />
        <div className="Q-sheet-head">
          <b>{title}</b>
          {subtitle && <span>{subtitle}</span>}
        </div>

        {durations.length > 0 && (
          <div className="Q-sheet-sec">
            <div className="Q-sheet-label">Time written in this step</div>
            <div className="Q-sheet-chips">
              {durations.map((d) => (
                <button key={d.ms} type="button" className="main" onClick={() => start(d.ms, `${tkeyBase}:${d.ms}`)}>
                  <TimerIcon size={14} /> {d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="Q-sheet-sec">
          <div className="Q-sheet-label">Timer · {timer.name}</div>
          <div className="Q-sheet-chips">
            {[1, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => (
              <button key={m} type="button" onClick={() => start(m * 60000, tkeyBase)}>{presetLabel(m)}</button>
            ))}
          </div>
          <form className="Q-sheet-form" onSubmit={(e) => { e.preventDefault(); if (ms) start(ms, tkeyBase) }}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Other: 12 min, 1h30…" aria-label="Duration" />
            <button className="btn primary sm" disabled={!ms}>Start</button>
          </form>
        </div>

        {(actions.length > 0 || edit) && (
          <div className="Q-sheet-list">
            {edit && <button type="button" onClick={() => setEditing(edit.text)}>Edit</button>}
            {actions.map((a) => <button key={a.label} type="button" onClick={() => { a.onClick(); onClose() }}>{a.label}</button>)}
          </div>
        )}
        <button type="button" className="Q-sheet-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>,
    host,
  )
}
