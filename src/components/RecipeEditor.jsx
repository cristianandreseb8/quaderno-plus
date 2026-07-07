import { useEffect, useRef, useState } from 'react'
import { compressImage, compressThumbnail } from '../lib/media.js'
import { extractWithClaude, structureText } from '../lib/ai.js'
import DraggableIngList from './DraggableIngList.jsx'

export default function RecipeEditor({ initial, onSave, onCancel }) {
  const initIngs = initial?.ingredients || []
  const [r, setR] = useState(() => ({
    title: initial?.title || '', category: initial?.category || '', time: initial?.time || '', servings: initial?.servings || '',
    notes: initial?.notes || '', source: initial?.source || 'Manual', notes_pad: initial?.notes_pad || '', thumbnail: initial?.thumbnail || '',
    source_photos: initial?.source_photos || [], steps: initial?.steps || [], id_data: initial?.id_data || '', media_library: initial?.media_library || '',
    fixed_lang: initial?.fixed_lang || null, copied_from: initial?.copied_from || null,
  }))
  const [ingredientLines, setIngredientLines] = useState(initIngs)
  const [tab, setTab] = useState('text')
  const [images, setImages] = useState([])
  const [rawText, setRawText] = useState('')
  const [scanning, setScanning] = useState(false)
  const [err, setErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const set = (k) => (e) => setR((p) => ({ ...p, [k]: e.target.value }))

  async function processFiles(files) {
    setErr('')
    try {
      const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (!imgs.length) { setErr('No image files.'); return }
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
    return () => document.removeEventListener('paste', onPaste)
  }, [tab])

  async function runFromPhotos() {
    if (!images.length) { setErr('Add at least one photo.'); return }
    setScanning(true); setErr('')
    try {
      const data = await extractWithClaude(images)
      setIngredientLines(data.ingredients || [])
      setR((p) => ({
        ...p, title: data.title || p.title, category: data.category || p.category, time: data.time || p.time, servings: data.servings || p.servings,
        notes: data.notes || p.notes, source: 'Photo', source_photos: images.map((im) => im.url), steps: data.steps || p.steps,
      }))
    } catch (e) {
      setErr('Could not read photos. (' + e.message + ')')
    } finally {
      setScanning(false)
    }
  }
  async function runFromText() {
    if (!rawText.trim()) { setErr('Paste or type the recipe first.'); return }
    setScanning(true); setErr('')
    try {
      const data = await structureText(rawText)
      setIngredientLines(data.ingredients || [])
      setR((p) => ({
        ...p, title: data.title || p.title, category: data.category || p.category, time: data.time || p.time, servings: data.servings || p.servings,
        notes: data.notes || p.notes, source: 'Text', steps: data.steps || p.steps,
      }))
      setRawText('')
    } catch (e) {
      setErr('Could not structure text. (' + e.message + ')')
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
      setErr('Thumbnail error: ' + e.message)
    }
    e.target.value = ''
  }
  function save() {
    onSave({
      id: initial?.id, title: r.title.trim() || 'Untitled', category: r.category.trim(), time: r.time.trim(), servings: r.servings.trim(),
      notes: r.notes.trim(), source: r.source || 'Manual', notes_pad: r.notes_pad || '', thumbnail: r.thumbnail || '', source_photos: r.source_photos || [],
      ingredients: ingredientLines.filter(Boolean), steps: r.steps || [], id_data: r.id_data || '', media_library: r.media_library || '',
      fixed_lang: r.fixed_lang || null, copied_from: r.copied_from || null, createdAt: initial?.createdAt || Date.now(),
    })
  }

  return (
    <div className="Q-ed">
      <h2>{initial?.id ? 'Edit recipe' : 'New recipe'}</h2>
      <div style={{ border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 18, overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--rule)', background: '#f5efe6' }}>
          {[['text', '📋 Paste text'], ['photo', '📷 From photo']].map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); setErr('') }} style={{
              flex: 1, padding: '9px 8px', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10.5, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '.1em', background: tab === k ? '#fff' : 'transparent', color: tab === k ? 'var(--navy)' : 'var(--muted)',
              borderBottom: tab === k ? '2px solid var(--amber)' : '2px solid transparent',
            }}>{l}</button>
          ))}
        </div>
        <div style={{ padding: '13px 15px' }}>
          {tab === 'text' && (
            <>
              <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '0 0 9px', lineHeight: 1.5 }}>Paste any recipe text. Claude structures it automatically.</p>
              <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={6} placeholder="Paste recipe text here…"
                style={{ width: '100%', border: '1px solid var(--rule)', borderRadius: 7, padding: '9px 11px', fontSize: 13, fontFamily: 'var(--sans)', color: 'var(--ink)', resize: 'vertical', background: '#fff', display: 'block', marginBottom: 9 }} />
              <button className="btn amber xs" onClick={runFromText} disabled={scanning || !rawText.trim()} style={{ width: '100%', padding: 9, fontSize: 13 }}>
                {scanning ? 'Structuring…' : 'Structure with Claude →'}
              </button>
            </>
          )}
          {tab === 'photo' && (
            <>
              <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '0 0 9px', lineHeight: 1.5 }}>Upload 1–6 photos. Auto-compressed.</p>
              <div onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
                style={{ position: 'relative', borderRadius: 8, marginBottom: 9, border: `2px dashed ${dragOver ? 'var(--navy)' : 'var(--amber)'}`, background: dragOver ? '#EAF2EE' : 'rgba(188,108,44,.05)', padding: '18px 12px', textAlign: 'center', cursor: scanning ? 'default' : 'pointer' }}>
                <div style={{ pointerEvents: 'none' }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>📷</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)' }}>Tap · drag & drop · paste ⌘V</div>
                </div>
                <input type="file" accept="image/*" multiple disabled={scanning} onChange={handleFileInput} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: scanning ? 'default' : 'pointer' }} />
              </div>
              {images.length > 0 && (
                <>
                  <div className="Q-thumbs">
                    {images.map((im, i) => (
                      <div className="Q-thumb" key={i}><img src={im.url} alt="" /><button onClick={() => setImages((p) => p.filter((_, j) => j !== i))} disabled={scanning}>×</button></div>
                    ))}
                  </div>
                  <button className="btn amber xs" onClick={runFromPhotos} disabled={scanning} style={{ marginTop: 7, width: '100%', padding: 9, fontSize: 13 }}>
                    {scanning ? `Reading ${images.length} photo${images.length > 1 ? 's' : ''}…` : 'Extract with Claude →'}
                  </button>
                </>
              )}
            </>
          )}
          {err && <div className="Q-err" style={{ marginTop: 7 }}>{err}</div>}
        </div>
      </div>
      <div className="Q-field">
        <label>Thumbnail photo</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {r.thumbnail && <img src={r.thumbnail} style={{ width: 58, height: 58, borderRadius: 6, objectFit: 'cover', cursor: 'pointer', border: '1px solid var(--rule)' }} onClick={() => setLightboxSrc(r.thumbnail)} alt="" />}
          <label className="btn ghost xs" style={{ cursor: 'pointer' }}>{r.thumbnail ? 'Change' : 'Add photo'}<input type="file" accept="image/*" onChange={handleThumbnail} style={{ display: 'none' }} /></label>
          {r.thumbnail && <button className="btn danger xs" onClick={() => setR((p) => ({ ...p, thumbnail: '' }))}>Remove</button>}
        </div>
        <div className="hint">Compressed · appears in list, recipe header, and all exports</div>
      </div>
      <div className="Q-field"><label>Title</label><input value={r.title} onChange={set('title')} placeholder="Panettone Classico" /></div>
      <div className="Q-grid2">
        <div className="Q-field"><label>Category</label><input value={r.category} onChange={set('category')} placeholder="Grandi Lievitati" /></div>
        <div className="Q-field"><label>Source</label><input value={r.source} onChange={set('source')} /></div>
      </div>
      <div className="Q-grid2">
        <div className="Q-field"><label>Time</label><input value={r.time} onChange={set('time')} placeholder="~36 h" /></div>
        <div className="Q-field"><label>Yield</label><input value={r.servings} onChange={set('servings')} placeholder="2 × 1 kg" /></div>
      </div>
      <div className="Q-field">
        <label>Ingredients — drag ⠇ to reorder</label>
        <DraggableIngList lines={ingredientLines} onChange={setIngredientLines} />
        <div className="hint">Drag to reorder · × to remove · use <strong>+ Section</strong> for ## headers</div>
      </div>
      <div className="Q-field">
        <label>Method — one step per line</label>
        <textarea rows={7} value={(r.steps || []).join('\n')} onChange={(e) => setR((p) => ({ ...p, steps: e.target.value.split('\n') }))} placeholder="Step 1…" />
      </div>
      <div className="Q-field"><label>Baker's notes</label><textarea rows={2} value={r.notes} onChange={set('notes')} placeholder="Temperatures, flour specs, adjustments…" /></div>
      {r.fixed_lang && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--teal)', marginBottom: 10 }}>📌 Fixed language: {r.fixed_lang}</div>}
      <div className="Q-ed-foot">
        <button className="btn" onClick={save}>Save recipe</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
      {lightboxSrc && <div className="Q-lightbox" onClick={() => setLightboxSrc(null)}><img src={lightboxSrc} alt="" /></div>}
    </div>
  )
}
