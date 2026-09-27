import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { AlertTriangle, ExternalLink, FileText, FileUp, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import Modal from './ui/Modal.jsx'
import { toast } from './ui/Toaster.jsx'
import { extractPdfRecipes, pdfOutline, pdfRecipe } from '../lib/ai.js'
import { dbDelete, dbInsert } from '../lib/db.js'

// How a PDF is read:
//  - Short documents (≤ DIRECT_MAX pages) go in one request that returns every recipe in them.
//  - Longer ones get a quick first pass that maps where each recipe lives (a recipe's method
//    is often pages away from its ingredient table), then each recipe is read on its own with
//    all of its pages, so nothing is cut at an arbitrary page boundary.
const DIRECT_MAX = 8
const OUTLINE_PAGES = 12
const MAX_RECIPE_PAGES = 14
const CONCURRENCY = 3
const MAX_BATCH_BYTES = 7 * 1024 * 1024 // keeps the base64 request comfortably under the API's 32 MB
const STORE = 'qdplus_pdf_import_v2'

function toBase64(bytes) {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
  return btoa(bin)
}
const cleanName = (name) => name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB')
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms) })
const pagesLabel = (a, b) => (a === b ? `page ${a}` : `pages ${a}–${b}`)
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
let nextTaskId = 1
const task = (kind, start, end, extra = {}) => ({ id: nextTaskId++, kind, start, end, status: 'pending', ...extra })

function planTasks(from, to) {
  if (to - from + 1 <= DIRECT_MAX) return [task('direct', from, to)]
  const out = []
  for (let s = from; s <= to; s += OUTLINE_PAGES) out.push(task('outline', s, Math.min(to, s + OUTLINE_PAGES - 1)))
  return out
}

function estimate(pages) {
  if (pages <= DIRECT_MAX) return { cost: Math.max(0.05, pages * 0.03), mins: 1 }
  const recipes = Math.ceil(pages / 2)
  const seconds = (Math.ceil(pages / OUTLINE_PAGES) * 25 + recipes * 35) / CONCURRENCY
  return { cost: pages * 0.05, mins: Math.max(1, Math.round(seconds / 60)) }
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null') } catch (_) { return null }
}

export default function PdfImport({ hidden, onHide, onStatus, onSaved, onRemoved, onOpenRecipe, onShowAll, knownCategories }) {
  const [phase, setPhase] = useState('pick') // pick | ready | running | paused | done
  const [file, setFile] = useState(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [fileErr, setFileErr] = useState('')
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(1)
  const [source, setSource] = useState('')
  const [mode, setMode] = useState('book')
  const [tasks, setTasks] = useState([])
  const [results, setResults] = useState([])
  const [resumable, setResumable] = useState(() => {
    const s = loadSaved()
    return s && s.tasks?.some((t) => t.status !== 'done') ? s : null
  })
  const [dragOver, setDragOver] = useState(false)

  const docRef = useRef(null)
  const tasksRef = useRef([])
  const outlineRef = useRef({}) // outline task start page → recipes found in that batch
  const resultsRef = useRef([])
  const seenRef = useRef(new Set())
  const runRef = useRef(0)
  const settingsRef = useRef({})
  const knownRef = useRef(knownCategories)
  const hiddenRef = useRef(hidden)
  useEffect(() => { knownRef.current = knownCategories }, [knownCategories])
  useEffect(() => { hiddenRef.current = hidden }, [hidden])

  const sync = useCallback(() => { setTasks(tasksRef.current.map((t) => ({ ...t }))) }, [])
  const persist = useCallback(() => {
    if (!file) return
    try {
      localStorage.setItem(STORE, JSON.stringify({
        key: file.key, name: file.name, ...settingsRef.current,
        tasks: tasksRef.current.map((t) => ({ ...t, status: t.status === 'running' ? 'pending' : t.status })),
        outline: outlineRef.current,
        results: resultsRef.current,
      }))
    } catch (_) { /* storage full — progress just won't survive a reload */ }
  }, [file])

  // ── progress ──────────────────────────────────────────────────────────────
  const scanTasks = tasks.filter((t) => t.kind !== 'recipe')
  const recipeTasks = tasks.filter((t) => t.kind === 'recipe')
  const settled = (t) => t.status === 'done' || t.status === 'error'
  const scanPages = scanTasks.reduce((n, t) => n + t.end - t.start + 1, 0)
  const scanDone = scanTasks.filter(settled).reduce((n, t) => n + t.end - t.start + 1, 0)
  const hasOutline = scanTasks.some((t) => t.kind === 'outline')
  const pct = !tasks.length ? 0 : hasOutline
    ? Math.round((scanPages ? (scanDone / scanPages) * 25 : 0) + (recipeTasks.length ? (recipeTasks.filter(settled).length / recipeTasks.length) * 75 : 0))
    : Math.round(scanPages ? (scanDone / scanPages) * 100 : 0)
  const failed = tasks.filter((t) => t.status === 'error')
  const active = tasks.filter((t) => t.status === 'running')

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

  // ── file ──────────────────────────────────────────────────────────────────
  async function openFile(f) {
    if (!f) return
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { setFileErr('That is not a PDF file.'); return }
    setFileErr(''); setLoadingFile(true)
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false })
      docRef.current = doc
      const pages = doc.getPageCount()
      const key = `${f.name}|${f.size}|${pages}`
      setFile({ name: f.name, size: f.size, pages, key, encrypted: doc.isEncrypted })
      const saved = loadSaved()
      if (saved && saved.key === key && saved.tasks?.some((t) => t.status !== 'done')) {
        setFrom(saved.from); setTo(saved.to); setSource(saved.source); setMode(saved.mode)
        settingsRef.current = { from: saved.from, to: saved.to, source: saved.source, mode: saved.mode }
        tasksRef.current = saved.tasks.map((t) => ({ ...t, id: nextTaskId++ }))
        outlineRef.current = saved.outline || {}
        resultsRef.current = saved.results || []
        seenRef.current = new Set(resultsRef.current.map((r) => r.title.toLowerCase().trim() + '|' + r.page))
        setResults(resultsRef.current); sync()
        setPhase('paused')
      } else {
        setFrom(1); setTo(pages); setSource(cleanName(f.name)); setMode(pages > 12 ? 'book' : 'own')
        tasksRef.current = []; outlineRef.current = {}; resultsRef.current = []; seenRef.current = new Set()
        setTasks([]); setResults([])
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

  // ── saving ────────────────────────────────────────────────────────────────
  async function saveRecipe(r, page, complete = true) {
    const title = String(r.title || '').trim() || 'Untitled recipe'
    const ingredients = (r.ingredients || []).map((x) => String(x).trim()).filter(Boolean)
    const steps = (r.steps || []).map((x) => String(x).trim()).filter(Boolean)
    if (!ingredients.length && !steps.length) return null
    const key = title.toLowerCase() + '|' + page
    if (seenRef.current.has(key)) return null
    seenRef.current.add(key)
    const s = settingsRef.current
    const warn = complete ? '' : `Some parts may be missing — check page ${page} of the original.`
    const saved = await dbInsert({
      title, category: String(r.category || '').trim(), time: String(r.time || '').trim(), servings: String(r.servings || '').trim(),
      ingredients, steps, notes: [warn, String(r.notes || '').trim()].filter(Boolean).join('\n'),
      source: `${s.source || 'PDF'} · p. ${page}`,
      notes_pad: '', thumbnail: '', source_photos: [], id_data: '', media_library: '', fixed_lang: null, copied_from: null,
    })
    const row = { id: saved.id, title: saved.title, category: saved.category, page, complete }
    resultsRef.current = [...resultsRef.current, row]
    setResults(resultsRef.current)
    onSaved(saved)
    return saved
  }

  // ── outline → recipe tasks ────────────────────────────────────────────────
  // Stitch the per-batch maps into one list of recipes with page ranges, then add a reading
  // task for every recipe that does not have one yet (safe to call repeatedly).
  function addRecipeTasks() {
    const { to: last } = settingsRef.current
    const batches = Object.keys(outlineRef.current).map(Number).sort((a, b) => a - b)
    const list = []
    for (const b of batches) {
      for (const it of [...outlineRef.current[b]].sort((x, y) => x.start_page - y.start_page)) {
        if (it.continued_from_before || !String(it.title || '').trim()) {
          if (list.length) list[list.length - 1].end = Math.max(list[list.length - 1].end, it.end_page)
          continue
        }
        if (list.some((x) => x.start === it.start_page)) continue
        list.push({ title: it.title.trim(), start: it.start_page, end: Math.max(it.start_page, it.end_page), continues: it.continues })
      }
    }
    list.sort((a, b) => a.start - b.start)
    list.forEach((r, i) => {
      const next = list[i + 1]
      if (r.continues) r.end = Math.max(r.end, next ? next.start - 1 : last)
      if (next) r.end = Math.min(r.end, Math.max(r.start, next.start))
      r.end = Math.min(r.end, r.start + MAX_RECIPE_PAGES - 1, last)
    })
    for (const r of list) {
      if (!tasksRef.current.some((t) => t.kind === 'recipe' && t.start === r.start)) tasksRef.current.push(task('recipe', r.start, r.end, { title: r.title }))
    }
  }

  function replaceTask(t, replacements) {
    const i = tasksRef.current.indexOf(t)
    tasksRef.current.splice(i, 1, ...replacements)
  }
  const tooBig = (e) => /TOO_MUCH_CONTENT|took too long/i.test(e.message)

  async function withRetries(fn) {
    let lastErr
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await fn() } catch (e) {
        lastErr = e
        if (tooBig(e)) throw e
        if (attempt < 2) await sleep(2500 * (attempt + 1))
      }
    }
    throw lastErr
  }

  async function processTask(t) {
    const s = settingsRef.current
    const known = () => [...new Set([...(knownRef.current || []), ...resultsRef.current.map((r) => r.category).filter(Boolean)])]
    const total = docRef.current.getPageCount()

    if (t.kind === 'direct') {
      const bytes = await buildPdf(range(t.start, t.end))
      if (bytes.length > MAX_BATCH_BYTES) { replaceTask(t, [task('outline', t.start, t.end)]); return 'replaced' }
      try {
        const res = await withRetries(() => extractPdfRecipes({ pdf: toBase64(bytes), first_page: t.start, last_page: t.end, context_page: null, source: s.source, mode: s.mode, known_categories: known() }))
        for (const r of res.recipes || []) {
          const page = Number.isFinite(r.page) && r.page >= t.start && r.page <= t.end ? r.page : t.start
          await saveRecipe(r, page, r.complete !== false)
        }
      } catch (e) {
        if (!tooBig(e)) throw e
        replaceTask(t, [task('outline', t.start, t.end)]); return 'replaced'
      }
      return 'done'
    }

    if (t.kind === 'outline') {
      const bytes = await buildPdf(range(t.start, t.end))
      if (bytes.length > MAX_BATCH_BYTES && t.end > t.start) {
        const mid = Math.floor((t.start + t.end) / 2)
        replaceTask(t, [task('outline', t.start, mid), task('outline', mid + 1, t.end)]); return 'replaced'
      }
      const res = await withRetries(() => pdfOutline({ pdf: toBase64(bytes), first_page: t.start, last_page: t.end, total_pages: total, source: s.source }))
      outlineRef.current = { ...outlineRef.current, [t.start]: res.recipes || [] }
      return 'done'
    }

    // recipe: read it with all of its pages; drop trailing pages only if the file is too large.
    let end = t.end
    let bytes = await buildPdf(range(t.start, end))
    while (bytes.length > MAX_BATCH_BYTES && end > t.start) { end -= 1; bytes = await buildPdf(range(t.start, end)) }
    if (bytes.length > MAX_BATCH_BYTES) throw new Error(`Page ${t.start} is too large to send (${fmtSize(bytes.length)}).`)
    const res = await withRetries(() => pdfRecipe({ pdf: toBase64(bytes), first_page: t.start, last_page: end, title: t.title, source: s.source, mode: s.mode, known_categories: known() }))
    const saved = await saveRecipe(res.recipe || {}, t.start, end === t.end)
    if (saved) t.savedId = saved.id
    return 'done'
  }

  function nextTask() {
    const ts = tasksRef.current
    const scan = ts.find((t) => t.kind !== 'recipe' && t.status === 'pending')
    if (scan) return scan
    if (ts.some((t) => t.kind !== 'recipe' && t.status === 'running')) return 'wait'
    if (ts.some((t) => t.kind === 'outline')) addRecipeTasks()
    return ts.find((t) => t.kind === 'recipe' && t.status === 'pending') || null
  }

  async function worker(myRun) {
    while (runRef.current === myRun) {
      const t = nextTask()
      if (!t) return
      if (t === 'wait') { await sleep(400); continue }
      t.status = 'running'; sync()
      try {
        const outcome = await processTask(t)
        if (outcome === 'done') t.status = 'done'
      } catch (e) {
        t.status = 'error'; t.error = e.message
      }
      sync(); persist()
    }
  }

  async function run() {
    const myRun = ++runRef.current
    setPhase('running')
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(myRun)))
    if (runRef.current !== myRun) return
    persist()
    const errors = tasksRef.current.filter((t) => t.status === 'error').length
    setPhase('done')
    if (hiddenRef.current) toast.success(`PDF import finished — ${resultsRef.current.length} recipes${errors ? `, ${errors} failed` : ''}`)
  }

  function start() {
    const f = Math.max(1, Math.min(file.pages, Math.round(Number(from)) || 1))
    const t = Math.max(f, Math.min(file.pages, Math.round(Number(to)) || file.pages))
    setFrom(f); setTo(t)
    settingsRef.current = { from: f, to: t, source: source.trim() || cleanName(file.name), mode }
    tasksRef.current = planTasks(f, t); outlineRef.current = {}
    sync(); persist()
    run()
  }
  function pause() { runRef.current++; setPhase('paused'); persist() }
  function retryFailed() {
    tasksRef.current.forEach((t) => { if (t.status === 'error') { t.status = 'pending'; delete t.error } })
    sync(); run()
  }
  function reset() {
    runRef.current++
    try { localStorage.removeItem(STORE) } catch (_) { /* ignore */ }
    docRef.current = null; tasksRef.current = []; outlineRef.current = {}; resultsRef.current = []; seenRef.current = new Set()
    setFile(null); setTasks([]); setResults([]); setPhase('pick')
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
  const est = useMemo(() => estimate(selPages), [selPages])
  const busy = phase === 'running'
  const statusText = phase === 'done' ? 'Finished' : phase === 'paused' ? 'Paused'
    : active.length
      ? active.map((t) => (t.kind === 'recipe' ? `Reading “${t.title}”` : t.kind === 'outline' ? `Finding recipes in ${pagesLabel(t.start, t.end)}` : `Reading ${pagesLabel(t.start, t.end)}`)).join(' · ')
      : 'Starting…'
  const waiting = recipeTasks.filter((t) => t.status === 'pending' || t.status === 'running')

  const footer = (
    <>
      {phase === 'ready' && (
        <>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={start} disabled={selPages < 1}>Start import</button>
        </>
      )}
      {(phase === 'running' || phase === 'paused') && (
        <>
          <button className="btn ghost" onClick={close}>{busy ? 'Keep working meanwhile' : 'Close'}</button>
          {busy ? <button className="btn ghost" onClick={pause}>Pause</button> : <button className="btn primary" onClick={run}>Continue</button>}
        </>
      )}
      {phase === 'done' && (
        <>
          <button className="btn ghost" onClick={reset}>Import another</button>
          {results.length > 0 && <button className="btn ghost" onClick={() => onShowAll(settingsRef.current.source)}>Show in list</button>}
          <button className="btn primary" onClick={close}>Done</button>
        </>
      )}
    </>
  )

  return (
    <Modal title="Import from PDF" onClose={close} width={640} hidden={hidden} footer={phase !== 'pick' ? footer : null} className="Q-import">
      {phase === 'pick' && (
        <>
          <label
            className={`Q-drop big${dragOver ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); openFile(e.dataTransfer.files?.[0]) }}
          >
            {loadingFile ? <Loader2 size={26} className="spin" /> : <FileUp size={26} />}
            <div className="Q-drop-t">{loadingFile ? 'Opening…' : 'Choose a PDF'}</div>
            <div className="Q-drop-s">One recipe, a folder of recipes, or a whole cookbook. AI reads each recipe completely and adds it to your library.</div>
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
                : 'For your own documents: the steps keep your wording, just ordered and tidied.'}
            </div>
          </div>
          <div className="Q-estimate">
            <b>{selPages} page{selPages === 1 ? '' : 's'}</b> · about {est.mins} min · roughly ${est.cost < 1 ? est.cost.toFixed(2) : est.cost.toFixed(0)} of AI usage.
            {selPages > DIRECT_MAX ? ' It first finds each recipe, then reads each one with all of its pages.' : ''} You can keep working while it runs.
          </div>
        </div>
      )}

      {(phase === 'running' || phase === 'paused' || phase === 'done') && (
        <div className="Q-progress-wrap">
          <div className="Q-progress"><i style={{ width: pct + '%' }} /></div>
          <div className="Q-progress-meta">
            <span>{statusText}{busy && <Loader2 size={13} className="spin" />}</span>
            <span><b>{results.length}</b> saved{recipeTasks.length ? ` of ${recipeTasks.length} found` : ''}</span>
          </div>
          {failed.length > 0 && (
            <div className="Q-note warn">
              <AlertTriangle size={15} />
              <div>
                <b>{failed.length} part{failed.length > 1 ? 's' : ''} could not be read</b>
                <span>{failed.slice(0, 3).map((t) => (t.title ? `“${t.title}”` : pagesLabel(t.start, t.end))).join(', ')}{failed.length > 3 ? '…' : ''}{failed[0].error ? ` — ${failed[0].error}` : ''}</span>
              </div>
              {!busy && <button className="Q-link" onClick={retryFailed}>Retry</button>}
            </div>
          )}
          {phase === 'done' && results.length === 0 && failed.length === 0 && (
            <div className="Q-note"><FileText size={15} /><div><span>No recipes were found in these pages.</span></div></div>
          )}
        </div>
      )}

      {(results.length > 0 || waiting.length > 0) && (
        <div className="Q-import-results">
          {[...results].reverse().map((r) => (
            <div key={r.id} className="Q-import-row">
              <div className="Q-import-row-txt">
                <b>{r.title}</b>
                <span>{[r.category, `p. ${r.page}`].filter(Boolean).join(' · ')}{!r.complete && <em> · check against the original</em>}</span>
              </div>
              <button className="Q-icon-btn" title="Open recipe" onClick={() => onOpenRecipe(r.id)}><ExternalLink size={15} /></button>
              <button className="Q-icon-btn danger" title="Remove this recipe" onClick={() => removeResult(r)}><Trash2 size={15} /></button>
            </div>
          ))}
          {waiting.map((t) => (
            <div key={t.id} className="Q-import-row pending">
              <div className="Q-import-row-txt">
                <b>{t.title}</b>
                <span>{pagesLabel(t.start, t.end)} · {t.status === 'running' ? 'reading…' : 'waiting'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
