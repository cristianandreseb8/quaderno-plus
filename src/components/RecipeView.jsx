import { useEffect, useMemo, useRef, useState } from 'react'
import {
  calcPct, findStepsForIng, getTotalGrams, parseIng, parseSections, scaleRecipe, toGrams,
} from '../lib/recipeCalc.js'
import { parseTabs, serializeTabs } from '../lib/notesData.js'
import { translateRecipe } from '../lib/ai.js'
import { LANGS } from '../lib/constants.js'
import NotesPanel from './NotesPanel.jsx'
import IDPanel from './IDPanel.jsx'
import AIAssistant from './AIAssistant.jsx'

export default function RecipeView({ recipe, onEdit, onDelete, onUpdate, allRecipes, onCopy, onSaveVariant }) {
  const [tab, setTab] = useState('recipe')
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const [checked, setChecked] = useState(new Set())
  const [highlightedSteps, setHighlightedSteps] = useState(new Set())
  const [showPct, setShowPct] = useState(false)
  const [customBaseGrams, setCustomBaseGrams] = useState('')
  const [pctMode, setPctMode] = useState('baker')
  const [pctBase, setPctBase] = useState('')
  const [showScale, setShowScale] = useState(false)
  const [scaleMode, setScaleMode] = useState('factor')
  const [scaleFactor, setScaleFactor] = useState('2')
  const [scalePieces, setScalePieces] = useState('')
  const [scaleGpp, setScaleGpp] = useState('')
  const [scaleTotal, setScaleTotal] = useState('')
  const [scaleIngName, setScaleIngName] = useState('')
  const [scaleIngGrams, setScaleIngGrams] = useState('')
  const [appliedScale, setAppliedScale] = useState(null)
  const [translating, setTranslating] = useState(false)
  const [translated, setTranslated] = useState(null)
  const [targetLang, setTargetLang] = useState('English')
  const [transErr, setTransErr] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportNotes, setExportNotes] = useState(false)
  const [showCopyLangMenu, setShowCopyLangMenu] = useState(false)
  const addNoteRef = useRef(null)

  useEffect(() => {
    setChecked(new Set()); setHighlightedSteps(new Set()); setAppliedScale(null); setTranslated(null)
    setShowScale(false); setTab('recipe'); setShowCopyLangMenu(false)
    setCustomBaseGrams('')
  }, [recipe.id])

  const displayR = translated || recipe
  const originalThumbnail = recipe.thumbnail
  const viewR = useMemo(() => (appliedScale ? scaleRecipe(displayR, appliedScale.factor) : displayR), [displayR, appliedScale])
  const sections = useMemo(() => parseSections(viewR.ingredients || []), [viewR])
  const totalGrams = useMemo(() => getTotalGrams(viewR.ingredients || []), [viewR])
  const pctOpts = useMemo(() => ({ showPct, pctMode, pctBase, appliedScaleLabel: appliedScale?.label }), [showPct, pctMode, pctBase, appliedScale])

  function handleIngToggle(rawIdx) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(rawIdx)) next.delete(rawIdx); else next.add(rawIdx)
      const names = []
      ;(viewR.ingredients || []).forEach((ing, i) => { if (next.has(i) && !/^##?\s+/.test(ing)) names.push(parseIng(ing).name) })
      const steps = new Set()
      names.forEach((n) => findStepsForIng(n, viewR.steps || []).forEach((i) => steps.add(i)))
      setHighlightedSteps(steps)
      return next
    })
  }

  function applyScale() {
    let factor = 0, label = ''
    if (scaleMode === 'factor') {
      factor = parseFloat(scaleFactor) || 0; if (!factor) return; label = 'x' + factor
    } else if (scaleMode === 'ingredient') {
      if (!scaleIngName || !scaleIngGrams) return
      const origIng = (recipe.ingredients || []).find((i) => !/^##?\s+/.test(i) && parseIng(i).name.toLowerCase() === scaleIngName.toLowerCase())
      if (!origIng) { alert('Ingredient not found'); return }
      const origG = toGrams(parseIng(origIng).qty, parseIng(origIng).unit)
      if (!origG) { alert('No calculable grams for this ingredient'); return }
      factor = parseFloat(scaleIngGrams) / origG; if (!factor) return
      label = scaleIngName + ': ' + scaleIngGrams + 'g'
    } else {
      const cur = getTotalGrams(recipe.ingredients || [])
      if (!cur) { alert('No gram quantities. Use Multiply mode.'); return }
      let tg = 0
      if (scaleMode === 'pieces') {
        const pc = parseFloat(scalePieces) || 0, g = parseFloat(scaleGpp) || 0
        if (!pc || !g) return
        tg = pc * g; label = pc + 'x' + g + 'g=' + tg.toFixed(0) + 'g'
      } else {
        tg = parseFloat(scaleTotal) || 0; if (!tg) return
        label = tg.toFixed(0) + 'g'
      }
      factor = tg / cur
    }
    setAppliedScale({ factor, label }); setShowScale(false); setChecked(new Set()); setHighlightedSteps(new Set())
  }

  async function handleTranslate() {
    setTranslating(true); setTransErr('')
    try {
      const result = await translateRecipe(recipe, targetLang)
      setTranslated({ ...result, thumbnail: recipe.thumbnail, source_photos: recipe.source_photos })
    } catch (e) {
      setTransErr('Failed: ' + e.message)
    } finally {
      setTranslating(false)
    }
  }

  async function handleCopyWithLang(lang) { setShowCopyLangMenu(false); onCopy(recipe, lang || null) }

  function saveCurrentAsNew() {
    const label = appliedScale?.label || (translated ? targetLang : null)
    onSaveVariant(viewR, label)
  }

  async function handleAssistantAction(action) {
    switch (action.type) {
      case 'scale': setAppliedScale({ factor: action.factor, label: `AI ×${action.factor}` }); break
      case 'translate':
        setTranslating(true)
        try { const r = await translateRecipe(recipe, action.language); setTranslated({ ...r, thumbnail: recipe.thumbnail, source_photos: recipe.source_photos }) }
        catch (e) { setTransErr(e.message) }
        finally { setTranslating(false) }
        break
      case 'update_field': await onUpdate({ ...recipe, [action.field]: action.value }); break
      case 'update_ingredients': await onUpdate({ ...recipe, ingredients: action.ingredients }); break
      case 'update_steps': await onUpdate({ ...recipe, steps: action.steps }); break
      case 'add_note': if (addNoteRef.current) addNoteRef.current(action.content); break
    }
  }

  async function handleRequestSaveNote(content) {
    try {
      const tabs = parseTabs(recipe.notes_pad)
      const updated = tabs.map((t, i) => (i === 0 ? { ...t, content: t.content + (t.content ? '\n\n' : '') + content } : t))
      await onUpdate({ ...recipe, notes_pad: serializeTabs(updated) })
    } catch (e) {
      console.error('Save note:', e)
    }
    setTab('notes')
  }
  async function handleSaveNotes(serialized) { await onUpdate({ ...recipe, notes_pad: serialized }) }
  async function handleSaveMedia(serialized) { await onUpdate({ ...recipe, media_library: serialized }) }
  async function handleSaveIdData(serialized) { await onUpdate({ ...recipe, id_data: serialized }) }

  async function doExportXLS() {
    const { exportXLS } = await import('../export/xlsx.js')
    exportXLS(viewR, pctOpts)
  }
  async function doExportImage() {
    setExporting(true)
    try {
      const { exportImage } = await import('../export/image.js')
      await exportImage(viewR, pctOpts, exportNotes, originalThumbnail)
    } finally {
      setExporting(false)
    }
  }
  async function doExportPDF() {
    const { exportPDF } = await import('../export/pdf.js')
    exportPDF(viewR, pctOpts, exportNotes, originalThumbnail)
  }

  const pctBaseOpts = useMemo(
    () => (viewR.ingredients || []).filter((i) => !/^##?\s+/.test(i)).map((i) => parseIng(i).name).filter((n, i, a) => n && a.indexOf(n) === i),
    [viewR],
  )

  const recipeContent = (
    <div>
      <div className="Q-toolbar">
        {!appliedScale && <button className={`btn xs ${showScale ? 'amber' : 'ghost'}`} onClick={() => setShowScale(!showScale)}>⚖ Scale</button>}
        <button className={`btn xs ${showPct ? 'amber' : 'ghost'}`} onClick={() => setShowPct(!showPct)}>% Baker's</button>
        <select style={{ border: '1px solid var(--rule)', borderRadius: 5, padding: '4px 7px', fontSize: 11.5, fontFamily: 'var(--mono)', background: '#fff', color: 'var(--ink)' }} value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
          {LANGS.map((l) => <option key={l}>{l}</option>)}
        </select>
        <button className="btn xs green" onClick={handleTranslate} disabled={translating}>{translating ? '…' : `🌐 ${targetLang}`}</button>
        {transErr && <span style={{ color: '#9b2c2c', fontSize: 10 }}>{transErr}</span>}
        <div className="right">
          <button className="btn amber xs" onClick={doExportXLS}>↓ XLS</button>
          <button className="btn amber xs" disabled={exporting} onClick={doExportImage}>↓ IMG</button>
          <button className="btn amber xs" onClick={doExportPDF}>↓ PDF</button>
        </div>
      </div>
      <div className="Q-export-opts">
        <label><input type="checkbox" checked={exportNotes} onChange={(e) => setExportNotes(e.target.checked)} /> Include notes in PDF/Image</label>
        {(appliedScale || translated) && (
          <button className="btn green xs" onClick={saveCurrentAsNew} title="Save the current scaled/translated numbers as a new recipe">
            💾 Save as new recipe
          </button>
        )}
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <button className="btn teal xs" onClick={() => setShowCopyLangMenu((p) => !p)}>📋 Copy recipe</button>
          {showCopyLangMenu && (
            <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#fff', border: '1px solid var(--rule)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', zIndex: 50, minWidth: 200, padding: 8 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--muted)', padding: '4px 8px 8px' }}>Copy as…</div>
              <button onClick={() => handleCopyWithLang(null)} style={{ width: '100%', textAlign: 'left', padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--rule)' }}>📋 Plain copy (same language)</button>
              {LANGS.map((l) => (
                <button key={l} onClick={() => handleCopyWithLang(l)} style={{ width: '100%', textAlign: 'left', padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--navy)' }}>🌐 {l} version (fixed)</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {showScale && (
        <div className="Q-scale-panel">
          <h4>Scale recipe</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {[['factor', '× Multiply'], ['pieces', 'Pieces × g/piece'], ['total', 'Total weight'], ['ingredient', 'By ingredient']].map(([k, l]) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}><input type="radio" checked={scaleMode === k} onChange={() => setScaleMode(k)} />{l}</label>
            ))}
          </div>
          {scaleMode === 'factor' && <div className="Q-scale-row"><label>Factor</label><input type="number" value={scaleFactor} onChange={(e) => setScaleFactor(e.target.value)} placeholder="2" min=".01" step=".1" /><span style={{ fontSize: 11, color: 'var(--muted)' }}>× all quantities</span></div>}
          {scaleMode === 'pieces' && <div className="Q-scale-row"><label>Piezas</label><input type="number" value={scalePieces} onChange={(e) => setScalePieces(e.target.value)} placeholder="100" /><span style={{ fontSize: 11, color: 'var(--muted)' }}>×</span><input type="number" value={scaleGpp} onChange={(e) => setScaleGpp(e.target.value)} placeholder="50" /><label>g/pieza</label>{scalePieces && scaleGpp && <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--navy)', fontWeight: 700 }}>= {(parseFloat(scalePieces) * parseFloat(scaleGpp)).toFixed(0)} g total</span>}</div>}
          {scaleMode === 'total' && <div className="Q-scale-row"><label>Total</label><input type="number" value={scaleTotal} onChange={(e) => setScaleTotal(e.target.value)} placeholder="2000" /><span style={{ fontSize: 11, color: 'var(--muted)' }}>g · current: {getTotalGrams(recipe.ingredients || []).toFixed(0)}g</span></div>}
          {scaleMode === 'ingredient' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="Q-scale-row">
                <label>Base ingredient</label>
                <select value={scaleIngName} onChange={(e) => { setScaleIngName(e.target.value); setScaleIngGrams('') }} style={{ flex: 1, border: '1px solid var(--rule)', borderRadius: 5, padding: '5px 8px', fontSize: 12, fontFamily: 'var(--mono)', background: '#fff' }}>
                  <option value="">choose ingredient</option>
                  {(recipe.ingredients || []).filter((i) => !/^##?\s+/.test(i)).map((ing, i) => { const p = parseIng(ing); const g = toGrams(p.qty, p.unit); return p.name ? <option key={i} value={p.name}>{p.name} ({g > 0 ? g + 'g' : p.qty || '?'})</option> : null })}
                </select>
              </div>
              {scaleIngName && (() => {
                const origIng = (recipe.ingredients || []).find((i) => !/^##?\s+/.test(i) && parseIng(i).name.toLowerCase() === scaleIngName.toLowerCase())
                const origG = origIng ? toGrams(parseIng(origIng).qty, parseIng(origIng).unit) : 0
                return (
                  <div className="Q-scale-row">
                    <label>I have</label>
                    <input type="number" value={scaleIngGrams} onChange={(e) => setScaleIngGrams(e.target.value)} placeholder={String(origG) || 'g'} style={{ width: 90 }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>g of {scaleIngName}</span>
                    {origG > 0 && scaleIngGrams && <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--navy)', fontWeight: 700 }}>factor: x{(parseFloat(scaleIngGrams) / origG).toFixed(3)}</span>}
                  </div>
                )
              })()}
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>All ingredients scale proportionally.</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 7 }}><button className="btn amber xs" onClick={applyScale}>Apply</button><button className="btn ghost xs" onClick={() => setShowScale(false)}>Cancel</button></div>
        </div>
      )}
      {showPct && (
        <div className="Q-pct-bar">
          <label>% Basis:</label>
          <select value={pctMode} onChange={(e) => setPctMode(e.target.value)}>
            <option value="baker">Baker's % (flour=100%)</option>
            <option value="mass">Total mass %</option>
            <option value="custom">Custom base</option>
          </select>
          {pctMode === 'custom' && (
            <>
              <select value={pctBase} onChange={(e) => { setPctBase(e.target.value); setCustomBaseGrams('') }}>
                <option value="">— select ingredient —</option>
                {pctBaseOpts.map((n) => <option key={n}>{n}</option>)}
              </select>
              {pctBase && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Override grams:</span>
                  <input
                    type="number"
                    value={customBaseGrams}
                    onChange={(e) => setCustomBaseGrams(e.target.value)}
                    placeholder={String(toGrams(...(() => { const p = parseIng((viewR.ingredients || []).find((i) => i.toLowerCase().includes(pctBase.toLowerCase())) || ''); return [p.qty, p.unit] })())) || 'g'}
                    style={{ width: 72, border: '1px solid var(--amber)', borderRadius: 5, padding: '3px 6px', fontFamily: 'var(--mono)', fontSize: 12 }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>g</span>
                  {customBaseGrams && <button onClick={() => setCustomBaseGrams('')} style={{ fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>reset</button>}
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.18em', color: 'var(--navy)', marginBottom: 7 }}>
        Ingredients{checked.size > 0 && <button style={{ marginLeft: 10, fontFamily: 'var(--mono)', fontSize: 9, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', textDecoration: 'underline' }} onClick={() => { setChecked(new Set()); setHighlightedSteps(new Set()) }}>clear</button>}
      </div>
      {sections.map((sec, si) => {
        const pctData = showPct ? calcPct(sec.items, pctMode, pctBase, customBaseGrams ? parseFloat(customBaseGrams) : null) : null
        const secG = sec.items.reduce((s, ing) => { const p = parseIng(ing); return s + toGrams(p.qty, p.unit) }, 0)
        return (
          <div key={si}>
            {sec.name && <div className="Q-sec-h"><span>{sec.name}</span></div>}
            <ul className="Q-ings">
              {sec.items.map((ing, ii) => {
                const rawIdx = sec.rawIndices[ii], isCk = checked.has(rawIdx)
                const mm = String(ing).match(/^([\d.,]+\s*[^\s]+)\s{2,}(.+)$/) || String(ing).match(/^([\d.,]+\s*[a-zA-Z%]+)\s+(.+)$/)
                const pct = pctData ? pctData[ii] : null
                return (
                  <li key={ii} className={`Q-ing-row${isCk ? ' checked' : ''}`} onClick={() => handleIngToggle(rawIdx)}>
                    <span className="Q-ing-check">{isCk ? '✓' : '○'}</span>
                    {mm ? <><span className="Q-ing-qty">{mm[1].trim()}</span><span className="Q-ing-name">{mm[2].trim()}</span></> : <span className="Q-ing-name" style={{ flex: 1 }}>{ing}</span>}
                    {pct?.pct != null && <span className={`Q-pct-badge${pct.isBase ? ' base' : ''}`}>{pct.pct.toFixed(1)}%</span>}
                  </li>
                )
              })}
            </ul>
            {sec.name && secG > 0 && <div className="Q-subtotal">{sec.name}: {secG.toFixed(0)} g</div>}
          </div>
        )
      })}
      {totalGrams > 0 && <div className="Q-grand-total">Total: {totalGrams.toFixed(0)} g</div>}
      {viewR.steps?.length > 0 && (
        <>
          <div className="Q-steps-label">Method{highlightedSteps.size > 0 && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--amber)', marginLeft: 10 }}>{highlightedSteps.size} step{highlightedSteps.size > 1 ? 's' : ''} highlighted</span>}</div>
          <ol className="Q-steps">{viewR.steps.map((s, i) => <li key={i} className={highlightedSteps.has(i) ? 'highlighted' : ''}>{s}</li>)}</ol>
        </>
      )}
      {viewR.notes && <div className="Q-baker-note">{viewR.notes}</div>}
      {recipe.source_photos?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.16em', color: 'var(--muted)', marginBottom: 7 }}>Source photos</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{recipe.source_photos.map((src, i) => <img key={i} src={src} style={{ height: 64, borderRadius: 5, cursor: 'pointer', border: '1px solid var(--rule)' }} onClick={() => setLightboxSrc(src)} alt="" />)}</div>
        </div>
      )}
      <div className="Q-view-foot"><button className="btn" onClick={onEdit}>Edit</button><button className="btn danger" onClick={onDelete}>Delete</button></div>
    </div>
  )

  return (
    <div className="Q-view">
      <div className="Q-view-header">
        <h1>{viewR.title || 'Untitled'}</h1>
        {recipe.thumbnail && <img src={recipe.thumbnail} className="Q-recipe-thumb" onClick={() => setLightboxSrc(recipe.thumbnail)} alt={recipe.title} />}
      </div>
      {appliedScale && <div className="Q-banner scale">⚖ Scaled — {appliedScale.label}<button onClick={() => { setAppliedScale(null); setChecked(new Set()); setHighlightedSteps(new Set()) }}>Reset</button></div>}
      {translated && <div className="Q-banner trans">🌐 {targetLang} translation (thumbnail preserved)<button onClick={() => setTranslated(null)}>Original</button></div>}
      {recipe.fixed_lang && <div className="Q-banner copy">📌 Fixed language version — {recipe.fixed_lang}</div>}
      {recipe.copied_from && <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--muted)', marginBottom: 8 }}>📋 Copy of: {allRecipes.find((r) => r.id === recipe.copied_from)?.title || recipe.copied_from}</div>}
      <dl className="Q-meta">
        {viewR.category && <div className="Q-meta-item"><dt>Category</dt><dd>{viewR.category}</dd></div>}
        {viewR.time && <div className="Q-meta-item"><dt>Time</dt><dd>{viewR.time}</dd></div>}
        {viewR.servings && <div className="Q-meta-item"><dt>Yield</dt><dd>{viewR.servings}</dd></div>}
        {viewR.source && <div className="Q-meta-item"><dt>Source</dt><dd>{viewR.source}</dd></div>}
      </dl>
      <div className="Q-tabs">
        {[['recipe', '📖 Recipe'], ['notes', '📝 Notes & Media'], ['id', '🔬 I+D'], ['ai', '🤖 AI']].map(([k, l]) => (
          <button key={k} className={`Q-tab-btn${tab === k ? ' active' : ''}${k === 'ai' ? ' ai-tab' : ''}${k === 'id' ? ' id-tab' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'recipe' && recipeContent}
      {tab === 'notes' && <NotesPanel recipe={recipe} onSave={handleSaveNotes} onSaveMedia={handleSaveMedia} onAddNote={addNoteRef} />}
      {tab === 'id' && <IDPanel recipe={recipe} onSave={handleSaveIdData} />}
      {tab === 'ai' && <AIAssistant recipe={viewR} onAction={handleAssistantAction} onRequestSaveNote={handleRequestSaveNote} />}
      {lightboxSrc && <div className="Q-lightbox" onClick={() => setLightboxSrc(null)}><img src={lightboxSrc} alt="" /></div>}
    </div>
  )
}
