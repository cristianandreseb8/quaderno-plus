import { useEffect, useMemo, useState } from 'react'
import { OUTCOMES, buildProgression, deleteTrial, loadTrials, outcomeOf, saveTrial } from '../lib/trials.js'
import { getChefName, setChefName } from '../lib/acks.js'

const BLANK = { label: '', outcome: 'tried', note: '', changes: [{ what: '', value: '' }] }

function TrialForm({ recipeId, initial, onDone, onCancel }) {
  const [t, setT] = useState(() => ({
    ...BLANK, ...initial,
    changes: (initial?.changes?.length ? initial.changes : BLANK.changes).map((c) => ({ ...c })),
  }))
  const [saving, setSaving] = useState(false)

  function setChange(i, patch) {
    setT((p) => ({ ...p, changes: p.changes.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
  }

  async function save() {
    let author = getChefName()
    if (!author) {
      author = (window.prompt('Your name — recorded against this trial:') || '').trim()
      if (author) setChefName(author)
    }
    setSaving(true)
    const row = {
      ...(t.id ? { id: t.id } : {}),
      recipe_id: recipeId,
      trial_date: t.trial_date || new Date().toISOString().slice(0, 10),
      label: t.label.trim(),
      outcome: t.outcome,
      note: t.note.trim(),
      author: t.author || author || '',
      changes: t.changes.filter((c) => String(c.what).trim()).map((c) => ({ what: c.what.trim(), value: String(c.value).trim() })),
    }
    const saved = await saveTrial(row)
    setSaving(false)
    if (saved) onDone(saved); else window.alert('Could not save this trial.')
  }

  return (
    <div className="DL-form">
      <div className="DL-form-row">
        <input
          className="DL-label-in" value={t.label} placeholder="Label (e.g. Trial 3, or leave blank)"
          onChange={(e) => setT({ ...t, label: e.target.value })}
        />
        <input
          type="date" className="DL-date-in"
          value={t.trial_date || new Date().toISOString().slice(0, 10)}
          onChange={(e) => setT({ ...t, trial_date: e.target.value })}
        />
      </div>

      <div className="DL-outcomes">
        {OUTCOMES.map((o) => (
          <button
            key={o.key} className={`DL-outcome${t.outcome === o.key ? ' active' : ''}`}
            style={t.outcome === o.key ? { color: o.color, background: o.bg, borderColor: o.color } : undefined}
            onClick={() => setT({ ...t, outcome: o.key })}
          >{o.icon} {o.label}</button>
        ))}
      </div>

      <div className="DL-changes-h">What changed</div>
      {t.changes.map((c, i) => (
        <div className="DL-change-row" key={i}>
          <input
            placeholder="What (e.g. rote beete saft)" value={c.what}
            onChange={(e) => setChange(i, { what: e.target.value })}
          />
          <input
            placeholder="Value (e.g. 22 g)" value={c.value} className="DL-value-in"
            onChange={(e) => setChange(i, { value: e.target.value })}
          />
          <button className="RF-remove" onClick={() => setT((p) => ({ ...p, changes: p.changes.filter((_, j) => j !== i) }))}>×</button>
        </div>
      ))}
      <button className="DL-addrow" onClick={() => setT((p) => ({ ...p, changes: [...p.changes, { what: '', value: '' }] }))}>
        ＋ another change
      </button>

      <textarea
        className="DL-note" rows={3} value={t.note}
        placeholder="Why this change, and what you thought of the result."
        onChange={(e) => setT({ ...t, note: e.target.value })}
      />

      <div className="DL-form-actions">
        <button className="H-btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save trial'}</button>
        <button className="H-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

export default function DevLogPanel({ recipe, onClose }) {
  const [trials, setTrials] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [tab, setTab] = useState('timeline')

  useEffect(() => {
    loadTrials(recipe.id).then((t) => { setTrials(t); setLoading(false) })
  }, [recipe.id])

  const progression = useMemo(() => buildProgression(trials), [trials])

  async function refresh() { setTrials(await loadTrials(recipe.id)) }

  async function remove(id) {
    if (!window.confirm('Delete this trial from the log?')) return
    if (await deleteTrial(id)) refresh()
  }

  return (
    <div className="DL-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="DL">
        <div className="DL-head">
          <span className="DL-title">🧪 Development log</span>
          <span className="DL-sub">{recipe.title}</span>
          <button className="btn ghost xs" onClick={onClose}>✕ Close</button>
        </div>

        <div className="DL-tabs">
          <button className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>
            Timeline <span className="V-count">{trials.length}</span>
          </button>
          <button className={tab === 'progression' ? 'active' : ''} onClick={() => setTab('progression')}>
            How values moved <span className="V-count">{progression.length}</span>
          </button>
        </div>

        <div className="DL-body">
          {loading && <div className="Q-msg">Loading…</div>}

          {!loading && tab === 'timeline' && (
            <>
              {!adding && !editing && (
                <button className="H-btn primary DL-add" onClick={() => setAdding(true)}>＋ Record a trial</button>
              )}
              {adding && (
                <TrialForm
                  recipeId={recipe.id}
                  onDone={() => { setAdding(false); refresh() }}
                  onCancel={() => setAdding(false)}
                />
              )}
              {!trials.length && !adding && (
                <div className="DL-empty">
                  Nothing logged yet. Record what you changed on each attempt — the amounts you
                  tried and why — and the history stays attached to this recipe.
                </div>
              )}
              {trials.map((t, i) => {
                const o = outcomeOf(t.outcome)
                if (editing === t.id) {
                  return (
                    <TrialForm
                      key={t.id} recipeId={recipe.id} initial={t}
                      onDone={() => { setEditing(null); refresh() }}
                      onCancel={() => setEditing(null)}
                    />
                  )
                }
                return (
                  <div className="DL-entry" key={t.id}>
                    <div className="DL-entry-head">
                      <span className="DL-badge" style={{ color: o.color, background: o.bg }}>{o.icon} {o.label}</span>
                      <span className="DL-entry-label">{t.label || `Trial ${i + 1}`}</span>
                      <span className="DL-entry-date">{t.trial_date}{t.author ? ` · ${t.author}` : ''}</span>
                      <button className="RF-edit" onClick={() => setEditing(t.id)}>edit</button>
                      <button className="RF-remove" onClick={() => remove(t.id)}>×</button>
                    </div>
                    {(t.changes || []).length > 0 && (
                      <ul className="DL-changes">
                        {t.changes.map((c, j) => (
                          <li key={j}><span className="DL-what">{c.what}</span><span className="DL-val">{c.value}</span></li>
                        ))}
                      </ul>
                    )}
                    {t.note && <div className="DL-entry-note">{t.note}</div>}
                  </div>
                )
              })}
            </>
          )}

          {!loading && tab === 'progression' && (
            progression.length ? (
              <table className="DL-prog">
                <tbody>
                  {progression.map((p) => (
                    <tr key={p.what}>
                      <th>{p.what}</th>
                      <td>
                        <span className="DL-chain">
                          {p.steps.map((st, i) => {
                            const o = outcomeOf(st.outcome)
                            return (
                              <span key={i} className="DL-step">
                                {i > 0 && <span className="DL-arrow">→</span>}
                                <span
                                  className={`DL-stepval${st.outcome === 'final' ? ' final' : ''}`}
                                  style={{ color: o.color, background: o.bg }}
                                  title={`${st.label} · ${o.label}${st.date ? ' · ' + st.date : ''}`}
                                >{st.value || '—'}</span>
                              </span>
                            )
                          })}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="DL-empty">
                Once trials record a value for the same thing more than once, its progression
                shows here — 20 g → 22 g → 30 g, with the final one highlighted.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
