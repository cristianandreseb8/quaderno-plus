import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import {
  AlertTriangle, ExternalLink, FileText, FileUp, Loader2, Pause, Play, RotateCcw, Search, Trash2,
} from 'lucide-react'
import Modal from './ui/Modal.jsx'
import { toast } from './ui/Toaster.jsx'
import { extractPdfRecipes } from '../lib/ai.js'
import { dbDelete, dbInsert } from '../lib/db.js'

// A book is read in small batches: a few pages plus one look-ahead page, so a recipe that
// runs onto the next page is still captured whole and every request stays short.
const PAGES_PER_BATCH = 3
const CONCURRENCY = 2
const MAX_BATCH_BYTES = 7 * 1024 * 1024 // keeps the base64 request comfortably under the API's 32 MB
const COST_PER_PAGE = 0.03 // rough USD estimate for the most capable model
const SECONDS_PER_PAGE = 5
const STORE = 'qdplus_pdf_import'

function toBase64(bytes) {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
  return btoa(bin)
}
const cleanName = (name) => name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB')
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms) })
const pageLabel = (c) => (c.start === c.end ? `page ${c.start}` : `pages ${c.start}–${c.end}`)

function planBatches(from, to) {
  const out = []
  for (let s = from; s <= to; s += PAGES_PER_BATCH) out.push({ start: s, end: Math.min(to, s + PAGES_PER_BATCH - 1), status: 'pending', found: 0 })
  return out
}
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null') } catch (_) { return null }
}

export default function PdfImport({ hidden, onHide, onStatus, onSaved, onRemoved, onOpenRecipe, onShowAll, knownCategories }) {
  const [phase, setPhase] = useState('pick') // pick | ready | running | paused | done
  const [file, setFile] = useState(null) // { name, size, pages, key, encrypted }
  const [loadingFile, setLoadingFile] = useState(false)
  const [fileErr, setFileErr] = useState('')
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(1)
  const [source, setSource] = useState('')
  const [mode, setMode] = useState('book')
  const [batches, setBatches] = useState([])
  const [results, setResults] = useState([])
  const [resumable, setResumable] = useState(() => {
    const s = loadSaved()
    return s && s.batches?.some((b) => b.status !== 'done') ? s : null
  })
  const [dragOver, setDragOver] = useState(false)

  const docRef = useRef(null)
  const batchesRef = useRef([])
  const resultsRef = useRef([])
  const seenRef = useRef(new Set())
  const runRef = useRef(0)
  const settingsRef = useRef({})
  const knownRef = useRef(knownCategories)
  const hiddenRef = useRef(hidden)
  useEffect(() => { knownRef.current = knownCategories }, [knownCategories])
  useEffect(() => { hiddenRef.current = hidden }, [hidden])

  const syncBatches = useCallback(() => { setBatches(batchesRef.current.map((b) => ({ ...b }))) }, [])
  const persist = useCallback(() => {
    if (!file) return
    const s = settingsRef.current
    try {
      localStorage.setItem(STORE, JSON.stringify({
        key: file.key, name: file.name, from: s.from, to: s.to, source: s.source, mode: s.mode,
        batches: batchesRef.current.map(({ start, end, status, found, error }) => ({ start, end, status: status === 'running' ? 'pending' : status, found, error })),
        results: resultsRef.current,
      }))
    } catch (_) { /* storage full — progress just won't survive a reload */ }
  }, [file])

  // ── progress reporting ────────────────────────────────────────────────────
  const totalPages = batches.reduce((n, b) => n + (b.end - b.start + 1), 0)
  const donePages = batches.filter((b) => b.status === 'done').reduce((n, b) => n + (b.end - b.start + 1), 0)
  const failed = batches.filter((b) => b.status === 'error')
  const pct = totalPages ? Math.round((donePages / totalPages) * 100) : 0
  const active = batches.filter((b) => b.status === 'running')

  useEffect(() => {
    if (phase === 'running' || phase === 'paused') onStatus({ pct, found: results.length })
    else onStatus(null)
  }, [phase, pct, results.length, onStatus])

  useEffect(() => {
    if (phase !== 'running') return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    let lock = null
    navigator.wakeLock?.request?.('screen').then((l) => { lock = l }, () => {})
    return () => { window.removeEventListener('beforeunload', warn); lock?.release?.().catch(() => {}) }
  }, [phase])

  // ── file loading ──────────────────────────────────────────────────────────
  async function openFile(f) {
    if (!f) return
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { setFileErr('That is not a PDF file.'); return }
    setFileErr(''); setLoadingFile(true)
    try {
      const buf = await f.arrayBuffer()
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })
      docRef.current = doc
      const pages = doc.getPageCount()
      const key = `${f.name}|${f.size}|${pages}`
      const info = { name: f.name, size: f.size, pages, key, encrypted: doc.isEncrypted }
      setFile(info)
      const saved = loadSaved()
      if (saved && saved.key === key && saved.batches?.some((b) => b.status !== 'done')) {
        setFrom(saved.from); setTo(saved.to); setSource(saved.source); setMode(saved.mode)
        batchesRef.current = saved.batches.map((b) => ({ ...b }))
        resultsRef.current = saved.results || []
        seenRef.current = new Set(resultsRef.current.map((r) => r.title.toLowerCase().trim() + '|' + r.page))
        setResults(resultsRef.current); syncBatches()
        settingsRef.current = { from: saved.from, to: saved.to, source: saved.source, mode: saved.mode }
        setPhase('paused')
      } else {
        setFrom(1); setTo(pages); setSource(cleanName(f.name)); setMode(pages > 12 ? 'book' : 'own')
        batchesRef.current = []; resultsRef.current = []; seenRef.current = new Set()
        setBatches([]); setResults([])
        setPhase('ready')
      }
      setResumable(null)
    } catch (e) {
      setFileErr('This PDF could not be opened (' + e.message + ').')
    } finally {
      setLoadingFile(false)
    }
  }

  async function buildPdf(pageNumbers) {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(docRef.current, pageNumbers.map((n) => n - 1))
    copied.forEach((p) => out.addPage(p))
    return out.save()
  }

  // ── batch processing ──────────────────────────────────────────────────────
  function splitBatch(batch) {
    const singles = []
    for (let p = batch.start; p <= batch.end; p++) singles.push({ start: p, end: p, status: 'pending', found: 0 })
    const i = batchesRef.current.indexOf(batch)
    batchesRef.current.splice(i, 1, ...singles)
  }

  async function saveRecipe(r, pageFallback) {
    const page = Number.isFinite(r.page) && r.page > 0 ? r.page : pageFallback
    const title = String(r.title || '').trim() || 'Untitled recipe'
    const ingredients = (r.ingredients || []).map((x) => String(x).trim()).filter(Boolean)
    const steps = (r.steps || []).map((x) => String(x).trim()).filter(Boolean)
    if (!ingredients.length && !steps.length) return
    const key = title.toLowerCase() + '|' + page
    if (seenRef.current.has(key)) return
    seenRef.current.add(key)
    const s = settingsRef.current
    const warn = r.complete === false ? `May be incomplete — check page ${page} of the original.` : ''
    const saved = await dbInsert({
      title, category: String(r.category || '').trim(), time: String(r.time || '').trim(), servings: String(r.servings || '').trim(),
      ingredients, steps, notes: [warn, String(r.notes || '').trim()].filter(Boolean).join('\n'),
      source: `${s.source || 'PDF'} · p. ${page}`,
      notes_pad: '', thumbnail: '', source_photos: [], id_data: '', media_library: '', fixed_lang: null, copied_from: null,
    })
    const row = { id: saved.id, title: saved.title, category: saved.category, page, complete: r.complete !== false }
    resultsRef.current = [...resultsRef.current, row]
    setResults(resultsRef.current)
    onSaved(saved)
  }

  async function processBatch(batch) {
    const total = docRef.current.getPageCount()
    let ctx = batch.end < total ? batch.end + 1 : null
    const range = []
    for (let p = batch.start; p <= batch.end; p++) range.push(p)
    let bytes = await buildPdf(ctx ? [...range, ctx] : range)
    if (bytes.length > MAX_BATCH_BYTES && ctx) { ctx = null; bytes = await buildPdf(range) }
    if (bytes.length > MAX_BATCH_BYTES) {
      if (batch.end > batch.start) { splitBatch(batch); return }
      throw new Error('This page is too large to send (' + fmtSize(bytes.length) + ').')
    }
    const s = settingsRef.current
    const known = [...new Set([...(knownRef.current || []), ...resultsRef.current.map((r) => r.category).filter(Boolean)])]
    const payload = { pdf: toBase64(bytes), first_page: batch.start, last_page: batch.end, context_page: ctx, source: s.source, mode: s.mode, known_categories: known }
    let lastErr
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await extractPdfRecipes(payload)
        let n = 0
        for (const r of res.recipes || []) {
          const before = resultsRef.current.length
          await saveRecipe(r, batch.start)
          if (resultsRef.current.length > before) n++
        }
        batch.found = n
        return
      } catch (e) {
        lastErr = e
        // Too many recipes for one answer, or too slow: read the pages one at a time instead.
        const tooBig = /TOO_MUCH_CONTENT|took too long/i.test(e.message)
        if (tooBig && batch.end > batch.start) { splitBatch(batch); return }
        if (attempt < 2) await sleep(2500 * (attempt + 1))
      }
    }
    throw lastErr
  }

  async function worker(myRun) {
    while (runRef.current === myRun) {
      const batch = batchesRef.current.find((b) => b.status === 'pending')
      if (!batch) return
      batch.status = 'running'; syncBatches()
      try {
        await processBatch(batch)
        if (batchesRef.current.includes(batch)) batch.status = 'done'
      } catch (e) {
        batch.status = 'error'; batch.error = e.message
      }
      syncBatches(); persist()
    }
  }

  async function run() {
    const myRun = ++runRef.current
    setPhase('running')
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(myRun)))
    if (runRef.current !== myRun) return // paused, or a new run took over
    persist()
    const errors = batchesRef.current.filter((b) => b.status === 'error').length
    setPhase('done')
    if (hiddenRef.current) toast.success(`PDF import finished — ${resultsRef.current.length} recipes${errors ? `, ${errors} batch${errors > 1 ? 'es' : ''} failed` : ''}`)
  }

  function start() {
    const f = Math.max(1, Math.min(file.pages, Math.round(Number(from)) || 1))
    const t = Math.max(f, Math.min(file.pages, Math.round(Number(to)) || file.pages))
    setFrom(f); setTo(t)
    settingsRef.current = { from: f, to: t, source: source.trim() || cleanName(file.name), mode }
    batchesRef.current = planBatches(f, t)
    syncBatches(); persist()
    run()
  }
  function pause() { runRef.current++; setPhase('paused'); persist() }
  function retryFailed() {
    batchesRef.current.forEach((b) => { if (b.status === 'error') { b.status = 'pending'; delete b.error } })
    syncBatches(); run()
  }
  function reset() {
    runRef.current++
    try { localStorage.removeItem(STORE) } catch (_) { /* ignore */ }
    docRef.current = null; batchesRef.current = []; resultsRef.current = []; seenRef.current = new Set()
    setFile(null); setBatches([]); setResults([]); setPhase('pick')
  }
  async function removeResult(row) {
    try {
      await dbDelete(row.id)
      resultsRef.current = resultsRef.current.filter((r) => r.id !== row.id)
      setResults(resultsRef.current); persist(); onRemoved(row.id)
    } catch (e) {
      toast.error('Could not remove: ' + e.message)
    }
  }
  function close() {
    if (phase === 'running') { onHide(); toast('The import keeps running — follow it from the top bar.'); return }
    if (phase === 'done' && failed.length === 0) { try { localStorage.removeItem(STORE) } catch (_) { /* ignore */ } }
    onStatus(null); onHide()
  }

  const selPages = Math.max(0, (Number(to) || 0) - (Number(from) || 0) + 1)
  const estimate = useMemo(() => {
    const cost = selPages * COST_PER_PAGE
    const mins = Math.max(1, Math.round((selPages * SECONDS_PER_PAGE) / 60))
    return { cost: cost < 1 ? cost.toFixed(2) : cost.toFixed(0), mins, requests: Math.ceil(selPages / PAGES_PER_BATCH) }
  }, [selPages])

  const busy = phase === 'running'
  const footer = (
    <>
      {phase === 'ready' && (
        <>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={start} disabled={selPages < 1}><Play size={15} /> Start import</button>
        </>
      )}
      {(phase === 'running' || phase === 'paused') && (
        <>
          <button className="btn ghost" onClick={close}>{busy ? 'Keep working meanwhile' : 'Close'}</button>
          {busy
            ? <button className="btn ghost" onClick={pause}><Pause size={15} /> Pause</button>
            : <button className="btn primary" onClick={run}><Play size={15} /> {donePages ? 'Continue' : 'Start'}</button>}
        </>
      )}
      {phase === 'done' && (
        <>
          <button className="btn ghost" onClick={reset}><FileUp size={15} /> Import another</button>
          {results.length > 0 && <button className="btn ghost" onClick={() => onShowAll(settingsRef.current.source)}><Search size={15} /> Show in list</button>}
          <button className="btn primary" onClick={close}>Done</button>
        </>
      )}
    </>
  )

  return (
    <Modal title="Import from PDF" icon={FileUp} onClose={close} width={640} hidden={hidden} footer={phase !== 'pick' ? footer : null} className="Q-import">
      {phase === 'pick' && (
        <>
          <label
            className={`Q-drop big${dragOver ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); openFile(e.dataTransfer.files?.[0]) }}
          >
            {loadingFile ? <Loader2 size={26} className="spin" /> : <FileUp size={26} />}
            <div className="Q-drop-t">{loadingFile ? 'Opening…' : 'Choose a PDF'}</div>
            <div className="Q-drop-s">One recipe, a folder of recipes, or a whole cookbook. AI finds each recipe and adds it to your library.</div>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = '' }} disabled={loadingFile} />
          </label>
          {fileErr && <div className="Q-err">{fileErr}</div>}
          {resumable && (
            <div className="Q-note">
              <RotateCcw size={15} />
              <div>
                <b>Unfinished import: {resumable.name}</b>
                <span>{resumable.results?.length || 0} recipes saved so far. Choose the same file again to continue where it stopped.</span>
              </div>
              <button className="Q-link" onClick={() => { try { localStorage.removeItem(STORE) } catch (_) { /* ignore */ } setResumable(null) }}>Forget</button>
            </div>
          )}
        </>
      )}

      {phase !== 'pick' && file && (
        <div className="Q-file-card">
          <FileText size={22} />
          <div>
            <b>{file.name}</b>
            <span>{file.pages} page{file.pages === 1 ? '' : 's'} · {fmtSize(file.size)}</span>
          </div>
          {phase === 'ready' && <button className="Q-link" onClick={reset}>Change</button>}
        </div>
      )}
      {file?.encrypted && phase === 'ready' && <div className="Q-note warn"><AlertTriangle size={15} /><div><span>This PDF is protected. Some pages may come out empty.</span></div></div>}

      {phase === 'ready' && (
        <div className="Q-import-form">
          <div className="Q-field">
            <label>Pages to read</label>
            <div className="Q-range">
              <input type="number" min={1} max={file.pages} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="First page" />
              <span>to</span>
              <input type="number" min={1} max={file.pages} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Last page" />
              <span className="Q-dim">of {file.pages}</span>
              {(Number(from) !== 1 || Number(to) !== file.pages) && <button className="Q-link" onClick={() => { setFrom(1); setTo(file.pages) }}>All pages</button>}
            </div>
            <div className="hint">For a cookbook, skip the introduction and index to save time and cost.</div>
          </div>
          <div className="Q-field">
            <label>Book or source name</label>
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Tartine Bread" />
            <div className="hint">Saved on every recipe with its page number, so you can always find the original.</div>
          </div>
          <div className="Q-field">
            <label>Method</label>
            <div className="Q-seg">
              <button type="button" className={mode === 'book' ? 'on' : ''} onClick={() => setMode('book')}>Condensed</button>
              <button type="button" className={mode === 'own' ? 'on' : ''} onClick={() => setMode('own')}>As written</button>
            </div>
            <div className="hint">
              {mode === 'book'
                ? 'For published books: short, clear steps in new words, keeping every quantity, temperature and time. Stories are left out.'
                : 'For your own documents: the method is copied exactly as written.'}
            </div>
          </div>
          <div className="Q-estimate">
            <b>{selPages} page{selPages === 1 ? '' : 's'}</b> · about {estimate.mins} min · roughly ${estimate.cost} of AI usage.
            You can keep working while it runs.
          </div>
        </div>
      )}

      {(phase === 'running' || phase === 'paused' || phase === 'done') && (
        <div className="Q-progress-wrap">
          <div className="Q-progress"><i style={{ width: pct + '%' }} /></div>
          <div className="Q-progress-meta">
            <span>
              {phase === 'done' ? 'Finished' : phase === 'paused' ? 'Paused' : active.length ? `Reading ${active.map(pageLabel).join(', ')}` : 'Starting…'}
              {busy && <Loader2 size={13} className="spin" />}
            </span>
            <span>{donePages} / {totalPages} pages · <b>{results.length}</b> recipe{results.length === 1 ? '' : 's'}</span>
          </div>
          {failed.length > 0 && (
            <div className="Q-note warn">
              <AlertTriangle size={15} />
              <div>
                <b>{failed.length} batch{failed.length > 1 ? 'es' : ''} could not be read</b>
                <span>{failed.slice(0, 4).map(pageLabel).join(', ')}{failed.length > 4 ? '…' : ''}{failed[0].error ? ` — ${failed[0].error}` : ''}</span>
              </div>
              {!busy && <button className="Q-link" onClick={retryFailed}>Retry</button>}
            </div>
          )}
          {phase === 'done' && results.length === 0 && failed.length === 0 && (
            <div className="Q-note"><FileText size={15} /><div><span>No recipes were found in these pages.</span></div></div>
          )}
        </div>
      )}

      {results.length > 0 && (
        <div className="Q-import-results">
          {[...results].reverse().map((r) => (
            <div key={r.id} className="Q-import-row">
              <div className="Q-import-row-txt">
                <b>{r.title}</b>
                <span>{[r.category, `p. ${r.page}`].filter(Boolean).join(' · ')}{!r.complete && <em> · check against the book</em>}</span>
              </div>
              <button className="Q-icon-btn" title="Open recipe" onClick={() => onOpenRecipe(r.id)}><ExternalLink size={15} /></button>
              <button className="Q-icon-btn danger" title="Remove this recipe" onClick={() => removeResult(r)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
