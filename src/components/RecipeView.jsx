import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookMarked, Bot, Clock, Copy, Download, FileSpreadsheet, FileText, FlaskConical, Globe, Image as ImageIcon, Languages, Loader2,
  MoreHorizontal, NotebookPen, Pencil, Percent, RotateCcw, Save, Scale, Tag, Trash2, Users, UtensilsCrossed,
} from 'lucide-react'
import {
  calcPct, findStepsForIng, getTotalGrams, parseIng, parseSections, scaleRecipe, toGrams,
} from '../lib/recipeCalc.js'
import { parseTabs, serializeTabs } from '../lib/notesData.js'
import { translateRecipe } from '../lib/ai.js'
import { LANGS } from '../lib/constants.js'
import { useSettings } from '../lib/settings.js'
import Menu, { MenuItem, MenuLabel, MenuSep, MenuToggle } from './ui/Menu.jsx'
import { toast } from './ui/Toaster.jsx'
import NotesPanel from './NotesPanel.jsx'
import IDPanel from './IDPanel.jsx'
import AIAssistant from './AIAssistant.jsx'

const TABS = [
  ['recipe', 'Recipe', UtensilsCrossed, 'Recipe'],
  ['notes', 'Notes & media', NotebookPen, 'Notes'],
  ['id', 'R&D', FlaskConical, 'R&D'],
  ['ai', 'Assistant', Bot, 'AI'],
]

export default function RecipeView({ recipe, onEdit, onDelete, onUpdate, allRecipes, onCopy, onSaveVariant }) {
  const { settings, update: updateSettings } = useSettings()
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
  const [targetLang, setTargetLang] = useState(settings.translateLang || 'English')
  const [exporting, setExporting] = useState(false)
  const exportNotes = settings.exportNotes
  const addNoteRef = useRef(null)

  useEffect(() => {
    setChecked(new Set()); setHighlightedSteps(new Set()); setAppliedScale(null); setTranslated(null)
    setShowScale(false); setTab('recipe')
    setCustomBaseGrams('')
  }, [recipe.id])

  const displayR = translated || recipe
  const originalThumbnail = recipe.thumbnail
  const viewR = useMemo(() => (appliedScale ? scaleRecipe(displayR, appliedScale.factor) : displayR), [displayR, appliedScale])
  const sections = useMemo(() => parseSections(viewR.ingredients || []), [viewR])
  const totalGrams = useMemo(() => getTotalGrams(viewR.ingredients || []), [viewR])
  const pctOpts = useMemo(() => ({ showPct, pctMode, pctBase, appliedScaleLabel: appliedScale?.label }), [showPct, pctMode, pctBase, appliedScale])
  const langsOrdered = useMemo(() => [settings.translateLang, ...LANGS.filter((l) => l !== settings.translateLang)].filter(Boolean), [settings.translateLang])

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
      factor = parseFloat(scaleFactor) || 0; if (!factor) return; label = '×' + factor
    } else if (scaleMode === 'ingredient') {
      if (!scaleIngName || !scaleIngGrams) return
      const origIng = (recipe.ingredients || []).find((i) => !/^##?\s+/.test(i) && parseIng(i).name.toLowerCase() === scaleIngName.toLowerCase())
      if (!origIng) { toast.error('Ingredient not found'); return }
      const origG = toGrams(parseIng(origIng).qty, parseIng(origIng).unit)
      if (!origG) { toast.error('That ingredient has no weight to scale from'); return }
      factor = parseFloat(scaleIngGrams) / origG; if (!factor) return
      label = scaleIngName + ': ' + scaleIngGrams + ' g'
    } else {
      const cur = getTotalGrams(recipe.ingredients || [])
      if (!cur) { toast.error('No gram quantities in this recipe — use Multiply instead.'); return }
      let tg = 0
      if (scaleMode === 'pieces') {
        const pc = parseFloat(scalePieces) || 0, g = parseFloat(scaleGpp) || 0
        if (!pc || !g) return
        tg = pc * g; label = pc + ' × ' + g + ' g = ' + tg.toFixed(0) + ' g'
      } else {
        tg = parseFloat(scaleTotal) || 0; if (!tg) return
        label = tg.toFixed(0) + ' g total'
      }
      factor = tg / cur
    }
    setAppliedScale({ factor, label }); setShowScale(false); setChecked(new Set()); setHighlightedSteps(new Set())
  }

  async function translateTo(lang) {
    setTargetLang(lang); setTranslating(true)
    try {
      const result = await translateRecipe(recipe, lang)
      setTranslated({ ...result, thumbnail: recipe.thumbnail, source_photos: recipe.source_photos })
    } catch (e) {
      toast.error('Translation failed: ' + e.message)
    } finally {
      setTranslating(false)
    }
  }

  function saveCurrentAsNew() {
    const label = appliedScale?.label || (translated ? targetLang : null)
    onSaveVariant(viewR, label)
  }

  async function handleAssistantAction(action) {
    switch (action.type) {
      case 'scale': setAppliedScale({ factor: action.factor, label: `AI ×${action.factor}` }); break
      case 'translate':
        setTargetLang(action.language); setTranslating(true)
        try { const r = await translateRecipe(recipe, action.language); setTranslated({ ...r, thumbnail: recipe.thumbnail, source_photos: recipe.source_photos }) }
        catch (e) { toast.error(e.message) }
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

  async function runExport(kind) {
    setExporting(true)
    try {
      if (kind === 'xls') { const { exportXLS } = await import('../export/xlsx.js'); await exportXLS(viewR, pctOpts) }
      if (kind === 'img') { const { exportImage } = await import('../export/image.js'); await exportImage(viewR, pctOpts, exportNotes, originalThumbnail) }
      if (kind === 'pdf') { const { exportPDF } = await import('../export/pdf.js'); await exportPDF(viewR, pctOpts, exportNotes, originalThumbnail) }
    } catch (e) {
      toast.error('Export failed: ' + e.message)
    } finally {
      setExporting(false)
    }
  }

  const pctBaseOpts = useMemo(
    () => (viewR.ingredients || []).filter((i) => !/^##?\s+/.test(i)).map((i) => parseIng(i).name).filter((n, i, a) => n && a.indexOf(n) === i),
    [viewR],
  )
  const copiedFrom = recipe.copied_from ? allRecipes.find((r) => r.id === recipe.copied_from) : null

  const toolbar = (
    <div className="Q-rtools">
      {!appliedScale && (
        <button className={`Q-tool${showScale ? ' on' : ''}`} onClick={() => setShowScale(!showScale)} title="Scale the recipe">
          <Scale size={15} /> Scale
        </button>
      )}
      <button className={`Q-tool${showPct ? ' on' : ''}`} onClick={() => setShowPct(!showPct)} title="Show percentages">
        <Percent size={15} /> Baker's %
      </button>
      <Menu
        align="start" width={210}
        trigger={(p) => (
          <button className={`Q-tool${translated ? ' on' : ''}`} onClick={p.toggle} disabled={translating} title="Translate this view">
            {translating ? <Loader2 size={15} className="spin" /> : <Languages size={15} />} {translating ? 'Translating…' : 'Translate'}
          </button>
        )}
      >
        <MenuLabel>Show this recipe in</MenuLabel>
        {langsOrdered.map((l) => <MenuItem key={l} icon={Globe} checked={translated && targetLang === l} onClick={() => translateTo(l)}>{l}</MenuItem>)}
        {translated && (<><MenuSep /><MenuItem icon={RotateCcw} onClick={() => setTranslated(null)}>Show original</MenuItem></>)}
      </Menu>
      <Menu
        align="start" width={230}
        trigger={(p) => (
          <button className="Q-tool" onClick={p.toggle} disabled={exporting} title="Download">
            {exporting ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Export
          </button>
        )}
      >
        <MenuLabel>Download as</MenuLabel>
        <MenuItem icon={FileText} onClick={() => runExport('pdf')}>PDF document</MenuItem>
        <MenuItem icon={ImageIcon} onClick={() => runExport('img')}>Image (PNG)</MenuItem>
        <MenuItem icon={FileSpreadsheet} onClick={() => runExport('xls')}>Excel sheet</MenuItem>
        <MenuSep />
        <MenuToggle checked={exportNotes} onChange={(v) => updateSettings({ exportNotes: v })}>Include notes</MenuToggle>
      </Menu>
    </div>
  )

  const scalePanel = showScale && (
    <div className="Q-panel-card">
      <div className="Q-panel-card-h">Scale recipe</div>
      <div className="Q-seg wrap">
        {[['factor', 'Multiply'], ['pieces', 'Pieces × weight'], ['total', 'Total weight'], ['ingredient', 'By ingredient']].map(([k, l]) => (
          <button key={k} type="button" className={scaleMode === k ? 'on' : ''} onClick={() => setScaleMode(k)}>{l}</button>
        ))}
      </div>
      {scaleMode === 'factor' && <div className="Q-scale-row"><label>Factor</label><input type="number" value={scaleFactor} onChange={(e) => setScaleFactor(e.target.value)} placeholder="2" min=".01" step=".1" /><span className="Q-dim">× every quantity</span></div>}
      {scaleMode === 'pieces' && <div className="Q-scale-row"><label>Pieces</label><input type="number" value={scalePieces} onChange={(e) => setScalePieces(e.target.value)} placeholder="100" /><span className="Q-dim">×</span><input type="number" value={scaleGpp} onChange={(e) => setScaleGpp(e.target.value)} placeholder="50" /><label>g each</label>{scalePieces && scaleGpp && <span className="Q-strong">= {(parseFloat(scalePieces) * parseFloat(scaleGpp)).toFixed(0)} g</span>}</div>}
      {scaleMode === 'total' && <div className="Q-scale-row"><label>Total</label><input type="number" value={scaleTotal} onChange={(e) => setScaleTotal(e.target.value)} placeholder="2000" /><span className="Q-dim">g · now {getTotalGrams(recipe.ingredients || []).toFixed(0)} g</span></div>}
      {scaleMode === 'ingredient' && (
        <>
          <div className="Q-scale-row">
            <label>Base ingredient</label>
            <select className="Q-select" value={scaleIngName} onChange={(e) => { setScaleIngName(e.target.value); setScaleIngGrams('') }} style={{ flex: 1, minWidth: 0 }}>
              <option value="">Choose…</option>
              {(recipe.ingredients || []).filter((i) => !/^##?\s+/.test(i)).map((ing, i) => { const p = parseIng(ing); const g = toGrams(p.qty, p.unit); return p.name ? <option key={i} value={p.name}>{p.name} ({g > 0 ? g + ' g' : p.qty || '?'})</option> : null })}
            </select>
          </div>
          {scaleIngName && (() => {
            const origIng = (recipe.ingredients || []).find((i) => !/^##?\s+/.test(i) && parseIng(i).name.toLowerCase() === scaleIngName.toLowerCase())
            const origG = origIng ? toGrams(parseIng(origIng).qty, parseIng(origIng).unit) : 0
            return (
              <div className="Q-scale-row">
                <label>I have</label>
                <input type="number" value={scaleIngGrams} onChange={(e) => setScaleIngGrams(e.target.value)} placeholder={String(origG) || 'g'} />
                <span className="Q-dim">g of {scaleIngName}</span>
                {origG > 0 && scaleIngGrams && <span className="Q-strong">×{(parseFloat(scaleIngGrams) / origG).toFixed(3)}</span>}
              </div>
            )
          })()}
        </>
      )}
      <div className="Q-panel-card-foot"><button className="btn primary sm" onClick={applyScale}>Apply</button><button className="btn ghost sm" onClick={() => setShowScale(false)}>Cancel</button></div>
    </div>
  )

  const pctBar = showPct && (
    <div className="Q-pct-bar">
      <label>Percent of</label>
      <select className="Q-select" value={pctMode} onChange={(e) => setPctMode(e.target.value)}>
        <option value="baker">Flour = 100% (baker's)</option>
        <option value="mass">Total mass</option>
        <option value="custom">Chosen ingredient</option>
      </select>
      {pctMode === 'custom' && (
        <>
          <select className="Q-select" value={pctBase} onChange={(e) => { setPctBase(e.target.value); setCustomBaseGrams('') }}>
            <option value="">Select ingredient…</option>
            {pctBaseOpts.map((n) => <option key={n}>{n}</option>)}
          </select>
          {pctBase && (
            <span className="Q-scale-row">
              <span className="Q-dim">as</span>
              <input
                type="number" value={customBaseGrams} onChange={(e) => setCustomBaseGrams(e.target.value)}
                placeholder={String(toGrams(...(() => { const p = parseIng((viewR.ingredients || []).find((i) => i.toLowerCase().includes(pctBase.toLowerCase())) || ''); return [p.qty, p.unit] })())) || 'g'}
              />
              <span className="Q-dim">g</span>
              {customBaseGrams && <button className="Q-link" onClick={() => setCustomBaseGrams('')}>reset</button>}
            </span>
          )}
        </>
      )}
    </div>
  )

  const ingredientsBlock = (
    <section className="Q-rsec">
      <div className="Q-rsec-h">
        <span>Ingredients</span>
        {checked.size > 0 && <button className="Q-link" onClick={() => { setChecked(new Set()); setHighlightedSteps(new Set()) }}>Clear {checked.size} ticked</button>}
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
                    <span className="Q-ing-check" aria-hidden="true" />
                    {mm ? <><span className="Q-ing-qty">{mm[1].trim()}</span><span className="Q-ing-name">{mm[2].trim()}</span></> : <span className="Q-ing-name wide">{ing}</span>}
                    {pct?.pct != null && <span className={`Q-pct-badge${pct.isBase ? ' base' : ''}`}>{pct.pct.toFixed(1)}%</span>}
                  </li>
                )
              })}
            </ul>
            {sec.name && secG > 0 && <div className="Q-subtotal">{secG.toFixed(0)} g</div>}
          </div>
        )
      })}
      {totalGrams > 0 && <div className="Q-grand-total"><span>Total</span>{totalGrams.toFixed(0)} g</div>}
    </section>
  )

  const methodBlock = (viewR.steps?.length > 0 || viewR.notes) && (
    <section className="Q-rsec">
      {viewR.steps?.length > 0 && (
        <>
          <div className="Q-rsec-h">
            <span>Method</span>
            {highlightedSteps.size > 0 && <em className="Q-hl-note">{highlightedSteps.size === 1 ? '1 step uses' : `${highlightedSteps.size} steps use`} the ticked ingredients</em>}
          </div>
          <ol className="Q-steps">{viewR.steps.map((s, i) => (String(s).trim() ? <li key={i} className={highlightedSteps.has(i) ? 'highlighted' : ''}>{s}</li> : null))}</ol>
        </>
      )}
      {viewR.notes && <div className="Q-baker-note"><b>Notes</b>{viewR.notes}</div>}
    </section>
  )

  const recipeContent = (
    <div>
      {toolbar}
      {scalePanel}
      {pctBar}
      <div className={`Q-rbody${settings.layout === 'split' ? ' split' : ''}`}>
        {ingredientsBlock}
        {methodBlock}
      </div>
      {recipe.source_photos?.length > 0 && (
        <section className="Q-rsec">
          <div className="Q-rsec-h"><span>Source photos</span></div>
          <div className="Q-src-photos">{recipe.source_photos.map((src, i) => <img key={i} src={src} onClick={() => setLightboxSrc(src)} alt="" />)}</div>
        </section>
      )}
    </div>
  )

  return (
    <div className="Q-view">
      <div className="Q-view-header">
        <div className="Q-view-title">
          <h1>{viewR.title || 'Untitled'}</h1>
          <div className="Q-meta">
            {viewR.category && <span className="Q-meta-chip"><Tag size={13} />{viewR.category}</span>}
            {viewR.time && <span className="Q-meta-item"><Clock size={14} />{viewR.time}</span>}
            {viewR.servings && <span className="Q-meta-item"><Users size={14} />{viewR.servings}</span>}
            {viewR.source && <span className="Q-meta-item muted"><BookMarked size={14} />{viewR.source}</span>}
          </div>
        </div>
        {recipe.thumbnail && <img src={recipe.thumbnail} className="Q-recipe-thumb" onClick={() => setLightboxSrc(recipe.thumbnail)} alt={recipe.title} />}
      </div>

      {(appliedScale || translated || recipe.fixed_lang || copiedFrom) && (
        <div className="Q-banners">
          {appliedScale && (
            <div className="Q-banner scale">
              <Scale size={14} /> Scaled {appliedScale.label}
              <span className="sp" />
              <button onClick={saveCurrentAsNew}><Save size={13} /> Save as new</button>
              <button onClick={() => { setAppliedScale(null); setChecked(new Set()); setHighlightedSteps(new Set()) }}><RotateCcw size={13} /> Reset</button>
            </div>
          )}
          {translated && (
            <div className="Q-banner trans">
              <Languages size={14} /> Showing in {targetLang}
              <span className="sp" />
              {!appliedScale && <button onClick={saveCurrentAsNew}><Save size={13} /> Save as new</button>}
              <button onClick={() => setTranslated(null)}><RotateCcw size={13} /> Original</button>
            </div>
          )}
          {recipe.fixed_lang && <div className="Q-banner copy"><Globe size={14} /> {recipe.fixed_lang} version</div>}
          {copiedFrom && <div className="Q-banner plain"><Copy size={14} /> Copy of <b>{copiedFrom.title}</b></div>}
        </div>
      )}

      <div className="Q-tabbar">
        <div className="Q-tabs" role="tablist">
          {TABS.map(([k, l, Icon, short]) => (
            <button key={k} role="tab" aria-selected={tab === k} aria-label={l} className={`Q-tab-btn${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
              <Icon size={15} /><span className="full">{l}</span><span className="short">{short}</span>
            </button>
          ))}
        </div>
        <div className="Q-tabbar-actions">
          <button className="btn ghost sm" onClick={onEdit} title="Edit recipe"><Pencil size={14} /><span className="lbl">Edit</span></button>
          <Menu
            width={240}
            trigger={(p) => <button className="Q-icon-btn" onClick={p.toggle} aria-label="More actions" title="More actions"><MoreHorizontal size={18} /></button>}
          >
            <MenuItem icon={Copy} onClick={() => onCopy(recipe, null)}>Duplicate</MenuItem>
            <MenuLabel>Duplicate as a translated copy</MenuLabel>
            <div className="Q-menu-scroll short">
              {langsOrdered.map((l) => <MenuItem key={l} icon={Globe} onClick={() => onCopy(recipe, l)}>{l}</MenuItem>)}
            </div>
            <MenuSep />
            <MenuItem icon={Trash2} danger onClick={onDelete}>Delete recipe</MenuItem>
          </Menu>
        </div>
      </div>

      {tab === 'recipe' && recipeContent}
      {tab === 'notes' && <NotesPanel recipe={recipe} onSave={handleSaveNotes} onSaveMedia={handleSaveMedia} onAddNote={addNoteRef} />}
      {tab === 'id' && <IDPanel recipe={recipe} onSave={handleSaveIdData} allRecipes={allRecipes} />}
      {tab === 'ai' && <AIAssistant recipe={viewR} onAction={handleAssistantAction} onRequestSaveNote={handleRequestSaveNote} />}
      {lightboxSrc && <div className="Q-lightbox" onClick={() => setLightboxSrc(null)}><img src={lightboxSrc} alt="" /></div>}
    </div>
  )
}
