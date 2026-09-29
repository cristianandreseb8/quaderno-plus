import { useEffect, useState } from 'react'
import { Camera, ClipboardPaste, FileUp, ImagePlus, Loader2, Sparkles, SpellCheck, Trash2, X } from 'lucide-react'
import { compressImage, compressThumbnail } from '../lib/media.js'
import { extractWithClaude, proofreadTexts, structureText } from '../lib/ai.js'
import { itemLabel, proofreadItems, wordDiff } from '../lib/proofread.js'
import { useSettings } from '../lib/settings.js'
import DraggableIngList from './DraggableIngList.jsx'
import LinkRecipeModal from './LinkRecipeModal.jsx'
import Modal from './ui/Modal.jsx'
import { toast } from './ui/Toaster.jsx'
import { newVideo } from '../lib/video.js'

const AUTOFILL = [
  ['text', 'Paste text', ClipboardPaste],
  ['photo', 'Photos', Camera],
  ['pdf', 'PDF or book', FileUp],
]

export default function RecipeEditor({ initial, onSave, onCancel, startWith = 'blank', onImportPdf, library = [] }) {
  const initIngs = initial?.ingredients || []
  const [r, setR] = useState(() => ({
    title: initial?.title || '', category: initial?.category || '', time: initial?.time || '', servings: initial?.servings || '',
    notes: initial?.notes || '', source: initial?.source || 'Manual', notes_pad: initial?.notes_pad || '', thumbnail: initial?.thumbnail || '',
    source_photos: initial?.source_photos || [], steps: initial?.steps?.length ? initial.steps : [''], id_data: initial?.id_data || '', media_library: initial?.media_library || '',
    fixed_lang: initial?.fixed_lang || null, copied_from: initial?.copied_from || null,
  }))
  const [videoText, setVideoText] = useState(() => (initial?.videos || []).map((v) => v.url).join('\n'))
  const [ingredientLines, setIngredientLines] = useState(() => (initIngs.length ? initIngs : ['']))
  const [tab, setTab] = useState(initial ? null : (startWith === 'text' || startWith === 'photo' ? startWith : null))
  const [images, setImages] = useState([])
  const [rawText, setRawText] = useState('')
  const [scanning, setScanning] = useState(false)
  const [err, setErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const [linkFor, setLinkFor] = useState(null) // 'ing' | 'step': choosing a recipe to use in this one
  const [proof, setProof] = useState(null) // spelling check: { busy } | { fixes: [{ id, from, to, on }] } | { error }
  const { settings } = useSettings()
  const spell = settings.proofread !== false
  const set = (k) => (e) => setR((p) => ({ ...p, [k]: e.target.value }))
  const steps = r.steps?.length ? r.steps : ['']

  async function processFiles(files) {
    setErr('')
    try {
      const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (!imgs.length) { setErr('Those files are not images.'); return }
      const compressed = await Promise.all(imgs.map((f) => compressImage(f)))
      setImages((p) => [...p, ...compressed])
    } catch (e) {
      setErr('Image error: ' + e.message)
    }
  }
  function handleFileInput(e) { processFiles(e.target.files); e.target.value = '' }
  function handleDrop(e) { e.preventDefault(); setDragOver(false); processFiles(e.dataTransfer.files) }
  useEffect(() => {
    const onPaste = async (e) => {
      if (tab !== 'photo') return
      const fs = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean)
      if (fs.length) { e.preventDefault(); processFiles(fs) }
    }
    document.addEventListener('paste', onPaste)
    return () => { document.removeEventListener('paste', onPaste) }
  }, [tab])

  function applyExtracted(data, source) {
    setIngredientLines(data.ingredients?.length ? data.ingredients : [''])
    setR((p) => ({
      ...p, title: data.title || p.title, category: data.category || p.category, time: data.time || p.time, servings: data.servings || p.servings,
      notes: data.notes || p.notes, source, steps: data.steps || p.steps,
    }))
  }
  async function runFromPhotos() {
    if (!images.length) { setErr('Add at least one photo.'); return }
    setScanning(true); setErr('')
    try {
      const data = await extractWithClaude(images)
      applyExtracted(data, 'Photo')
      setR((p) => ({ ...p, source_photos: images.map((im) => im.url) }))
      setTab(null)
    } catch (e) {
      setErr('Could not read the photos. (' + e.message + ')')
    } finally {
      setScanning(false)
    }
  }
  async function runFromText() {
    if (!rawText.trim()) { setErr('Paste or type the recipe first.'); return }
    setScanning(true); setErr('')
    try {
      const data = await structureText(rawText)
      applyExtracted(data, 'Text')
      setRawText(''); setTab(null)
    } catch (e) {
      setErr('Could not structure the text. (' + e.message + ')')
    } finally {
      setScanning(false)
    }
  }
  async function handleThumbnail(e) {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const d = await compressThumbnail(f)
      setR((p) => ({ ...p, thumbnail: d }))
    } catch (e) {
      setErr('Photo error: ' + e.message)
    }
    e.target.value = ''
  }
  function save() {
    onSave({
      id: initial?.id, title: r.title.trim() || 'Untitled', category: r.category.trim(), time: r.time.trim(), servings: r.servings.trim(),
      notes: r.notes.trim(), source: r.source || 'Manual', notes_pad: r.notes_pad || '', thumbnail: r.thumbnail || '', source_photos: r.source_photos || [],
      ingredients: ingredientLines.map((l) => l.trim()).filter((l) => l && l !== '##'), steps: (r.steps || []).map((l) => String(l).trim()).filter((l) => l && l !== '##'), id_data: r.id_data || '', media_library: r.media_library || '',
      fixed_lang: r.fixed_lang || null, copied_from: r.copied_from || null, createdAt: initial?.createdAt || Date.now(),
      videos: videoText.split('\n').map((l) => l.trim()).filter(Boolean).map((url) => (initial?.videos || []).find((v) => v.url === url) || newVideo(url)),
    })
  }
  // Another recipe used in this one: a line at the end of the list (replacing an empty last line).
  function addLink(line) {
    const put = (list) => (list.length && !String(list[list.length - 1]).trim() ? [...list.slice(0, -1), line] : [...list, line])
    if (linkFor === 'ing') setIngredientLines(put)
    else setR((p) => ({ ...p, steps: put(p.steps?.length ? p.steps : []) }))
    setLinkFor(null)
  }
  const canLink = library.some((x) => x.id !== initial?.id)

  // Spelling and grammar: the AI proposes corrections, the cook sees each one and applies them.
  async function runProofread() {
    const items = proofreadItems({ title: r.title, ingredients: ingredientLines, steps, notes: r.notes })
    if (!items.length) { toast('Write something first.'); return }
    setProof({ busy: true })
    try {
      const { fixes = [] } = await proofreadTexts(items)
      const from = new Map(items.map((it) => [it.id, it.text]))
      setProof({ fixes: fixes.filter((f) => from.has(f.id)).map((f) => ({ id: f.id, from: from.get(f.id), to: f.text, on: true })) })
    } catch (e) {
      setProof({ error: e.message })
    }
  }
  function applyProofread() {
    const on = (proof?.fixes || []).filter((f) => f.on)
    let skipped = 0
    // Only where the text is still what was checked (it may have been edited meanwhile).
    const fix = (cur, f) => { if (cur === f.from) return f.to; skipped += 1; return cur }
    const byList = (list, prefix) => {
      const mine = on.filter((f) => f.id.startsWith(prefix))
      if (!mine.length) return list
      const n = [...list]
      mine.forEach((f) => { const i = +f.id.slice(prefix.length); n[i] = fix(n[i], f) })
      return n
    }
    const nextIngs = byList(ingredientLines, 'ing')
    const nextSteps = byList(steps, 'step')
    const t = on.find((f) => f.id === 'title'), no = on.find((f) => f.id === 'notes')
    const title = t ? fix(r.title, t) : r.title
    const notes = no ? fix(r.notes, no) : r.notes
    setIngredientLines(nextIngs)
    setR((p) => ({ ...p, title, notes, steps: nextSteps }))
    setProof(null)
    const done = on.length - skipped
    toast(skipped ? `${done} fixed · ${skipped} skipped because the text changed` : `${done} fix${done === 1 ? '' : 'es'} applied`)
  }

  function pickAutofill(k) {
    setErr('')
    if (k === 'pdf') { onImportPdf?.(); return }
    setTab((cur) => (cur === k ? null : k))
  }

  return (
    <div className="Q-ed">
      <div className="Q-ed-head">
        <h2>{initial?.id ? 'Edit recipe' : 'New recipe'}</h2>
        <div className="Q-ed-head-actions">
          {spell && (
            <button className="btn ghost sm Q-proof-btn" onClick={runProofread} disabled={proof?.busy} title="Check spelling and grammar with AI">
              {proof?.busy ? <Loader2 size={14} className="spin" /> : <SpellCheck size={14} />}<span>Check spelling</span>
            </button>
          )}
          <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
          <button className="btn primary sm" onClick={save}>Save</button>
        </div>
      </div>

      <div className={`Q-autofill${tab ? ' open' : ''}`}>
        <div className="Q-autofill-bar">
          <span className="Q-autofill-lbl"><Sparkles size={15} /> Fill in with AI</span>
          <div className="Q-seg">
            {AUTOFILL.filter(([k]) => !(initial && k === 'pdf')).map(([k, l, Icon]) => (
              <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => pickAutofill(k)}><Icon size={14} /> {l}</button>
            ))}
          </div>
        </div>
        {tab === 'text' && (
          <div className="Q-autofill-body">
            <textarea
              className="Q-textarea" value={rawText} onChange={(e) => setRawText(e.target.value)} rows={7} autoFocus
              placeholder="Paste a recipe from anywhere — a website, a message, your notes. AI sorts it into title, ingredients and method."
            />
            <button className="btn primary block" onClick={runFromText} disabled={scanning || !rawText.trim()}>
              {scanning ? <><Loader2 size={15} className="spin" /> Reading…</> : <><Sparkles size={15} /> Fill the form</>}
            </button>
          </div>
        )}
        {tab === 'photo' && (
          <div className="Q-autofill-body">
            <div
              className={`Q-drop${dragOver ? ' over' : ''}`}
              onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
            >
              <Camera size={22} />
              <div className="Q-drop-t">Take or choose photos of the recipe</div>
              <div className="Q-drop-s">Up to 6 pages · drag & drop or paste (⌘V)</div>
              <input type="file" accept="image/*" multiple disabled={scanning} onChange={handleFileInput} aria-label="Choose photos" />
            </div>
            {images.length > 0 && (
              <>
                <div className="Q-thumbs">
                  {images.map((im, i) => (
                    <div className="Q-thumb" key={i}><img src={im.url} alt="" /><button onClick={() => setImages((p) => p.filter((_, j) => j !== i))} disabled={scanning} aria-label="Remove"><X size={11} /></button></div>
                  ))}
                </div>
                <button className="btn primary block" onClick={runFromPhotos} disabled={scanning}>
                  {scanning ? <><Loader2 size={15} className="spin" /> Reading {images.length} photo{images.length > 1 ? 's' : ''}…</> : <><Sparkles size={15} /> Fill the form</>}
                </button>
              </>
            )}
          </div>
        )}
        {err && <div className="Q-err">{err}</div>}
      </div>

      <div className="Q-ed-top">
        <div className="Q-ed-photo">
          {r.thumbnail
            ? <img src={r.thumbnail} onClick={() => setLightboxSrc(r.thumbnail)} alt="" />
            : <label className="Q-ed-photo-ph"><ImagePlus size={22} /><span>Add photo</span><input type="file" accept="image/*" onChange={handleThumbnail} /></label>}
          {r.thumbnail && (
            <div className="Q-ed-photo-actions">
              <label className="Q-link">Change<input type="file" accept="image/*" onChange={handleThumbnail} hidden /></label>
              <button className="Q-link danger" onClick={() => setR((p) => ({ ...p, thumbnail: '' }))}><Trash2 size={12} /></button>
            </div>
          )}
        </div>
        <div className="Q-ed-fields">
          <div className="Q-field"><label>Title</label><input className="Q-title-input" value={r.title} onChange={set('title')} spellCheck={spell} placeholder="e.g. Panettone classico" /></div>
          <div className="Q-grid2">
            <div className="Q-field"><label>Category</label><input value={r.category} onChange={set('category')} placeholder="e.g. Grandi lievitati" /></div>
            <div className="Q-field"><label>Source</label><input value={r.source} onChange={set('source')} placeholder="Book, chef, website…" /></div>
          </div>
          <div className="Q-grid2">
            <div className="Q-field"><label>Time</label><input value={r.time} onChange={set('time')} placeholder="e.g. 36 h" /></div>
            <div className="Q-field"><label>Yield</label><input value={r.servings} onChange={set('servings')} placeholder="e.g. 2 × 1 kg" /></div>
          </div>
        </div>
      </div>

      <div className="Q-field">
        <label>Ingredients</label>
        <DraggableIngList lines={ingredientLines} onChange={setIngredientLines} spellCheck={spell} onAddRecipe={canLink ? () => setLinkFor('ing') : null} />
        <div className="hint">Quantity, unit, then the name — "500 g bread flour". Start a line with → for something made earlier in the recipe ("→ first dough"): it is shown but not added to totals or shopping.{canLink ? ' + Recipe uses another of your recipes in this one — a pâte brisée in a flan.' : ''}</div>
      </div>
      <div className="Q-field">
        <label>Method</label>
        <DraggableIngList kind="step" lines={steps} onChange={(n) => setR((p) => ({ ...p, steps: n }))} spellCheck={spell} onAddRecipe={canLink ? () => setLinkFor('step') : null} />
        <div className="hint">Enter starts the next step. A section groups the steps of one part of the recipe, e.g. "Shaping". Pasting several lines makes one step per line.</div>
      </div>
      <div className="Q-field"><label>Notes</label><textarea className="Q-textarea" rows={3} value={r.notes} onChange={set('notes')} spellCheck={spell} placeholder="Temperatures, flour specs, adjustments…" /></div>
      <div className="Q-field">
        <label>Videos</label>
        <textarea className="Q-textarea" rows={2} value={videoText} onChange={(e) => setVideoText(e.target.value)} placeholder="One link per line — YouTube, Vimeo, Instagram, TikTok…" />
      </div>
      {r.fixed_lang && <div className="Q-dim" style={{ marginBottom: 10 }}>Fixed language version: {r.fixed_lang}</div>}
      <div className="Q-ed-foot">
        <button className="btn primary" onClick={save}>Save recipe</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
      {lightboxSrc && <div className="Q-lightbox" onClick={() => setLightboxSrc(null)}><img src={lightboxSrc} alt="" /></div>}
      {linkFor && <LinkRecipeModal where={linkFor} library={library} selfId={initial?.id} onPick={addLink} onClose={() => setLinkFor(null)} />}
      {proof && !proof.busy && (
        <ProofreadModal
          proof={proof} labelOf={(id) => itemLabel(id, { ingredients: ingredientLines, steps })}
          onToggle={(id) => setProof((p) => ({ ...p, fixes: p.fixes.map((f) => (f.id === id ? { ...f, on: !f.on } : f)) }))}
          onApply={applyProofread} onClose={() => setProof(null)}
        />
      )}
    </div>
  )
}

// Every correction as a before/after of the words that change, ticked by default.
const bare = (t) => String(t).replace(/^##?\s+/, '')
function ProofreadModal({ proof, labelOf, onToggle, onApply, onClose }) {
  const fixes = proof.fixes || []
  const count = fixes.filter((f) => f.on).length
  const footer = fixes.length
    ? <><button className="btn ghost sm" onClick={onClose}>Cancel</button><button className="btn primary sm" onClick={onApply} disabled={!count}>Apply {count} fix{count === 1 ? '' : 'es'}</button></>
    : <button className="btn primary sm" onClick={onClose}>Done</button>
  return (
    <Modal title="Spelling & grammar" icon={SpellCheck} onClose={onClose} width={620} footer={footer}>
      {proof.error && <div className="Q-err">Could not check the text. ({proof.error})</div>}
      {!proof.error && !fixes.length && <p className="Q-proof-none">No spelling or grammar mistakes found.</p>}
      {fixes.length > 0 && (
        <ul className="Q-proof-list">
          {fixes.map((f) => (
            <li key={f.id} className={f.on ? '' : 'off'}>
              <label>
                <input type="checkbox" checked={f.on} onChange={() => onToggle(f.id)} />
                <span className="Q-proof-where">{labelOf(f.id)}</span>
              </label>
              <p className="Q-proof-diff">
                {wordDiff(bare(f.from), bare(f.to)).map((d, i) => (d.op === '=' ? <span key={i}>{d.text}</span> : d.op === '-' ? <del key={i}>{d.text}</del> : <ins key={i}>{d.text}</ins>))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
