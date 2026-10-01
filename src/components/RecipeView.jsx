import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, ChefHat, ChevronDown, ChevronLeft, ChevronRight, Globe, Loader2, Lock, MoreHorizontal, Share, Users } from 'lucide-react'
import {
  calcPct, findStepsForIng, fmtQty, getTotalGrams, ingGrams, lineGrams, numberSteps, parseIng, parseSections, scaleRecipe, sectionGrams, splitIngLine,
} from '../lib/recipeCalc.js'
import { parseTabs, serializeTabs } from '../lib/notesData.js'
import { parseMediaLibrary } from '../lib/media.js'
import { translateRecipe } from '../lib/ai.js'
import { VISIBILITY } from '../lib/sharing.js'
import { LANGS } from '../lib/constants.js'
import { THEMES, janOption, normalizeBlocks, useSettings } from '../lib/settings.js'
import { computeStepUses } from '../lib/stepIngredients.js'
import Season from './Season.jsx'
import Menu, { MenuItem, MenuSep, MenuToggle } from './ui/Menu.jsx'
import { toast } from './ui/Toaster.jsx'
import Blocks from './ui/Blocks.jsx'
import VideoBlock from './VideoBlock.jsx'
import NotesPanel from './NotesPanel.jsx'
import AIAssistant from './AIAssistant.jsx'
import { StepBar, TimerChip, TimerMenu, TimerPresets, WatchChip } from './Timers.jsx'
import { speak } from '../lib/timers.js'
import { fmtSpan, fmtWatch, startWatch, stopWatch, typicalMs, useStepStats, watchElapsed, watchFor } from '../lib/timing.js'
import { findDurations } from '../lib/durations.js'
import { componentsOf, flattenSteps, linkFactor, resolveLink } from '../lib/links.js'
import { useCookPlans } from '../lib/cookPlan.js'
import { readScale, writeScale } from '../lib/scales.js'
import { cleanName, guessLang, stepName } from '../lib/timerNames.js'
import StepSheet from './StepSheet.jsx'
import ChefMode from './ChefMode.jsx'

const TABS = [
  ['recipe', 'Recipe'],
  ['notes', 'Notes'],
  ['ai', 'Assistant'],
]

export default function RecipeView({
  recipe, onEdit, onDelete, onUpdate, allRecipes, onCopy, onSaveVariant, inSession, onToggleSession, onOpenRecipe = null,
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
  const [localScale, setLocalScale] = useState(() => readScale(`view:${recipe.id}`).cur)
  const [translating, setTranslating] = useState(false)
  const [translated, setTranslated] = useState(null)
  const [targetLang, setTargetLang] = useState(settings.translateLang || 'English')
  const [exporting, setExporting] = useState(false)
  const [menuView, setMenuView] = useState('main') // main | translate | export | copy | collections | timer
  const [addingVideo, setAddingVideo] = useState(false)
  const [stepSheet, setStepSheet] = useState(null) // { i } — the step or part held down
  const [chef, setChef] = useState(false) // chef mode: guided, one step at a time
  const [unfolded, setUnfolded] = useState(() => new Set()) // linked recipes shown open: "i:<line>", "m:<recipe id>"
  const toggleFold = (k) => setUnfolded((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const press = useRef(null)
  const exportNotes = settings.exportNotes
  const addNoteRef = useRef(null)

  useEffect(() => {
    setLocalChecked(new Set()); setLocalScale(readScale(`view:${recipe.id}`).cur); setTranslated(null)
    setShowScale(false); setTab('recipe'); setAddingVideo(false); setChef(false); setUnfolded(new Set())
    setCustomBaseGrams('')
  }, [recipe.id])

  const cookIng = cook?.progress?.ing
  const inCook = !!cook
  const checked = useMemo(() => (inCook ? new Set(cookIng || []) : localChecked), [inCook, cookIng, localChecked])
  const cookFactor = cook ? Number(cook.factor) || 1 : 1
  const appliedScale = cook ? (cookFactor !== 1 ? { factor: cookFactor, label: '×' + +cookFactor.toFixed(2) } : null) : localScale
  // Every scale is remembered (see lib/scales.js) with the ones before it, for Undo.
  const scaleKey = `${cook ? 'cook' : 'view'}:${recipe.id}`
  const [scalePast, setScalePast] = useState(() => readScale(scaleKey).past)
  // The latest scale and history, for an Undo offered after them (a toast's button).
  const scaleNow = useRef({ cur: appliedScale, past: scalePast })
  scaleNow.current = { cur: appliedScale, past: scalePast }
  useEffect(() => { setScalePast(readScale(scaleKey).past) }, [scaleKey])
  function commitScale(s, past) {
    if (cook) cook.onFactor(s ? s.factor : 1)
    else { setLocalScale(s); setLocalChecked(new Set()) }
    setScalePast(past)
    scaleNow.current = { cur: s, past }
    writeScale(scaleKey, cook ? null : s, past)
  }
  function setAppliedScale(s) {
    const { cur, past } = scaleNow.current
    commitScale(s, [...past, cur || null])
  }
  function undoScale() {
    const { past } = scaleNow.current
    if (!past.length) return
    commitScale(past[past.length - 1], past.slice(0, -1))
  }
  // "Hey chef" (components/HeyChef.jsx): open chef mode, scale, read the ingredients.
  const voiceRef = useRef(null)
  voiceRef.current = (d) => {
    if (d.intent === 'chef-open' || ((d.intent === 'chef-next' || d.intent === 'chef-goto') && !chef)) {
      if (!chef) { setTab('recipe'); setChef(true); d.handled = true }
      return
    }
    if (d.intent === 'scale') {
      setAppliedScale(d.factor === 1 ? null : { factor: d.factor, label: '×' + d.factor })
      d.handled = true
      speak(d.factor === 1 ? 'Back to the original amounts.' : `Scaled by ${d.factor}.`, timerLang)
      return
    }
    if (d.intent === 'read-ingredients') {
      const lines = (viewR.ingredients || []).filter((l) => !/^##?\s+/.test(l)).map((l) => { const x = splitIngLine(l); return [x.qty, x.name].filter(Boolean).join(' ') })
      speak(lines.slice(0, 30).join(', ') || 'No ingredients.', timerLang, { interrupt: true })
      d.handled = true
    }
  }
  useEffect(() => {
    const on = (e) => voiceRef.current?.(e.detail)
    window.addEventListener('qdplus:voice', on)
    return () => window.removeEventListener('qdplus:voice', on)
  }, [])

  function backToOriginal() {
    setAppliedScale(null)
    toast('Back to the original amounts', { action: { label: 'Undo', onClick: () => undoScale() } })
  }
  function clearTicked() {
    if (cook) cook.onClear('ing'); else setLocalChecked(new Set())
  }

  const library = allRecipes || []
  const displayR = translated || recipe
  const originalThumbnail = recipe.thumbnail
  const viewR = useMemo(() => (appliedScale ? scaleRecipe(displayR, appliedScale.factor) : displayR), [displayR, appliedScale])
  const sections = useMemo(() => parseSections(viewR.ingredients || []), [viewR])
  const ingNames = useMemo(() => (viewR.ingredients || []).filter((l) => !/^##?\s+/.test(l)).map((l) => splitIngLine(l).name), [viewR])
  const timerLang = useMemo(() => guessLang([...(viewR.steps || []), ...(viewR.ingredients || [])].join(' ')), [viewR])
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
                // Another recipe used here: its name opens it, the arrow shows what goes into it.
                const sub = d.link ? resolveLink(d.link, library) : null
                const open = sub && unfolded.has(`i:${rawIdx}`)
                const row = (
                  <li key={ii} className={`Q-ing-row${isCk ? ' checked' : ''}${d.ref ? ' ref' : ''}${d.link ? ' linked' : ''}`} onClick={() => handleIngToggle(rawIdx)} title={d.ref ? 'Made earlier in this recipe' : undefined}>
                    <span className="Q-ing-check" aria-hidden="true" />
                    <span className="Q-ing-qty">{d.qty}{d.link && d.qty && !/[a-z]/i.test(d.qty) ? ' ×' : ''}</span>
                    <span className="Q-ing-name">
                      {d.link
                        ? <button type="button" className="Q-ing-link" disabled={!sub || !onOpenRecipe} title={sub ? 'Open this recipe' : 'This recipe is not in your library'} onClick={(e) => { e.stopPropagation(); if (sub) onOpenRecipe?.(sub.id) }}>{d.name}{sub && onOpenRecipe && <ArrowUpRight size={13} />}</button>
                        : d.name}
                      {est.approx && est.grams > 0 && <span className="Q-ing-approx" title="Typical weight, used in totals and baker's %">≈ {fmtQty(est.grams)} g</span>}
                    </span>
                    {pct?.pct != null && <span className={`Q-pct-badge${pct.isBase ? ' base' : ''}`}>{pct.pct.toFixed(1)}%</span>}
                    {sub && (
                      <button type="button" className={`Q-ing-fold${open ? ' open' : ''}`} onClick={(e) => { e.stopPropagation(); toggleFold(`i:${rawIdx}`) }} aria-expanded={!!open} aria-label={`What goes into ${sub.title}`} title="What goes into it">
                        <ChevronDown size={15} />
                      </button>
                    )}
                  </li>
                )
                if (!open) return row
                const f = linkFactor(ing, sub)
                const subLines = (f !== 1 ? scaleRecipe(sub, f) : sub).ingredients || []
                return [row, (
                  <li key={`${ii}-sub`} className="Q-ing-subs">
                    <ul>
                      {subLines.map((line, k) => {
                        if (/^##?\s+/.test(line)) return <li key={k} className="Q-ing-subs-h">{line.replace(/^##?\s*/, '')}</li>
                        const sd = splitIngLine(line)
                        return <li key={k}><span className="Q-ing-qty">{sd.qty}</span><span className="Q-ing-name">{sd.ref ? '↳ ' : ''}{sd.name}</span></li>
                      })}
                    </ul>
                  </li>
                )]
              })}
            </ul>
            {sec.name && secG > 0 && sec.items.length > 1 && <div className="Q-subtotal">{secG.toFixed(0)} g</div>}
          </div>
        )
      })}
      {totalGrams > 0 && <div className="Q-grand-total"><span>Total</span>{totalGrams.toFixed(0)} g</div>}
    </>
  )

  const stepList = numberSteps(viewR.steps)
  const videos = Array.isArray(recipe.videos) ? recipe.videos : []
  const videoCount = videos.filter((v) => v.url).length
  // Every step to cook, the steps of the recipes used in this one included (a Flan's Pâte
  // brisée): theirs are keyed "<recipe id>:<index>", this recipe's by their index.
  const flat = useMemo(() => flattenSteps(viewR, library), [viewR, library])
  const comps = useMemo(() => componentsOf(viewR, library), [viewR, library])
  // Session progress on the method: finished steps and the next one to do.
  const doneSteps = new Set(cook?.progress?.steps || [])
  const realSteps = flat
  const nextStep = cook ? flat.find((s) => !doneSteps.has(s.key))?.key : null
  const doneCount = flat.filter((s) => doneSteps.has(s.key)).length
  const ingCount = sections.reduce((n, sec) => n + sec.items.length, 0)
  // Timers: a written time in a step becomes a chip; other steps and each part get a timer menu.
  const partOf = []
  stepList.reduce((part, st, i) => { partOf[i] = st.header ? st.text : part; return partOf[i] }, '')
  // Each timer is named for what it is about — the step's ingredient ("Cebolla"), else its part
  // ("Lievito madre"), else the recipe — and says that name, in the recipe's language, when it ends.
  const recipeName = cleanName(viewR.title) || viewR.title || 'Recipe'
  const timerBase = { recipeId: recipe.id, recipeTitle: recipe.title || 'Recipe', lang: timerLang }
  const stepInfo = (st, i) => {
    if (st.header) return { label: st.text, name: cleanName(st.text) || st.text, durs: [], tkey: `${recipe.id}:part:${i}` }
    const short = st.text.length > 42 ? st.text.slice(0, 40).trimEnd() + '…' : st.text
    return {
      label: [partOf[i], `Step ${st.n}`].filter(Boolean).join(' · ') + ` — ${short}`,
      name: stepName(st.text, ingNames, cleanName(partOf[i]) || recipeName),
      durs: findDurations(st.text).slice(0, 3),
      tkey: `${recipe.id}:step:${i}`,
    }
  }
  // A step of a recipe used in this one: its timer is this recipe's, named after that recipe.
  const subInfo = (s) => {
    const short = s.text.length > 42 ? s.text.slice(0, 40).trimEnd() + '…' : s.text
    const names = (s.src.recipe.ingredients || []).filter((l) => !/^##?\s+/.test(l)).map((l) => splitIngLine(l).name)
    return {
      label: [s.src.title, s.part, `Step ${s.n}`].filter(Boolean).join(' · ') + ` — ${short}`,
      name: stepName(s.text, names, cleanName(s.src.title) || cleanName(s.part) || recipeName),
      durs: findDurations(s.text).slice(0, 3),
      tkey: `${recipe.id}:${String(s.key).replace(/:(\d+)$/, ':step:$1')}`,
    }
  }
  // Chef mode walks through all of them; each recipe brings its own ingredient list.
  const chefSteps = useMemo(() => flat.map((s) => ({
    i: s.key, n: s.n, text: s.text, part: s.part, src: s.src.id, srcTitle: s.src.title,
    info: s.src.id === recipe.id ? stepInfo(stepList[s.key], s.key) : subInfo(s),
  })), [flat])
  // The AI's reading of each method (what every step really takes), fetched when cooking — in chef
  // mode or a session — and kept on the device. Guests use the reading from the words alone.
  const planRecipes = useMemo(() => [
    recipe,
    ...[...new Set(flat.map((s) => s.src.id))].filter((id) => id !== recipe.id).map((id) => library.find((r) => r.id === id)).filter(Boolean),
  ], [recipe, flat, library])
  const cookPlans = useCookPlans(planRecipes, (chef || !!cook) && !guest)
  const chefSources = useMemo(() => {
    const out = { [recipe.id]: { title: '', sections } }
    flat.forEach((s) => { if (!out[s.src.id]) out[s.src.id] = { title: s.src.title, sections: parseSections(s.src.recipe.ingredients || []) } })
    return out
  }, [flat, sections])

  // A recipe used in this one, inside the method: its name (opens it) and, unfolded, its steps —
  // ticked off like the others in a session.
  const linkedSteps = (c, key) => {
    const list = flat.filter((s) => s.root === c.sub.id)
    const open = unfolded.has(`m:${c.sub.id}`)
    const done = list.filter((s) => doneSteps.has(s.key)).length
    let label = null
    return (
      <li key={key} className={`Q-step-link${cook && list.length && done === list.length ? ' done' : ''}`}>
        <div className="Q-step-link-head">
          <button type="button" className="Q-ing-link" disabled={!onOpenRecipe} onClick={() => onOpenRecipe?.(c.sub.id)} title="Open this recipe">
            {c.sub.title}{onOpenRecipe && <ArrowUpRight size={13} />}
          </button>
          <button type="button" className={`Q-step-link-fold${open ? ' open' : ''}`} onClick={() => toggleFold(`m:${c.sub.id}`)} aria-expanded={open}>
            {list.length ? (cook ? `${done} of ${list.length} steps` : `${list.length} step${list.length === 1 ? '' : 's'}`) : 'No method'}
            {list.length > 0 && <ChevronDown size={14} />}
          </button>
          <TimerMenu tkey={`${recipe.id}:${c.sub.id}:part`} label={c.sub.title} name={cleanName(c.sub.title) || c.sub.title} {...timerBase} />
        </div>
        {open && list.length > 0 && (
          <ol className={`Q-steps Q-sub-steps${cook ? ' Q-cook-steps' : ''}`}>
            {list.flatMap((s) => {
              const where = [s.src.id !== c.sub.id && s.src.title, s.part].filter(Boolean).join(' · ')
              const head = where && where !== label ? [(
                <li key={`h-${s.key}`} className="Q-step-h">
                  {where}
                  <TimerMenu tkey={`${recipe.id}:${s.src.id}:part:${where}`} label={where} name={cleanName(s.part) || cleanName(where) || where} {...timerBase} />
                </li>
              )] : []
              label = where || label
              // Timers as on this recipe's own steps (chefSteps holds their names and keys).
              const cs = chefSteps.find((x) => x.i === s.key)
              const idx = String(s.key).split(':').pop()
              const sw = { wkey: `w:${s.src.id}:${idx}`, typical: typicalMs(stepStats, s.src.id, idx, s.text) }
              return [...head, (
                <li
                  key={s.key} data-n={s.n}
                  className={`Q-step${cook && doneSteps.has(s.key) ? ' done' : ''}${cook && s.key === nextStep ? ' next' : ''}`}
                  onClick={cook ? () => cook.onToggleStep(s.key) : undefined}
                  {...(cs ? holdToOpen(null, cs) : {})}
                >
                  {cs ? timedText(s.text, cs.info, { ext: cs }, sw) : <span className="Q-step-text">{s.text}</span>}
                </li>
              )]
            })}
          </ol>
        )}
      </li>
    )
  }

  // A step's written times become chips in its text; a step without one gets a small timer
  // beside it (on a touch screen it opens the step's options, like holding the step down).
  const touch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches
  // Templates with step bars ("Jan"): no clocks in the text — a grey bar under the step fills while
  // its timer runs (tap it to start the written time, or for the step's timer options).
  const stepBars = THEMES.find((t) => t.id === settings.theme)?.stepBars
  const jan = settings.theme === 'jan'
  // w: { wkey, typical } — the step's stopwatch (when it is being timed) and its usual time.
  const timedText = (text, { label, name, durs, tkey }, sheet, w = null) => {
    const extra = w && (
      <>
        {w.typical != null && <span className="Q-step-usual" title="Your usual time for this step">~{fmtSpan(w.typical)}</span>}
        <WatchChip wkey={w.wkey} />
      </>
    )
    if (stepBars) {
      return (
        <>
          <span className="Q-step-text">{text}{extra}</span>
          <StepBar tkey={tkey} durs={durs} label={label} name={name} onSheet={() => setStepSheet(sheet)} {...timerBase} />
        </>
      )
    }
    if (durs.length) return <span className="Q-step-text">{text}{durs.map((d) => <TimerChip key={d.ms} tkey={`${tkey}:${d.ms}`} label={label} name={name} ms={d.ms} text={d.label} {...timerBase} />)}{extra}</span>
    return (
      <>
        <span className="Q-step-text">{text}{extra}</span>
        <TimerMenu className="side" tkey={tkey} label={label} name={name} onSheet={touch ? () => setStepSheet(sheet) : null} {...timerBase} />
      </>
    )
  }
  // How long each step usually takes you (lib/timing.js), and timing a step by hand.
  const stepStats = useStepStats([recipe.id, ...comps.map((c) => c.sub.id)], !guest)
  const watchInfo = (recipeId, key, text) => ({
    key: `w:${recipeId}:${key}`, recipeId, stepKey: String(key), stepText: text, sessionId: cook?.sessionId || null, factor: appliedScale?.factor || 1,
  })
  const ownWatch = (i) => ({ wkey: `w:${recipe.id}:${i}`, typical: typicalMs(stepStats, recipe.id, String(i), String((recipe.steps || [])[i] ?? '')) })
  const stepBody = (st, i) => timedText(st.text, stepInfo(st, i), { i }, ownWatch(i))
  const timingAction = (info) => {
    const w = watchFor(info.key)
    return w
      ? { label: `Stop timing (${fmtWatch(watchElapsed(w))})`, onClick: () => { const ms = stopWatch(info.key); toast(`Timed: ${fmtSpan(ms)}`) } }
      : { label: 'Time this step', onClick: () => startWatch(info) }
  }
  // Hold a step (or part) down on a phone — or right-click it — for its options, a timer first.
  // A step of a linked recipe passes itself as `ext` (see chefSteps).
  const holdToOpen = (i, ext = null) => ({
    onPointerDown: (e) => {
      if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('button, a, input')) return
      clearTimeout(press.current?.timer)
      const p = { x: e.clientX, y: e.clientY, fired: false }
      p.timer = setTimeout(() => { p.fired = true; navigator.vibrate?.(12); setStepSheet(ext ? { ext } : { i }) }, 480)
      press.current = p
    },
    onPointerMove: (e) => {
      const p = press.current
      if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { clearTimeout(p.timer); press.current = null }
    },
    onPointerUp: () => { const p = press.current; if (p && !p.fired) { clearTimeout(p.timer); press.current = null } },
    onPointerCancel: () => { if (press.current) clearTimeout(press.current.timer); press.current = null },
    onContextMenu: (e) => { if (e.target.closest('button, a, input')) return; e.preventDefault(); if (press.current) clearTimeout(press.current.timer); setStepSheet(ext ? { ext } : { i }) },
    // The release after a hold is not a tap: it must not tick the step.
    onClickCapture: (e) => { if (press.current?.fired) { e.stopPropagation(); e.preventDefault(); press.current = null } },
  })
  // "Jan": the recipe as one table — every step with the ingredients it uses beside it, in the
  // amount it needs (the same reading of the method as chef mode: lib/stepIngredients.js).
  const aligned = jan && janOption(settings, 'aligned') && flat.length > 0
  const alignedUses = useMemo(
    () => (aligned ? computeStepUses({ steps: chefSteps, sources: chefSources, recipeId: recipe.id, plans: cookPlans.plans }) : []),
    [aligned, chefSteps, chefSources, cookPlans.plans],
  )
  const alignedContent = aligned && (() => {
    const used = new Set(alignedUses.flat().filter((u) => typeof u.raw === 'number').map((u) => u.raw))
    const loose = sections.flatMap((sec) => sec.items.map((line, ii) => ({ line, raw: sec.rawIndices[ii] }))).filter((x) => !used.has(x.raw))
    let label = null
    const ing = (u, k) => (
      <li key={k} className={`${u.made ? 'made' : ''}${typeof u.raw === 'number' && checked.has(u.raw) ? ' checked' : ''}`} onClick={typeof u.raw === 'number' ? () => handleIngToggle(u.raw) : undefined}>
        <b>{u.qty || ''}</b><span>{u.made ? '↳ ' : ''}{u.d.name}{u.note && <small>{u.note}</small>}</span>
      </li>
    )
    return (
      <div className="Q-aligned">
        {loose.length > 0 && (
          <div className="Q-al-row loose">
            <ul className="Q-al-ings">{loose.map((x) => { const d = splitIngLine(x.line); return ing({ raw: x.raw, qty: d.qty, d }, x.raw) })}</ul>
            <div className="Q-al-step"><span className="Q-dim">Not named in a step — have them ready.</span></div>
          </div>
        )}
        {chefSteps.map((cs, k) => {
          const s = flat[k]
          const where = [cs.srcTitle, cs.part].filter(Boolean).join(' · ')
          const head = where && where !== label ? <div className="Q-al-part" key={`h${k}`}>{where}</div> : null
          label = where || label
          const own = typeof cs.i === 'number'
          const done = cook && doneSteps.has(cs.i)
          const idx = String(cs.i).split(':').pop()
          return [head, (
            <div
              key={cs.i} className={`Q-al-row${done ? ' done' : ''}${cook && cs.i === nextStep ? ' next' : ''}`}
              onClick={cook ? () => cook.onToggleStep(cs.i) : undefined}
              {...(own ? holdToOpen(cs.i) : holdToOpen(null, cs))}
            >
              <ul className="Q-al-ings">{(alignedUses[k] || []).map(ing)}</ul>
              <div className="Q-al-step" data-n={k + 1}>
                {own ? stepBody(stepList[cs.i], cs.i) : timedText(cs.text, cs.info, { ext: cs }, { wkey: `w:${s.src.id}:${idx}`, typical: typicalMs(stepStats, s.src.id, idx, cs.text) })}
              </div>
            </div>
          )]
        })}
        {totalGrams > 0 && <div className="Q-grand-total"><span>Total</span>{totalGrams.toFixed(0)} g</div>}
      </div>
    )
  })()
  const blocks = aligned ? [
    {
      id: 'method', title: 'Recipe', content: alignedContent,
      summary: cook ? `${doneCount} of ${realSteps.length}` : `${realSteps.length} steps${totalGrams > 0 ? ` · ${totalGrams.toFixed(0)} g` : ''}`,
      actions: cook && doneCount > 0 && <button className="Q-link" onClick={() => cook.onClear('steps')}>Clear {doneCount} done</button>,
    },
  ] : []
  const usualBlocks = [
    {
      id: 'ingredients', title: cook ? 'Mise en place' : 'Ingredients', content: ingredientsContent,
      summary: cook ? `${checked.size} of ${ingCount} ready` : totalGrams > 0 ? `${totalGrams.toFixed(0)} g` : '',
      actions: checked.size > 0 && <button className="Q-link" onClick={clearTicked}>Clear {checked.size} ticked</button>,
    },
    (stepList.some((st) => st.n) || flat.length > 0) && {
      id: 'method', title: 'Method', summary: cook ? `${doneCount} of ${realSteps.length}` : `${realSteps.length} steps`,
      actions: cook
        ? doneCount > 0 && <button className="Q-link" onClick={() => cook.onClear('steps')}>Clear {doneCount} done</button>
        : highlightedSteps.size > 0 && <em className="Q-hl-note">{highlightedSteps.size === 1 ? '1 step uses' : `${highlightedSteps.size} steps use`} the ticked ingredients</em>,
      content: (
        <ol className={`Q-steps${cook ? ' Q-cook-steps' : ''}`}>
          {comps.filter((c) => c.stepAt == null).map((c) => linkedSteps(c, `first-${c.sub.id}`))}
          {stepList.map((st, i) => {
            if (!st.text) return null
            if (st.link) {
              const c = comps.find((x) => x.stepAt === i)
              return c ? linkedSteps(c, `at-${i}`) : <li key={i} className="Q-step-link missing" title="This recipe is not in your library">{st.text}</li>
            }
            if (st.header) return <li key={i} className="Q-step-h" {...holdToOpen(i)}>{st.text}<TimerMenu tkey={`${recipe.id}:part:${i}`} label={st.text} name={cleanName(st.text) || st.text} {...timerBase} /></li>
            if (cook) {
              return (
                <li key={i} data-n={st.n} className={`Q-step${doneSteps.has(i) ? ' done' : ''}${i === nextStep ? ' next' : ''}`} onClick={() => cook.onToggleStep(i)} {...holdToOpen(i)}>
                  {stepBody(st, i)}
                </li>
              )
            }
            return <li key={i} data-n={st.n} className={`Q-step${highlightedSteps.has(i) ? ' highlighted' : ''}`} title={touch ? undefined : 'Right-click for a timer or to edit'} {...holdToOpen(i)}>{stepBody(st, i)}</li>
          })}
        </ol>
      ),
    },
    (videos.length > 0 || addingVideo) && {
      id: 'video', title: videoCount > 1 ? `Videos` : 'Video', summary: videoCount > 1 ? `${videoCount}` : '',
      actions: canEdit && videos.length > 0 && !addingVideo && <button className="Q-link" onClick={() => setAddingVideo(true)}>Add</button>,
      content: <VideoBlock videos={videos} onChange={canEdit ? (v) => onUpdate({ ...recipe, videos: v }) : null} adding={addingVideo} onAddingDone={() => setAddingVideo(false)} />,
    },
    viewR.notes && { id: 'notes', title: 'Notes', content: <div className="Q-baker-note">{viewR.notes}</div> },
    recipe.source_photos?.length > 0 && {
      id: 'photos', title: 'Source photos', summary: `${recipe.source_photos.length}`,
      content: <div className="Q-src-photos">{recipe.source_photos.map((src, i) => <img key={i} src={src} onClick={() => setLightboxSrc(src)} alt="" />)}</div>,
    },
  ].filter(Boolean)
  // In the aligned layout the recipe table takes the place of the ingredients and method blocks.
  if (aligned) blocks.push(...usualBlocks.filter((b) => b.id !== 'ingredients' && b.id !== 'method'))
  else blocks.push(...usualBlocks)

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
          {jan && janOption(settings, 'season') && <Season recipe={recipe} regionSetting={settings.jan?.region} enabled={!guest} />}
        </div>
        {recipe.thumbnail && <img src={recipe.thumbnail} className="Q-recipe-thumb" onClick={() => setLightboxSrc(recipe.thumbnail)} alt={recipe.title} />}
      </div>

      {cook && realSteps.length > 0 && <div className="Q-meter"><i style={{ width: `${(doneCount / realSteps.length) * 100}%` }} /></div>}

      {appliedScale && (
        <div className="Q-banner">
          <span>{cook ? `This session makes ${appliedScale.label}` : `Scaled ${appliedScale.label}`}</span>
          <span className="sp" />
          <button onClick={saveCurrentAsNew}>Save as new</button>
          {scalePast.length > 0 && <button onClick={undoScale}>Undo</button>}
          <button onClick={backToOriginal}>Back to original</button>
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
          {stepList.some((st) => st.n) && (
            <button className="Q-chef-btn" onClick={() => { setTab('recipe'); setChef(true) }} title="Chef mode: the recipe step by step">
              <ChefHat size={15} strokeWidth={2.2} /> Chef mode
            </button>
          )}
          {canEdit && onShare && <button className="Q-icon-btn Q-share-btn" onClick={onShare} title="Share" aria-label="Share"><Share size={17} /></button>}
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
                <TimerPresets name={recipeName} recipeId={recipe.id} recipeTitle={recipe.title || 'Recipe'} lang={timerLang} />
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
      {chef && (
        <ChefMode
          title={viewR.title || 'Recipe'} lang={timerLang} timerBase={timerBase} sections={sections} sources={chefSources}
          steps={chefSteps} cook={cook} doneSteps={doneSteps} onClose={() => setChef(false)}
          plans={cookPlans.plans} planPending={cookPlans.pending}
          pro={settings.chefMode !== 'simple'} stats={stepStats} factor={appliedScale?.factor || 1} learn={!guest}
          peek={jan && janOption(settings, 'peek')}
          onTimerOptions={(st) => setStepSheet(typeof st.i === 'number' ? { i: st.i } : { ext: st })}
        />
      )}
      {stepSheet?.ext && (() => {
        const st = stepSheet.ext
        const actions = []
        if (cook) actions.push({ label: doneSteps.has(st.i) ? 'Mark as not done' : 'Mark as done', onClick: () => cook.onToggleStep(st.i) })
        if (!guest) actions.push(timingAction(watchInfo(st.src, String(st.i).split(':').pop(), st.text)))
        actions.push({ label: 'Copy the text', onClick: () => { navigator.clipboard?.writeText(st.text).then(() => toast('Copied'), () => {}) } })
        return (
          <StepSheet
            title={`${st.srcTitle} · Step ${st.n}`} subtitle={st.text}
            durations={st.info.durs} tkeyBase={st.info.tkey} actions={actions}
            timer={{ label: st.info.label, name: st.info.name, ...timerBase }}
            onClose={() => setStepSheet(null)}
          />
        )
      })()}
      {stepSheet && !stepSheet.ext && stepList[stepSheet.i] && (() => {
        const st = stepList[stepSheet.i]
        const info = stepInfo(st, stepSheet.i)
        const actions = []
        if (cook && !st.header) actions.push({ label: doneSteps.has(stepSheet.i) ? 'Mark as not done' : 'Mark as done', onClick: () => cook.onToggleStep(stepSheet.i) })
        if (!guest && !st.header) actions.push(timingAction(watchInfo(recipe.id, stepSheet.i, String((recipe.steps || [])[stepSheet.i] ?? st.text))))
        actions.push({ label: 'Copy the text', onClick: () => { navigator.clipboard?.writeText(st.text).then(() => toast('Copied'), () => {}) } })
        // Edit the step as written (not as scaled or translated on screen).
        const raw = String((recipe.steps || [])[stepSheet.i] ?? '')
        const edit = canEdit && !translated ? {
          text: st.header ? raw.replace(/^##?\s*/, '') : raw,
          onSave: (t) => onUpdate({ ...recipe, steps: (recipe.steps || []).map((x, k) => (k === stepSheet.i ? (st.header ? `## ${t}` : t) : x)) }),
        } : null
        return (
          <StepSheet
            title={st.header ? st.text : `Step ${st.n}`} subtitle={st.header ? null : st.text} edit={edit}
            durations={info.durs} tkeyBase={info.tkey} actions={actions}
            timer={{ label: info.label, name: info.name, ...timerBase }}
            onClose={() => setStepSheet(null)}
          />
        )
      })()}
    </div>
  )
}
