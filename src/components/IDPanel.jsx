import { useEffect, useMemo, useState } from 'react'
import { uid } from '../lib/recipeCalc.js'
import { calcMacros, detectIngType } from '../lib/macros.js'
import { libFindMatch, libLoad, libUpsert } from '../lib/ingredientLibrary.js'
import { analyzeCustomParam, analyzeMacros } from '../lib/ai.js'
import { parseIdData, serializeIdData } from '../lib/idData.js'
import { SENSORY_ATTRS, SENSORY_LABELS } from '../lib/constants.js'
import IngredientLibraryModal from './IngredientLibraryModal.jsx'

export default function IDPanel({ recipe, onSave }) {
  const [data, setData] = useState(() => parseIdData(recipe.id_data))
  const [customAttrs, setCustomAttrs] = useState(() => data.customSensoryAttrs || [])
  const [newAttrName, setNewAttrName] = useState('')
  const [openSections, setOpenSections] = useState({ params: true, sensory: false, timeline: false, nutrition: false })
  const [newVersion, setNewVersion] = useState({ title: '', notes: '', isGoal: false })
  const [addingVersion, setAddingVersion] = useState(false)
  const [, setSaving] = useState(false)
  const [analyzingMacros, setAnalyzingMacros] = useState(false)
  const [addingParam, setAddingParam] = useState(false)
  const [newParamLabel, setNewParamLabel] = useState('')
  const [analyzingCustom, setAnalyzingCustom] = useState(false)
  const [showLibPanel, setShowLibPanel] = useState(false)

  useEffect(() => { const d = parseIdData(recipe.id_data); setData(d); setCustomAttrs(d.customSensoryAttrs || []) }, [recipe.id])

  async function saveData(d) { setSaving(true); try { await onSave(serializeIdData(d)) } finally { setSaving(false) } }
  function toggleSection(k) { setOpenSections((p) => ({ ...p, [k]: !p[k] })) }
  function setSensory(attr, field, val) {
    const next = { ...data, sensory: { ...data.sensory, [attr]: { ...(data.sensory[attr] || {}), [field]: val } } }
    setData(next); saveData(next)
  }
  function addVersion() {
    if (!newVersion.title.trim()) return
    const v = { id: uid(), date: new Date().toISOString().slice(0, 10), title: newVersion.title.trim(), notes: newVersion.notes.trim(), isGoal: newVersion.isGoal }
    const next = { ...data, versions: [...(data.versions || []), v] }
    setData(next); saveData(next); setNewVersion({ title: '', notes: '', isGoal: false }); setAddingVersion(false)
  }
  function removeVersion(id) {
    const next = { ...data, versions: (data.versions || []).filter((v) => v.id !== id) }
    setData(next); saveData(next)
  }
  function setGoal(g) { const next = { ...data, goal: g }; setData(next); saveData(next) }

  const macros = useMemo(() => calcMacros(recipe.ingredients, data.macroCache || null, data.libData || null), [recipe.ingredients, data.macroCache, data.libData])
  const MAX_VALS = { fat: 40, water: 80, sugar: 40, protein: 20, bakersHydration: 100, saltP: 3 }

  async function runAIMacroAnalysis() {
    if (!recipe.ingredients || !recipe.ingredients.length) return
    setAnalyzingMacros(true)
    try {
      const libItems = await libLoad()
      const ingsForAI = []
      for (const ing of recipe.ingredients) {
        const match = libFindMatch(ing.name, libItems)
        if (!match || !match.params || Object.keys(match.params).length === 0) {
          ingsForAI.push({ name: ing.name, qty: parseFloat(ing.qty) || 0, unit: ing.unit || 'g' })
        }
      }
      let newCache = {}
      if (ingsForAI.length > 0) {
        const json = await analyzeMacros(recipe.title, ingsForAI)
        newCache = json.cache || {}
        for (const [ingName, vals] of Object.entries(newCache)) {
          const existMatch = libFindMatch(ingName, libItems)
          if (!existMatch) {
            await libUpsert({
              name: ingName, canonical_name: ingName, ingredient_type: vals.ingredient_type || 'other', aliases: [],
              params: {
                fat_pct: vals.fat_pct || 0, water_pct: vals.water_pct || 0, free_water_pct: vals.free_water_pct || 0,
                sugar_pct: vals.sugar_pct || 0, protein_pct: vals.protein_pct || 0, carbs_pct: vals.carbs_pct || 0,
                cal_per100: vals.cal_per100 || 0, flour_equivalent_pct: vals.flour_equivalent_pct || 0,
              },
              ai_notes: vals.notes || '', source: 'AI',
            })
          }
        }
      }
      const fullLibItems = await libLoad()
      const next = { ...data, macroCache: newCache, libData: fullLibItems }
      setData(next); saveData(next)
    } catch (e) {
      console.error('AI macro error:', e)
    } finally {
      setAnalyzingMacros(false)
    }
  }

  async function addCustomParam() {
    if (!newParamLabel.trim()) return
    setAnalyzingCustom(true)
    try {
      const json = await analyzeCustomParam(
        recipe.title,
        (recipe.ingredients || []).map((i) => ({ name: i.name, qty: parseFloat(i.qty) || 0, unit: i.unit || 'g' })),
        macros,
        newParamLabel.trim(),
      )
      const customParams = data.customParams || []
      const next = { ...data, customParams: [...customParams, { label: newParamLabel.trim(), value: json.value, unit: json.unit || '', explanation: json.explanation || '' }] }
      setData(next); saveData(next)
    } catch (e) {
      console.error('addCustomParam error:', e)
    } finally {
      setAnalyzingCustom(false); setAddingParam(false); setNewParamLabel('')
    }
  }
  function removeCustomParam(idx) {
    const cp = [...(data.customParams || [])]; cp.splice(idx, 1)
    const next = { ...data, customParams: cp }; setData(next); saveData(next)
  }

  const tabellaRows = useMemo(() => {
    if (!recipe.ingredients || !recipe.ingredients.length) return []
    const totalG = macros.total || 1
    const flourEqG = macros.flourEqG || 1
    let eggYolkG = 0, sourG = 0, butterG = 0, mclaButter = 0
    for (const ing of recipe.ingredients) {
      const g = parseFloat(ing.qty) || 0
      const t = detectIngType(ing.name)
      if (t === 'egg_yolk') eggYolkG += g
      if (t === 'sourdough') sourG += g
      if (t === 'butter') { butterG += g; mclaButter += g * 0.03 }
    }
    return [
      { label: 'Farina totale impasto + madre', val1: Math.round((flourEqG / totalG) * 1000) / 10, val2: Math.round(flourEqG), unit1: '%', unit2: 'g' },
      { label: 'Zuccheri totali', val1: Math.round((macros.sugar / totalG) * 1000) / 10, val2: Math.round(macros.sugar), unit1: '%', unit2: 'g' },
      { label: 'Idratazione totale impasto', val1: Math.round((macros.freeWaterG / flourEqG) * 1000) / 10, val2: Math.round(macros.freeWaterG), unit1: '%', unit2: 'g' },
      { label: 'Tuorlo totale', val1: Math.round((eggYolkG / totalG) * 1000) / 10, val2: Math.round(eggYolkG), unit1: '%', unit2: 'g' },
      { label: 'Grassi totali', val1: Math.round((macros.fat / totalG) * 1000) / 10, val2: Math.round(macros.fat), unit1: '%', unit2: 'g' },
      { label: 'Grassi MCLA da disciplinare', val1: Math.round((mclaButter / totalG) * 1000) / 10, val2: Math.round(mclaButter), unit1: '%', unit2: 'g' },
      { label: 'Burro totale', val1: null, val2: Math.round(butterG), unit1: '', unit2: 'g' },
      { label: 'Pasta Madre totale', val1: null, val2: Math.round(sourG), unit1: '', unit2: 'g' },
    ]
  }, [recipe.ingredients, macros])

  return (
    <div className="ID-panel">
      <div className="ID-section">
        <div className="ID-section-header" onClick={() => toggleSection('params')}>
          <h3>&#x1F4CA; Macro Parameters</h3>
          <span className="ID-chevron">{openSections.params ? '▲' : '▼'}</span>
        </div>
        {openSections.params && (
          <div className="ID-section-body">
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={runAIMacroAnalysis} disabled={analyzingMacros} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#4f8ef7,#7c3aed)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: analyzingMacros ? 0.6 : 1 }}>
                {analyzingMacros ? 'Analyzing...' : '\u{1F916} AI analyze'}
              </button>
              <button onClick={() => setShowLibPanel(true)} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>
                &#x1F4E6; Library
              </button>
              {(data.macroCache || data.libData) && <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 500 }}>&#x1F916; AI-powered{data.libData && data.libData.length > 0 ? ' · Library active' : ''}</span>}
            </div>

            {[
              { label: "Baker's Hydration", key: 'bakersHydration', unit: '%', max: 100, color: '#4f8ef7' },
              { label: 'Fat', key: 'fat', unit: 'g', max: MAX_VALS.fat, color: '#f7a24f' },
              { label: 'Sugar', key: 'sugar', unit: 'g', max: MAX_VALS.sugar, color: '#f74f9e' },
              { label: 'Salt', key: 'saltG', unit: 'g', max: 5, color: '#4f4f4f' },
              { label: 'Protein', key: 'protein', unit: '%', max: MAX_VALS.protein, color: '#4fb87c' },
              { label: 'Cal', key: 'cal', unit: 'kcal', max: 5000, color: '#f7c54f' },
            ].map(({ label, key, unit, max, color }) => {
              const val = macros[key] || 0
              const pct = Math.min((val / max) * 100, 100)
              return (
                <div key={key} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>{label}</span>
                    <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{val}{unit}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 4, transition: 'width .4s' }} />
                  </div>
                </div>
              )
            })}

            {macros.total > 0 && (
              <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ background: 'var(--hover,#f5f5f5)', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: 0.5 }}>Tabella riassuntiva valori impasto</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <tbody>
                    {tabellaRows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 12px', color: 'var(--text)' }}>{row.label}</td>
                        {row.val1 != null
                          ? <td style={{ padding: '6px 8px', color: 'var(--muted)', textAlign: 'right', fontWeight: 600 }}>{row.val1}{row.unit1}</td>
                          : <td style={{ padding: '6px 8px' }} />}
                        <td style={{ padding: '6px 12px', color: 'var(--accent,#4f8ef7)', textAlign: 'right', fontWeight: 700 }}>{row.val2}{row.unit2}</td>
                      </tr>
                    ))}
                    <tr style={{ background: 'var(--hover,#f5f5f5)' }}>
                      <td style={{ padding: '6px 12px', color: 'var(--text)', fontWeight: 600 }}>Peso totale impasto</td>
                      <td />
                      <td style={{ padding: '6px 12px', color: 'var(--accent,#4f8ef7)', textAlign: 'right', fontWeight: 700 }}>{macros.total} g</td>
                    </tr>
                  </tbody>
                </table>
                {macros.flourEqG > 0 && (
                  <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
                    Equiv farina: <b>{macros.flourEqG}g</b> · Acqua libera: <b>{macros.freeWaterG}g</b> · Idr. panettiere: <b>{macros.bakersHydration}%</b>
                  </div>
                )}
              </div>
            )}

            {(data.customParams || []).map((cp, i) => (
              <div key={i} style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--hover,#f8f8f8)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{cp.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent,#4f8ef7)', marginTop: 2 }}>{cp.value}{cp.unit ? ' ' + cp.unit : ''}</div>
                    {cp.explanation && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>{cp.explanation}</div>}
                  </div>
                  <button onClick={() => removeCustomParam(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, opacity: 0.5, padding: 4 }}>&#x2715;</button>
                </div>
              </div>
            ))}

            {addingParam ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
                <input autoFocus value={newParamLabel} onChange={(e) => setNewParamLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomParam() } if (e.key === 'Escape') { setAddingParam(false); setNewParamLabel('') } }}
                  placeholder="e.g. Gluten development index..." style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }} />
                <button onClick={addCustomParam} disabled={analyzingCustom} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent,#4f8ef7)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: analyzingCustom ? 0.6 : 1 }}>{analyzingCustom ? '..' : 'Analyze'}</button>
                <button onClick={() => { setAddingParam(false); setNewParamLabel('') }} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAddingParam(true)} style={{ marginTop: 10, padding: '5px 12px', borderRadius: 6, border: '1px dashed var(--muted)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>&#x271A; Add parameter</button>
            )}

            {showLibPanel && <IngredientLibraryModal onClose={() => setShowLibPanel(false)} />}
          </div>
        )}
      </div>

      <div className="ID-section">
        <div className="ID-section-header" onClick={() => toggleSection('sensory')}>
          <h3>👅 Sensory Evaluation</h3>
          <span style={{ fontSize: 11, color: 'var(--id)' }}>{openSections.sensory ? '▲' : '▼'}</span>
        </div>
        {openSections.sensory && (
          <div className="ID-section-body">
            <div className="ID-sensory-grid">
              {SENSORY_ATTRS.map((attr) => {
                const val = data.sensory?.[attr] || {}
                return (
                  <div className="ID-sensory-item" key={attr}>
                    <div className="ID-sensory-label">{attr}</div>
                    <div style={{ fontSize: 9.5, color: 'var(--muted)', marginBottom: 4 }}>{SENSORY_LABELS[attr]}</div>
                    <div className="ID-star-row">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className="ID-star" onClick={() => setSensory(attr, 'score', n)} style={{ opacity: val.score >= n ? 1 : 0.25 }}>
                          {attr === 'Overall score' ? '⭐' : '★'}
                        </span>
                      ))}
                      {val.score && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--id)', marginLeft: 4 }}>{val.score}/5</span>}
                    </div>
                    <textarea className="ID-sensory-note" rows={2} value={val.note || ''} onChange={(e) => setSensory(attr, 'note', e.target.value)} placeholder="Notes…" />
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 14, borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--id)', marginBottom: 8 }}>Custom attributes</div>
              <div className="ID-sensory-grid">
                {customAttrs.map((attr) => {
                  const val = data.sensory?.[attr] || {}
                  return (
                    <div className="ID-sensory-item" key={attr} style={{ position: 'relative' }}>
                      <button onClick={() => {
                        const next2 = customAttrs.filter((a) => a !== attr)
                        setCustomAttrs(next2)
                        const nd = { ...data, customSensoryAttrs: next2 }
                        setData(nd); saveData(nd)
                      }} style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--muted)' }}>×</button>
                      <div className="ID-sensory-label">{attr}</div>
                      <div className="ID-star-row">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <span key={n} className="ID-star" onClick={() => setSensory(attr, 'score', n)} style={{ opacity: val.score >= n ? 1 : 0.25 }}>★</span>
                        ))}
                        {val.score && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--id)', marginLeft: 4 }}>{val.score}/5</span>}
                      </div>
                      <textarea className="ID-sensory-note" rows={2} value={val.note || ''} onChange={(e) => setSensory(attr, 'note', e.target.value)} placeholder="Notes…" />
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 7, marginTop: 10, alignItems: 'center' }}>
                <input value={newAttrName} onChange={(e) => setNewAttrName(e.target.value)}
                  placeholder="New attribute name…"
                  style={{ flex: 1, border: '1px solid var(--rule)', borderRadius: 5, padding: '5px 8px', fontSize: 12, fontFamily: 'var(--sans)' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newAttrName.trim()) {
                      const next2 = [...customAttrs, newAttrName.trim()]
                      setCustomAttrs(next2)
                      const nd = { ...data, customSensoryAttrs: next2 }
                      setData(nd); saveData(nd); setNewAttrName('')
                    }
                  }}
                />
                <button className="btn id xs" onClick={() => {
                  if (!newAttrName.trim()) return
                  const next2 = [...customAttrs, newAttrName.trim()]
                  setCustomAttrs(next2)
                  const nd = { ...data, customSensoryAttrs: next2 }
                  setData(nd); saveData(nd); setNewAttrName('')
                }}>＋ Add</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="ID-section">
        <div className="ID-section-header" onClick={() => toggleSection('timeline')}>
          <h3>📅 Version Timeline</h3>
          <span style={{ fontSize: 11, color: 'var(--id)' }}>{openSections.timeline ? '▲' : '▼'}</span>
        </div>
        {openSections.timeline && (
          <div className="ID-section-body">
            <div className="Q-field" style={{ marginBottom: 12 }}>
              <label>Goal / target result</label>
              <textarea rows={2} value={data.goal || ''} onChange={(e) => setGoal(e.target.value)} placeholder="Describe the final desired result: color, texture, flavor profile, volume…" style={{ width: '100%', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', color: 'var(--ink)', resize: 'vertical', background: '#fff' }} />
            </div>
            {(data.versions || []).length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 12 }}>No versions yet. Add one to start tracking your evolution.</div>}
            <div className="ID-timeline">
              {(data.versions || []).map((v, i) => (
                <div className="ID-timeline-item" key={v.id}>
                  <div className={`ID-timeline-dot${i === data.versions.length - 1 ? ' active' : ''}${v.isGoal ? ' goal' : ''}`} />
                  <div className="ID-timeline-card">
                    {v.isGoal && <span className="ID-timeline-badge goal">🎯 Target version</span>}
                    {!v.isGoal && <span className="ID-timeline-badge version">v{i + 1}</span>}
                    <div className="ID-timeline-date">{v.date}</div>
                    <div className="ID-timeline-title">{v.title}</div>
                    {v.notes && <div className="ID-timeline-notes">{v.notes}</div>}
                    <button className="btn danger xs" style={{ marginTop: 6 }} onClick={() => removeVersion(v.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            {addingVersion ? (
              <div style={{ background: '#F8FBFF', border: '1px solid #C8DFF0', borderRadius: 8, padding: 12, marginTop: 10 }}>
                <div className="Q-field"><label>Version name / description</label><input value={newVersion.title} onChange={(e) => setNewVersion((p) => ({ ...p, title: e.target.value }))} placeholder="v3 — reduced sugar 5%, added orange zest" /></div>
                <div className="Q-field"><label>Notes</label><textarea rows={2} value={newVersion.notes} onChange={(e) => setNewVersion((p) => ({ ...p, notes: e.target.value }))} placeholder="What changed? Results?" /></div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer', marginBottom: 10 }}>
                  <input type="checkbox" checked={newVersion.isGoal} onChange={(e) => setNewVersion((p) => ({ ...p, isGoal: e.target.checked }))} /> Mark as target version
                </label>
                <div style={{ display: 'flex', gap: 7 }}>
                  <button className="btn id xs" onClick={addVersion}>Add</button>
                  <button className="btn ghost xs" onClick={() => setAddingVersion(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="btn id xs" style={{ marginTop: 10 }} onClick={() => setAddingVersion(true)}>＋ Add version</button>
            )}
          </div>
        )}
      </div>

      <div className="ID-section">
        <div className="ID-section-header" onClick={() => toggleSection('nutrition')}>
          <h3>🧬 Nutritional Table</h3>
          <span style={{ fontSize: 11, color: 'var(--id)' }}>{openSections.nutrition ? '▲' : '▼'}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', marginLeft: 8 }}>estimated</span>
        </div>
        {openSections.nutrition && (
          <div className="ID-section-body">
            <table className="ID-nutrition-table">
              <thead><tr><th>Nutrient</th><th>Per batch ({macros.total}g)</th><th>Per 100g</th></tr></thead>
              <tbody>
                {[
                  { n: 'Energy (kcal)', v: macros.cal, u: 'kcal' },
                  { n: 'Fat', v: macros.fat, u: 'g' },
                  { n: 'Water', v: macros.water, u: 'g' },
                  { n: 'Carbohydrates', v: macros.carbs, u: 'g' },
                  { n: 'of which sugars', v: macros.sugar, u: 'g' },
                  { n: 'Protein', v: macros.protein, u: 'g' },
                  { n: 'Salt', v: macros.saltG, u: 'g' },
                ].map((r) => (
                  <tr key={r.n}>
                    <td>{r.n}</td>
                    <td><strong>{r.v}</strong> {r.u}</td>
                    <td>{macros.total > 0 ? Math.round((r.v / macros.total) * 1000) / 10 : 0} {r.u}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>* Estimated values based on ingredient type detection. Not for labeling use.</div>
          </div>
        )}
      </div>
    </div>
  )
}
