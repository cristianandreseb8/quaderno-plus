import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Timer as TimerIcon } from 'lucide-react'
import Modal from './ui/Modal.jsx'
import { supabase } from '../lib/supabase.js'
import { clockElapsed, fmtSpan } from '../lib/timing.js'
import { findDurations } from '../lib/durations.js'

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0 }
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// What the timing has learned: finished sessions and how long they took, and per recipe the
// typical time of each step — next to the time written in it.
export default function TimesReport({ recipesById, onClose }) {
  const [rows, setRows] = useState(null)
  const [sessions, setSessions] = useState([])
  const [open, setOpen] = useState(null)

  useEffect(() => {
    supabase.from('step_times').select('recipe_id, step_key, step_text, active_ms, ended_at, source').order('ended_at', { ascending: false }).limit(5000)
      .then(({ data }) => setRows(data || []))
    supabase.from('cook_sessions').select('id, recipes, clock, updated_at, status').order('updated_at', { ascending: false }).limit(30)
      .then(({ data }) => setSessions((data || []).filter((s) => s.clock?.start)))
  }, [])

  const byRecipe = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) {
      if (!r.recipe_id) continue
      const rec = m.get(r.recipe_id) || { id: r.recipe_id, steps: new Map(), n: 0, last: r.ended_at }
      const s = rec.steps.get(r.step_key) || { key: r.step_key, text: r.step_text, ms: [] }
      s.ms.push(r.active_ms)
      rec.steps.set(r.step_key, s)
      rec.n += 1
      m.set(r.recipe_id, rec)
    }
    return [...m.values()].map((rec) => {
      const steps = [...rec.steps.values()].map((s) => ({ ...s, typical: median(s.ms), written: findDurations(s.text).reduce((x, d) => Math.max(x, d.ms), 0) }))
        .sort((a, b) => Number(a.key) - Number(b.key))
      return { ...rec, steps, total: steps.reduce((t, s) => t + s.typical, 0) }
    }).sort((a, b) => (a.last < b.last ? 1 : -1))
  }, [rows])

  const title = (id) => recipesById.get(id)?.title || 'A recipe'
  return (
    <Modal title="Time report" icon={TimerIcon} onClose={onClose} width={720}>
      {rows == null && <p className="Q-dim">Loading…</p>}
      {rows && !rows.length && !sessions.length && (
        <p className="Q-report-empty">Nothing timed yet. Chef mode times every step by itself; you can also time a step by hand (right-click it, or hold it on a phone) and start the session clock in Plan. The more you cook, the better the typical times and the plans get.</p>
      )}

      {sessions.length > 0 && (
        <section className="Q-report-sec">
          <h3>Sessions</h3>
          <ul className="Q-report-list">
            {sessions.map((s) => (
              <li key={s.id}>
                <span className="when">{day(s.clock.start)}</span>
                <span className="what">{(s.recipes || []).map((e) => title(e.id)).join(' · ') || '—'}</span>
                <b>{fmtSpan(clockElapsed(s.clock))}{!s.clock.end && s.status !== 'done' ? ' · now' : ''}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      {byRecipe.length > 0 && (
        <section className="Q-report-sec">
          <h3>Recipes</h3>
          <p className="Q-set-help">Typical hands-on time per step (the middle of your times) next to the time written in the step.</p>
          <ul className="Q-report-recipes">
            {byRecipe.map((rec) => (
              <li key={rec.id} className={open === rec.id ? 'open' : ''}>
                <button type="button" onClick={() => setOpen(open === rec.id ? null : rec.id)}>
                  <span className="what">{title(rec.id)}</span>
                  <span className="n">{rec.n} time{rec.n === 1 ? '' : 's'}</span>
                  <b>{fmtSpan(rec.total)}</b>
                  <ChevronDown size={14} />
                </button>
                {open === rec.id && (
                  <table className="Q-report-steps">
                    <thead><tr><th>Step</th><th>Yours</th><th>Written</th></tr></thead>
                    <tbody>
                      {rec.steps.map((s) => (
                        <tr key={s.key}>
                          <td>{s.text}</td>
                          <td>{fmtSpan(s.typical)}<small> ×{s.ms.length}</small></td>
                          <td>{s.written ? fmtSpan(s.written) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  )
}
