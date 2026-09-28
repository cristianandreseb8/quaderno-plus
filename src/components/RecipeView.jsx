import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Globe, Loader2, Lock, MoreHorizontal, Users } from 'lucide-react'
import {
  calcPct, findStepsForIng, fmtQty, getTotalGrams, ingGrams, lineGrams, numberSteps, parseIng, parseSections, scaleRecipe, sectionGrams, splitIngLine,
} from '../lib/recipeCalc.js'
import { parseTabs, serializeTabs } from '../lib/notesData.js'
import { parseMediaLibrary } from '../lib/media.js'
import { translateRecipe } from '../lib/ai.js'
import { VISIBILITY } from '../lib/sharing.js'
import { LANGS } from '../lib/constants.js'
import { normalizeBlocks, useSettings } from '../lib/settings.js'
import Menu, { MenuItem, MenuSep, MenuToggle } from './ui/Menu.jsx'
import { toast } from './ui/Toaster.jsx'
import Blocks from './ui/Blocks.jsx'
import VideoBlock from './VideoBlock.jsx'
import NotesPanel from './NotesPanel.jsx'
import AIAssistant from './AIAssistant.jsx'
import { TimerChip, TimerMenu, TimerPresets } from './Timers.jsx'
import { findDurations } from '../lib/durations.js'

const TABS = [
  ['recipe', 'Recipe'],
  ['notes', 'Notes'],
  ['ai', 'Assistant'],
]

export default function RecipeView({
  recipe, onEdit, onDelete, onUpdate, allRecipes, onCopy, onSaveVariant, inSession, onToggleSession,
  canEdit: canEditProp = true, ownerName = null, onShare = null, guest = false,
  isFavorite = false, onToggleFavorite = null, liked = false, onToggleLike = null, collections = [], onToggleCollection = null,
  // In a cooking session: { factor, progress: { ing, steps }, onFactor, onToggleIng, onToggleStep, onClear, onOpenRecipe, onRemove }.
  // Ticks and the batch size are then the session's — saved, and shared with its shopping list.
  cook = null,
}) {
  const canEdit = canEditProp && !guest
  const { settings, update: updateSettings } = useSettings()
  const [tab, setTab] = useState('recipe')
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const [localChecked, setLocalChecked] = useState(new Set())
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
  const [localScale, setLocalScale] = useState(null)
  const [translating, setTranslating] = useState(false)
  const [translated, setTranslated] = useState(null)
  const [targetLang, setTargetLang] = useState(settings.translateLang || 'English')
  const [exporting, setExporting] = useState(false)
  const [menuView, setMenuView] = useState('main') // main | translate | export | copy | collections | timer
  const [addingVideo, setAddingVideo] = useState(false)
  const exportNotes = settings.exportNotes
  const addNoteRef = useRef(null)

  useEffect(() => {
    setLocalChecked(new Set()); setLocalScale(null); setTranslated(null)
    setShowScale(false); setTab('recipe'); setAddingVideo(false)
    setCustomBaseGrams('')
  }, [recipe.id])

  const cookIng = cook?.progress?.ing
  const inCook = !!cook
  const checked = useMemo(() => (inCook ? new Set(cookIng || []) : localChecked), [inCook, cookIng, localChecked])
  const cookFactor = cook ? Number(cook.factor) || 1 : 1
  const appliedScale = cook ? (cookFactor !== 1 ? { factor: cookFactor, label: '×' + +cookFactor.toFixed(2) } : null) : localScale
  function setAppliedScale(s) {
    if (cook) cook.onFactor(s ? s.factor : 1)
    else { setLocalScale(s); setLocalChecked(new Set()) }
  }
  function clearTicked() {
    if (cook) cook.onClear('ing'); else setLocalChecked(new Set())
  }

  const displayR = translated || recipe
  const originalThumbnail = recipe.thumbnail
  const viewR = useMemo(() => (appliedScale ? scaleRecipe(displayR, appliedScale.factor) : displayR), [displayR, appliedScale])
  const sections = useMemo(() => parseSections(viewR.ingredients || []), [viewR])
  const totalGrams = useMemo(() => getTotalGrams(viewR.ingredients || []), [viewR])
  const pctOpts = useMemo(() => ({ showPct, pctMode, pctBase, appliedScaleLabel: appliedScale?.label }), [showPct, pctMode, pctBase, appliedScale])
  const langsOrdered = useMemo(() => [settings.translateLang, ...LANGS.filter((l) => l !== settings.translateLang)].filter(Boolean), [settings.translateLang])

  function handleIngToggle(rawIdx) {
    if (cook) { cook.onToggleIng(rawIdx); return }
    setLocalChecked((prev) => {
      const next = new Set(prev)
      if (next.has(rawIdx)) next.delete(rawIdx); else next.add(rawIdx)
      return next
    })
  }
  // Outside a session, ticking an ingredient lights up the steps that use it. In a session the
  // ticks mean "weighed and ready", and the steps show their own progress instead.
  const highlightedSteps = useMemo(() => {
    const steps = new Set()
    if (inCook) return steps
    ;(viewR.ingredients || []).forEach((ing, i) => {
      if (checked.has(i) && !/^##?\s+/.test(ing)) findStepsForIng(parseIng(ing).name, viewR.steps || []).forEach((st) => steps.add(st))
    })
    return steps
  }, [inCook, checked, viewR])

  function applyScale() {
    let factor = 0, label = ''
    if (scaleMode === 'factor') {
      factor = parseFloat(scaleFactor) || 0; if (!factor) return; label = '×' + factor
    } else if (scaleMode === 'ingredient') {
      if (!scaleIngName || !scaleIngGrams) return
      const origIng = (recipe.ingredients || []).find((i) => !/^##?\s+/.test(i) && parseIng(i).name.toLowerCase() === scaleIngName.toLowerCase())
      if (!origIng) { toast.error('Ingredient not found'); return }
      const origG = lineGrams(origIng)
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
    setAppliedScale({ factor, label }); setShowScale(false)
  }

  async function translateTo(lang) {
    if (guest) { toast('Sign in to translate recipes.'); return }
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
      case 'update_field':
      case 'update_ingredients':
      case 'update_steps':
      case 'add_note':
        if (!canEdit) { toast('Only the owner can change this recipe — save a copy to edit your own.'); break }
        if (action.type === 'update_field') await onUpdate({ ...recipe, [action.field]: action.value })
        if (action.type === 'update_ingredients') await onUpdate({ ...recipe, ingredients: action.ingredients })
        if (action.type === 'update_steps') await onUpdate({ ...recipe, steps: action.steps })
        if (action.type === 'add_note' && addNoteRef.current) addNoteRef.current(action.content)
        break
    }
  }

  async function handleRequestSaveNote(content) {
    if (!canEdit) { toast('Only the owner can add notes to this recipe.'); return }
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
              {(recipe.ingredients || []).filter((i) => !/^##?\s+/.test(i)).map((ing, i) => { const p = parseIng(ing); const g = lineGrams(ing); return p.name ? <option key={i} value={p.name}>{p.name} ({g > 0 ? fmtQty(g) + ' g' : p.qty || '?'})</option> : null })}
            </select>
          </div>
          {scaleIngName && (() => {
            const origIng = (recipe.ingredients || []).find((i) => !/^##?\s+/.test(i) && parseIng(i).name.toLowerCase() === scaleIngName.toLowerCase())
            const origG = origIng ? lineGrams(origIng) : 0
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
                placeholder={fmtQty(lineGrams((viewR.ingredients || []).find((i) => i.toLowerCase().includes(pctBase.toLowerCase())) || '')) || 'g'}
              />
              <span className="Q-dim">g</span>
              {customBaseGrams && <button className="Q-link" onClick={() => setCustomBaseGrams('')}>reset</button>}
            </span>
          )}
        </>
      )}
      <span className="sp" />
      <button className="Q-link" onClick={() => setShowPct(false)}>Hide</button>
    </div>
  )

  const ingredientsContent = (
    <>
      {sections.map((sec, si) => {
        const pctData = showPct ? calcPct(sec.items, pctMode, pctBase, customBaseGrams ? parseFloat(customBaseGrams) : null) : null
        const secG = sectionGrams(sec.items)
        return (
          <div key={si}>
            {sec.name && <div className="Q-sec-h"><span>{sec.name}</span></div>}
            <ul className="Q-ings">
              {sec.items.map((ing, ii) => {
                const rawIdx = sec.rawIndices[ii], isCk = checked.has(rawIdx)
                const d = splitIngLine(ing)
                const est = ingGrams(ing)
                const pct = pctData ? pctData[ii] : null
                return (
                  <li key={ii} className={`Q-ing-row${isCk ? ' checked' : ''}${d.ref ? ' ref' : ''}`} onClick={() => handleIngToggle(rawIdx)} title={d.ref ? 'Made earlier in this recipe' : undefined}>
                    <span className="Q-ing-check" aria-hidden="true" />
                    <span className="Q-ing-qty">{d.qty}</span>
                    <span className="Q-ing-name">{d.name}{est.approx && est.grams > 0 && <span className="Q-ing-approx" title="Typical weight, used in totals and baker's %">≈ {fmtQty(est.grams)} g</span>}</span>
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
    </>
  )

  const stepList = numberSteps(viewR.steps)
  const videos = Array.isArray(recipe.videos) ? recipe.videos : []
  // Session progress on the method: finished steps and the next one to do.
  const doneSteps = new Set(cook?.progress?.steps || [])
  const realSteps = stepList.map((st, i) => ({ ...st, i })).filter((st) => st.text && !st.header)
  const nextStep = cook ? realSteps.find(({ i }) => !doneSteps.has(i))?.i : null
  const doneCount = realSteps.filter(({ i }) => doneSteps.has(i)).length
  const ingCount = sections.reduce((n, sec) => n + sec.items.length, 0)
  // Timers: a written time in a step becomes a chip; other steps and each part get a timer menu.
  const partOf = []
  stepList.reduce((part, st, i) => { partOf[i] = st.header ? st.text : part; return partOf[i] }, '')
  const timerBase = { recipeId: recipe.id, recipeTitle: recipe.title || 'Recipe' }
  const stepTimers = (st, i) => {
    const short = st.text.length > 42 ? st.text.slice(0, 40).trimEnd() + '…' : st.text
    const label = [partOf[i], `Step ${st.n}`].filter(Boolean).join(' · ') + ` — ${short}`
    const durs = findDurations(st.text).slice(0, 3)
    if (!durs.length) return <TimerMenu className="hover-only" tkey={`${recipe.id}:step:${i}`} label={label} {...timerBase} />
    return durs.map((d) => <TimerChip key={d.ms} tkey={`${recipe.id}:step:${i}:${d.ms}`} label={label} ms={d.ms} text={d.label} {...timerBase} />)
  }
  const blocks = [
    {
      id: 'ingredients', title: cook ? 'Mise en place' : 'Ingredients', content: ingredientsContent,
      summary: cook ? `${checked.size} of ${ingCount} ready` : totalGrams > 0 ? `${totalGrams.toFixed(0)} g` : '',
      actions: checked.size > 0 && <button className="Q-link" onClick={clearTicked}>Clear {checked.size} ticked</button>,
    },
    stepList.some((st) => st.n) && {
      id: 'method', title: 'Method', summary: cook ? `${doneCount} of ${realSteps.length}` : `${realSteps.length} steps`,
      actions: cook
        ? doneCount > 0 && <button className="Q-link" onClick={() => cook.onClear('steps')}>Clear {doneCount} done</button>
        : highlightedSteps.size > 0 && <em className="Q-hl-note">{highlightedSteps.size === 1 ? '1 step uses' : `${highlightedSteps.size} steps use`} the ticked ingredients</em>,
      content: (
        <ol className={`Q-steps${cook ? ' Q-cook-steps' : ''}`}>
          {stepList.map((st, i) => {
            if (!st.text) return null
            if (st.header) return <li key={i} className="Q-step-h">{st.text}<TimerMenu tkey={`${recipe.id}:part:${i}`} label={st.text} {...timerBase} /></li>
            if (cook) {
              return (
                <li key={i} data-n={st.n} className={`${doneSteps.has(i) ? 'done' : ''}${i === nextStep ? ' next' : ''}`} onClick={() => cook.onToggleStep(i)}>
                  {st.text}{stepTimers(st, i)}
                </li>
              )
            }
            return <li key={i} data-n={st.n} className={highlightedSteps.has(i) ? 'highlighted' : ''}>{st.text}{stepTimers(st, i)}</li>
          })}
        </ol>
      ),
    },
    (videos.length > 0 || addingVideo) && {
      id: 'video', title: videos.length > 1 ? `Videos` : 'Video', summary: videos.length > 1 ? `${videos.length}` : '',
      actions: canEdit && videos.length > 0 && !addingVideo && <button className="Q-link" onClick={() => setAddingVideo(true)}>Add</button>,
      content: <VideoBlock videos={videos} onChange={canEdit ? (v) => onUpdate({ ...recipe, videos: v }) : null} adding={addingVideo} onAddingDone={() => setAddingVideo(false)} />,
    },
    viewR.notes && { id: 'notes', title: 'Notes', content: <div className="Q-baker-note">{viewR.notes}</div> },
    recipe.source_photos?.length > 0 && {
      id: 'photos', title: 'Source photos', summary: `${recipe.source_photos.length}`,
      content: <div className="Q-src-photos">{recipe.source_photos.map((src, i) => <img key={i} src={src} onClick={() => setLightboxSrc(src)} alt="" />)}</div>,
    },
  ].filter(Boolean)

  const recipeContent = (
    <div>
      {scalePanel}
      {pctBar}
      <Blocks blocks={blocks} split={settings.layout === 'split'} />
    </div>
  )

  function unfoldVideo() {
    const b = normalizeBlocks(settings.blocks)
    if (b.collapsed.video) updateSettings({ blocks: { ...b, collapsed: { ...b.collapsed, video: false } } })
  }

  const meta = [
    cook && (realSteps.length ? `${doneCount} of ${realSteps.length} steps done` : 'No method written'),
    viewR.time, viewR.servings, viewR.source, ownerName && `by ${ownerName}`,
  ].filter(Boolean)
  const hasNotes = parseTabs(recipe.notes_pad).some((t) => String(t.content || '').trim()) || parseMediaLibrary(recipe.media_library || '').length > 0
  const tabs = TABS.filter(([k]) => (k === 'notes' ? canEdit || hasNotes : k === 'ai' ? !guest : true))
  const vis = recipe.visibility || 'private'
  const VisIcon = { private: Lock, shared: Users, public: Globe }[vis] || Lock
  const visLabel = canEdit ? VISIBILITY[vis] : vis === 'shared' ? 'Shared with you' : VISIBILITY[vis]
  const origin = [recipe.fixed_lang && `${recipe.fixed_lang} version`, copiedFrom && `copy of ${copiedFrom.title}`].filter(Boolean).join(', ')

  return (
    <div className="Q-view">
      <div className="Q-view-header">
        <div className="Q-view-title">
          <h1>{viewR.title || 'Untitled'}</h1>
          <div className="Q-meta">
            {viewR.category && <span className="Q-meta-cat">{viewR.category}</span>}
            {meta.map((m, i) => <span key={i}>{m}</span>)}
            {!guest && (
              <span className={`Q-meta-vis ${vis}`}>
                {canEdit && onShare
                  ? <button onClick={onShare} title="Change who can see this recipe"><VisIcon size={12} strokeWidth={2.2} />{visLabel}</button>
                  : <><VisIcon size={12} strokeWidth={2.2} />{visLabel}</>}
              </span>
            )}
          </div>
          {origin && <div className="Q-origin">{origin.charAt(0).toUpperCase() + origin.slice(1)}</div>}
        </div>
        {recipe.thumbnail && <img src={recipe.thumbnail} className="Q-recipe-thumb" onClick={() => setLightboxSrc(recipe.thumbnail)} alt={recipe.title} />}
      </div>

      {cook && realSteps.length > 0 && <div className="Q-meter"><i style={{ width: `${(doneCount / realSteps.length) * 100}%` }} /></div>}

      {appliedScale && (
        <div className="Q-banner">
          <span>{cook ? `This session makes ${appliedScale.label}` : `Scaled ${appliedScale.label}`}</span>
          <span className="sp" />
          <button onClick={saveCurrentAsNew}>Save as new</button>
          <button onClick={() => setAppliedScale(null)}>Reset</button>
        </div>
      )}
      {translated && (
        <div className="Q-banner">
          <span>Shown in {targetLang}</span>
          <span className="sp" />
          {!appliedScale && <button onClick={saveCurrentAsNew}>Save as new</button>}
          <button onClick={() => setTranslated(null)}>Original</button>
        </div>
      )}

      {translating && <div className="Q-banner"><Loader2 size={13} className="spin" /><span>Translating to {targetLang}…</span></div>}
      {exporting && <div className="Q-banner"><Loader2 size={13} className="spin" /><span>Preparing the export…</span></div>}

      <div className="Q-tabbar">
        <div className="Q-tabbar-view">
          {tab !== 'recipe' && (
            <>
              <button className="Q-textbtn Q-back" onClick={() => setTab('recipe')}><ChevronLeft size={15} /> Recipe</button>
              <span className="Q-tabbar-title">{tabs.find(([k]) => k === tab)?.[1]}</span>
            </>
          )}
        </div>
        <div className="Q-tabbar-actions">
          {onToggleSession && (
            <button className={`Q-sess-toggle${inSession ? ' on' : ''}`} onClick={onToggleSession} title={inSession ? 'Remove from the session' : 'Add to the cooking session'}>
              {inSession ? <><Check size={14} strokeWidth={2.6} /> In session</> : 'Add to session'}
            </button>
          )}
          {canEdit && onShare && <button className="Q-textbtn" onClick={onShare}>Share</button>}
          {canEdit && <button className="Q-textbtn" onClick={onEdit}>Edit</button>}
          {!canEdit && !guest && onToggleLike && <button className={`Q-textbtn${liked ? ' on' : ''}`} onClick={onToggleLike} title={liked ? 'Remove from Recipes I like' : 'Keep it in Recipes I like'}>{liked ? 'Liked' : 'Like'}</button>}
          {guest && <button className="Q-textbtn" onClick={() => onCopy(recipe, null)}>Save a copy</button>}
          <Menu
            width={240}
            trigger={(p) => (
              <button className="Q-icon-btn" onClick={() => { if (!p.open) setMenuView('main'); p.toggle() }} aria-label="Views and tools" title="Views and tools">
                <MoreHorizontal size={18} />
              </button>
            )}
          >
            {menuView === 'main' && (
              <>
                {tabs.length > 1 && (
                  <>
                    {tabs.map(([k, l]) => <MenuItem key={k} checked={tab === k} onClick={() => setTab(k)}>{l}</MenuItem>)}
                    <MenuSep />
                  </>
                )}
                <MenuItem checked={!!appliedScale} hint={appliedScale?.label} onClick={() => { setTab('recipe'); setShowScale(true) }}>Scale</MenuItem>
                <MenuItem checked={showPct} onClick={() => { setTab('recipe'); setShowPct(!showPct) }}>Baker's %</MenuItem>
                {!guest && <MenuItem checked={!!translated} keepOpen hint={<>{translated ? targetLang : ''}<ChevronRight size={14} /></>} onClick={() => setMenuView('translate')}>Translate</MenuItem>}
                <MenuItem checked={false} keepOpen hint={<ChevronRight size={14} />} onClick={() => setMenuView('export')}>Export</MenuItem>
                <MenuItem checked={false} keepOpen hint={<ChevronRight size={14} />} onClick={() => setMenuView('timer')}>Timer</MenuItem>
                {!guest && onToggleCollection && (
                  <>
                    <MenuSep />
                    <MenuItem checked={isFavorite} onClick={onToggleFavorite}>Favorite</MenuItem>
                    <MenuItem checked={collections.some((c) => c.has)} keepOpen hint={<ChevronRight size={14} />} onClick={() => setMenuView('collections')}>Add to collection</MenuItem>
                  </>
                )}
                {!guest && (
                  <>
                    <MenuSep />
                    {canEdit && <MenuItem checked={false} onClick={() => { setTab('recipe'); setAddingVideo(true); unfoldVideo() }}>Add video</MenuItem>}
                    <MenuItem checked={false} onClick={() => onCopy(recipe, null)}>{canEdit ? 'Duplicate' : 'Save a copy to my recipes'}</MenuItem>
                    <MenuItem checked={false} keepOpen hint={<ChevronRight size={14} />} onClick={() => setMenuView('copy')}>{canEdit ? 'Duplicate translated' : 'Save a translated copy'}</MenuItem>
                  </>
                )}
                {cook && (
                  <>
                    <MenuSep />
                    <MenuItem checked={false} onClick={cook.onOpenRecipe}>Show in recipe list</MenuItem>
                    <MenuItem checked={false} onClick={cook.onRemove}>Remove from session</MenuItem>
                  </>
                )}
                {canEdit && (<><MenuSep /><MenuItem danger checked={false} onClick={onDelete}>Delete recipe</MenuItem></>)}
              </>
            )}
            {menuView === 'translate' && (
              <>
                <MenuItem icon={ChevronLeft} keepOpen onClick={() => setMenuView('main')}>Translate</MenuItem>
                <MenuSep />
                <div className="Q-menu-scroll">
                  {langsOrdered.map((l) => <MenuItem key={l} checked={!!translated && targetLang === l} disabled={translating} onClick={() => { setTab('recipe'); translateTo(l) }}>{l}</MenuItem>)}
                </div>
                {translated && (<><MenuSep /><MenuItem checked={false} onClick={() => setTranslated(null)}>Show original</MenuItem></>)}
              </>
            )}
            {menuView === 'export' && (
              <>
                <MenuItem icon={ChevronLeft} keepOpen onClick={() => setMenuView('main')}>Export</MenuItem>
                <MenuSep />
                <MenuItem checked={false} disabled={exporting} onClick={() => runExport('pdf')}>PDF</MenuItem>
                <MenuItem checked={false} disabled={exporting} onClick={() => runExport('img')}>Image</MenuItem>
                <MenuItem checked={false} disabled={exporting} onClick={() => runExport('xls')}>Excel</MenuItem>
                <MenuSep />
                <MenuToggle checked={exportNotes} onChange={(v) => updateSettings({ exportNotes: v })}>Include notes</MenuToggle>
              </>
            )}
            {menuView === 'timer' && (
              <>
                <MenuItem icon={ChevronLeft} keepOpen onClick={() => setMenuView('main')}>Timer for this recipe</MenuItem>
                <MenuSep />
                <TimerPresets recipeId={recipe.id} recipeTitle={recipe.title || 'Recipe'} />
              </>
            )}
            {menuView === 'collections' && (
              <>
                <MenuItem icon={ChevronLeft} keepOpen onClick={() => setMenuView('main')}>Add to collection</MenuItem>
                <MenuSep />
                <div className="Q-menu-scroll">
                  {collections.map((c) => <MenuItem key={c.id} checked={c.has} keepOpen onClick={() => onToggleCollection(c.id)}>{c.name}</MenuItem>)}
                  {!collections.length && onToggleLike && <MenuItem checked={liked} keepOpen onClick={onToggleLike}>Recipes I like</MenuItem>}
                </div>
                <MenuSep />
                <MenuItem checked={false} onClick={() => onToggleCollection(null)}>New collection…</MenuItem>
              </>
            )}
            {menuView === 'copy' && (
              <>
                <MenuItem icon={ChevronLeft} keepOpen onClick={() => setMenuView('main')}>{canEdit ? 'Duplicate translated' : 'Save a translated copy'}</MenuItem>
                <MenuSep />
                <div className="Q-menu-scroll">
                  {langsOrdered.map((l) => <MenuItem key={l} checked={false} onClick={() => onCopy(recipe, l)}>{l}</MenuItem>)}
                </div>
              </>
            )}
          </Menu>
        </div>
      </div>

      {tab === 'recipe' && recipeContent}
      {tab === 'notes' && <NotesPanel recipe={recipe} onSave={handleSaveNotes} onSaveMedia={handleSaveMedia} onAddNote={addNoteRef} readOnly={!canEdit} />}
      {tab === 'ai' && <AIAssistant recipe={viewR} onAction={handleAssistantAction} onRequestSaveNote={handleRequestSaveNote} />}
      {lightboxSrc && <div className="Q-lightbox" onClick={() => setLightboxSrc(null)}><img src={lightboxSrc} alt="" /></div>}
    </div>
  )
}
