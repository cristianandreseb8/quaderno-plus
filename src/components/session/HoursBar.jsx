import { useState } from 'react'
import { Clock4, Moon, Plus, X } from 'lucide-react'

const valid = (r) => r && /^\d{1,2}:\d{2}$/.test(r.from || '') && /^\d{1,2}:\d{2}$/.test(r.to || '') && r.from !== r.to

// Your shift and sleep times: hands-on work is only planned when you are there; waits run anyway.
export default function HoursBar({ hours, onSave }) {
  const [draft, setDraft] = useState(null)
  const shifts = (hours?.shifts || []).filter(valid)
  const sleep = valid(hours?.sleep) ? hours.sleep : null
  const summary = [
    ...shifts.map((r) => `Shift ${r.from}–${r.to}`),
    sleep && `Sleep ${sleep.from}–${sleep.to}`,
  ].filter(Boolean).join(' · ')

  if (!draft) {
    return (
      <div className="Q-cc-hours">
        <Clock4 size={15} />
        <span>{summary || 'Set your shift and sleep times: work is planned only when you’re there, and long waits fall while you’re away.'}</span>
        <button type="button" className="Q-link" onClick={() => setDraft({ shifts: shifts.length ? shifts : [], sleep: sleep || null })}>{summary ? 'Change' : 'Set hours'}</button>
      </div>
    )
  }
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const setShift = (k, patch) => set({ shifts: draft.shifts.map((r, j) => (j === k ? { ...r, ...patch } : r)) })
  const save = (e) => {
    e.preventDefault()
    const h = { shifts: draft.shifts.filter(valid), sleep: valid(draft.sleep) ? draft.sleep : null }
    onSave(h)
    setDraft(null)
  }
  return (
    <form className="Q-cc-hours editing" onSubmit={save} aria-label="Your hours">
      <div className="Q-cc-hours-grid">
        <div className="lbl"><Clock4 size={14} /> Shifts</div>
        <div className="rows">
          {draft.shifts.length === 0 && <span className="Q-dim">No shift: any time you’re awake.</span>}
          {draft.shifts.map((r, k) => (
            <div key={k} className="Q-cc-range">
              <input type="time" value={r.from} onChange={(e) => setShift(k, { from: e.target.value })} aria-label={`Shift ${k + 1} starts`} required />
              <span>to</span>
              <input type="time" value={r.to} onChange={(e) => setShift(k, { to: e.target.value })} aria-label={`Shift ${k + 1} ends`} required />
              <button type="button" className="Q-icon-btn" onClick={() => set({ shifts: draft.shifts.filter((_, j) => j !== k) })} aria-label={`Remove shift ${k + 1}`}><X size={14} /></button>
            </div>
          ))}
          <button type="button" className="Q-link" onClick={() => set({ shifts: [...draft.shifts, { from: '06:00', to: '14:00' }] })}><Plus size={13} /> Add a shift</button>
        </div>
        <div className="lbl"><Moon size={14} /> Sleep</div>
        <div className="rows">
          {draft.sleep ? (
            <div className="Q-cc-range">
              <input type="time" value={draft.sleep.from} onChange={(e) => set({ sleep: { ...draft.sleep, from: e.target.value } })} aria-label="Sleep from" required />
              <span>to</span>
              <input type="time" value={draft.sleep.to} onChange={(e) => set({ sleep: { ...draft.sleep, to: e.target.value } })} aria-label="Sleep until" required />
              <button type="button" className="Q-icon-btn" onClick={() => set({ sleep: null })} aria-label="No sleep times"><X size={14} /></button>
            </div>
          ) : (
            <button type="button" className="Q-link" onClick={() => set({ sleep: { from: '23:00', to: '07:00' } })}><Plus size={13} /> Add sleep times</button>
          )}
        </div>
      </div>
      <div className="Q-cc-hours-acts">
        <button className="btn primary sm">Save</button>
        <button type="button" className="btn ghost sm" onClick={() => setDraft(null)}>Cancel</button>
      </div>
    </form>
  )
}
