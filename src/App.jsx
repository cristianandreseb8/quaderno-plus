import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { dbDelete, dbInsert, dbUpdate, dbLoad } from './lib/db.js'
import { translateRecipe, autoCategorize } from './lib/ai.js'

// After a redeploy, chunk filenames change and a client that loaded the old index.html
// gets a 404 when it lazy-loads a panel — which used to unmount the app to a blank screen.
// Retry via a one-shot full reload so the client picks up the fresh index.html.
const RELOAD_FLAG = 'qdplus_chunk_reload'
function lazyRetry(importer) {
  return lazy(() =>
    importer().then((mod) => { sessionStorage.removeItem(RELOAD_FLAG); return mod })
      .catch((err) => {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1')
          window.location.reload()
          return new Promise(() => {}) // page is reloading — never settle
        }
        throw err // second failure: let the ErrorBoundary show its recovery screen
      }),
  )
}

const RecipeView = lazyRetry(() => import('./components/RecipeView.jsx'))
const RecipeEditor = lazyRetry(() => import('./components/RecipeEditor.jsx'))
const ComparePanel = lazyRetry(() => import('./components/ComparePanel.jsx'))
const IngredientLibraryModal = lazyRetry(() => import('./components/IngredientLibraryModal.jsx'))
const AppAIChat = lazyRetry(() => import('./components/AppAIChat.jsx'))

export default function App() {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState(null)
  const [mode, setMode] = useState('view')
  const [q, setQ] = useState('')
  const [sortMode, setSortMode] = useState('recent')
  const [recentlyOpened, setRecentlyOpened] = useState(() => { try { return JSON.parse(localStorage.getItem('qdplus_opened') || '[]') } catch { return [] } })
  const [saveErr, setSaveErr] = useState('')
  const [showAppAI, setShowAppAI] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [categorizingAI, setCategorizingAI] = useState(false)

  useEffect(() => {
    dbLoad().then((data) => {
      setRecipes(data)
      const lastId = localStorage.getItem('qdplus_last_recipe')
      const restored = lastId && data.some((r) => r.id === lastId) ? lastId : data[0]?.id || null
      setSelId(restored)
    })
      .catch((e) => setSaveErr('Load failed: ' + e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (mode === 'view' && selId) localStorage.setItem('qdplus_last_recipe', selId)
  }, [selId, mode])

  async function saveRecipe(rec) {
    try {
      const saved = rec.id && recipes.some((x) => x.id === rec.id) ? await dbUpdate(rec) : await dbInsert(rec)
      setRecipes((p) => { const ex = p.some((x) => x.id === saved.id); return ex ? p.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...p] })
      setSelId(saved.id); setMode('view')
    } catch (e) {
      setSaveErr('Save failed: ' + e.message)
    }
  }
  async function updateRecipe(updated) {
    try {
      const saved = await dbUpdate(updated)
      setRecipes((p) => p.map((x) => (x.id === saved.id ? saved : x)))
    } catch (e) {
      setSaveErr('Update failed: ' + e.message)
    }
  }
  async function deleteRecipe(id) {
    if (!window.confirm('Delete this recipe?')) return
    try {
      await dbDelete(id)
      const next = recipes.filter((x) => x.id !== id)
      setRecipes(next); setSelId(next[0]?.id || null); setMode('view')
    } catch (e) {
      setSaveErr('Delete failed: ' + e.message)
    }
  }
  async function copyRecipe(sourceRecipe, fixedLang) {
    try {
      let rec = { ...sourceRecipe, id: undefined, title: sourceRecipe.title + (fixedLang ? ` (${fixedLang})` : '  (Copy)'), notes_pad: '', media_library: '', id_data: '', fixed_lang: fixedLang || null, copied_from: sourceRecipe.id }
      if (fixedLang) {
        try {
          const translated = await translateRecipe(sourceRecipe, fixedLang)
          rec = { ...rec, ...translated, thumbnail: sourceRecipe.thumbnail, source_photos: sourceRecipe.source_photos, fixed_lang: fixedLang, copied_from: sourceRecipe.id }
        } catch (e) {
          console.warn('Translation failed, copying as-is', e)
        }
      }
      const saved = await dbInsert(rec)
      setRecipes((p) => [saved, ...p])
      setSelId(saved.id); setMode('view')
    } catch (e) {
      setSaveErr('Copy failed: ' + e.message)
    }
  }
  async function saveVariant(variantRecipe, label) {
    try {
      const rec = {
        ...variantRecipe, id: undefined,
        title: variantRecipe.title + (label ? ` (${label})` : '  (Copy)'),
        notes_pad: '', media_library: '', id_data: '', fixed_lang: null, copied_from: variantRecipe.id,
      }
      const saved = await dbInsert(rec)
      setRecipes((p) => [saved, ...p])
      setSelId(saved.id); setMode('view')
    } catch (e) {
      setSaveErr('Save copy failed: ' + e.message)
    }
  }
  // The model is told to emit ingredients/steps as plain strings, but coerce anyway —
  // an object slipped into recipe.ingredients would crash React when rendered as a child.
  function sanitizeAIRecipe(r) {
    const toLine = (x) => (typeof x === 'string' ? x : [x?.qty, x?.unit, ' ' + (x?.name || '')].filter(Boolean).join(' ').trim() || JSON.stringify(x))
    return {
      ...r,
      title: String(r?.title || 'Untitled'),
      ingredients: (r?.ingredients || []).map(toLine),
      steps: (r?.steps || []).map(toLine),
    }
  }
  async function handleAppAIAction(action) {
    switch (action.type) {
      case 'create_recipe':
        try {
          const saved = await dbInsert({ ...sanitizeAIRecipe(action.recipe), notes_pad: '', thumbnail: '', source_photos: [], id_data: '', media_library: '', fixed_lang: null, copied_from: null })
          setRecipes((p) => [saved, ...p])
          setSelId(saved.id); setMode('view')
        } catch (e) { setSaveErr('Create failed: ' + e.message) }
        break
      case 'batch_create':
        try {
          const created = await Promise.all((action.recipes || []).map((r) => dbInsert({ ...sanitizeAIRecipe(r), notes_pad: '', thumbnail: '', source_photos: [], id_data: '', media_library: '', fixed_lang: null, copied_from: null })))
          setRecipes((p) => [...created, ...p])
          if (created[0]) { setSelId(created[0].id); setMode('view') }
        } catch (e) { setSaveErr('Batch create failed: ' + e.message) }
        break
      case 'delete_recipe':
        if (window.confirm(`Delete "${action.title || action.id}"?`)) {
          try {
            await dbDelete(action.id)
            setRecipes((p) => p.filter((r) => r.id !== action.id))
            if (selId === action.id) setSelId(null)
          } catch (e) { setSaveErr('Delete failed: ' + e.message) }
        }
        break
      case 'select_recipe':
        // The model may fabricate an id (e.g. right after create_recipe it can't know the real
        // DB-assigned id) — selecting a nonexistent id would blank the view pane, so ignore those.
        if (recipes.some((r) => r.id === action.id)) { setSelId(action.id); setMode('view'); setShowAppAI(false) }
        break
      case 'search': setQ(action.query || ''); setShowAppAI(false); break
    }
  }
  async function handleAutoCategories() {
    const uncategorized = recipes.filter((r) => !r.category)
    if (!uncategorized.length) { alert('All recipes already have categories.'); return }
    if (!window.confirm('Auto-categorize ' + uncategorized.length + ' recipes without categories?')) return
    setCategorizingAI(true)
    try {
      const data = await autoCategorize(uncategorized.map((r) => ({ id: r.id, title: r.title, category: '', ingredients: (r.ingredients || []).slice(0, 8) })))
      for (const u of data?.updates || []) {
        const rec = recipes.find((r) => r.id === u.id)
        if (rec) { const saved = await dbUpdate({ ...rec, category: u.category }); setRecipes((p) => p.map((r) => (r.id === saved.id ? saved : r))) }
      }
      alert('Categorized ' + (data?.updates?.length || 0) + ' recipes.')
    } catch (e) {
      setSaveErr('Auto-categorize failed: ' + e.message)
    } finally {
      setCategorizingAI(false)
    }
  }

  const sel = recipes.find((x) => x.id === selId) || null
  const filtered = useMemo(() => {
    let list = recipes.filter((r) => {
      if (!q.trim()) return true
      return [r.title, r.category, ...(r.ingredients || [])].join(' ').toLowerCase().includes(q.toLowerCase())
    })
    if (sortMode === 'az') list = [...list].sort((a, b) => a.title.localeCompare(b.title))
    else if (sortMode === 'za') list = [...list].sort((a, b) => b.title.localeCompare(a.title))
    else if (sortMode === 'category') list = [...list].sort((a, b) => (a.category || '').localeCompare(b.category || ''))
    else if (sortMode === 'favorites') list = [...list].sort((a, b) => (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0))
    else if (sortMode === 'opened') {
      const idx = (id) => recentlyOpened.indexOf(id)
      list = [...list].sort((a, b) => { const ia = idx(a.id), ib = idx(b.id); if (ia === -1 && ib === -1) return 0; if (ia === -1) return 1; if (ib === -1) return -1; return ia - ib })
    }
    return list
  }, [recipes, q, sortMode, recentlyOpened])

  function openRecipe(id) {
    setSelId(id); setMode('view')
    setRecentlyOpened((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 50)
      localStorage.setItem('qdplus_opened', JSON.stringify(next))
      return next
    })
  }

  const isOpen = mode !== 'view' || !!sel

  return (
    <div className="Q" data-open={isOpen ? '1' : '0'}>
      <header className="Q-top">
        <div className="Q-brand">
          Quaderno<span className="ai-badge">AI</span><span className="id-badge">+</span>
        </div>
        <div className="Q-top-right">
          {saveErr && <span style={{ color: '#9b2c2c', fontSize: 10, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{saveErr}</span>}
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>{!loading && `${recipes.length} recipe${recipes.length !== 1 ? 's' : ''}`}</span>
          <button className="btn id xs" onClick={() => setShowCompare(true)} title="Compare recipes">⚖ Compare</button>
          <button className="btn id xs" onClick={() => setShowLibrary(true)} title="Ingredient Library">📦 Library</button>
          <button className="btn ai xs" onClick={() => setShowAppAI(true)} title="App AI Assistant">🌐 AI</button>
          <button className="btn amber" onClick={() => { setMode('new'); setSelId(null) }}>＋ New</button>
        </div>
      </header>

      <div className="Q-body">
        <aside className="Q-side">
          <div className="Q-search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes…" /></div>
          <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Sort:</span>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} style={{ flex: 1, border: '1px solid var(--rule)', borderRadius: 5, padding: '3px 5px', fontSize: 11, fontFamily: 'var(--mono)', background: '#fff', color: 'var(--ink)' }}>
              <option value="recent">Recent first</option>
              <option value="opened">Last opened</option>
              <option value="az">A → Z</option>
              <option value="za">Z → A</option>
              <option value="category">Category</option>
              <option value="favorites">Favorites</option>
            </select>
          </div>
          <div style={{ padding: '4px 12px 5px', borderBottom: '1px solid var(--rule)' }}>
            <button onClick={handleAutoCategories} disabled={categorizingAI} className="btn ghost xs" style={{ width: '100%', fontSize: 10 }}>
              {categorizingAI ? 'Categorizing...' : 'AI auto-categorize'}
            </button>
          </div>
          <div className="Q-list">
            {loading && <div className="Q-msg">Loading…</div>}
            {!loading && !filtered.length && <div className="Q-msg">{q ? 'No matches.' : 'No recipes yet!'}</div>}
            {filtered.map((r) => (
              <div
                key={r.id} className="Q-list-item" role="button" tabIndex={0} aria-selected={r.id === selId && mode === 'view'}
                onClick={() => openRecipe(r.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecipe(r.id) } }}
              >
                {r.thumbnail ? <img src={r.thumbnail} className="Q-list-thumb" alt="" /> : <div className="Q-list-thumb-ph">🍞</div>}
                <button onClick={(e) => { e.stopPropagation(); updateRecipe({ ...r, is_favorite: !r.is_favorite }) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '0 2px', flexShrink: 0, lineHeight: 1 }}>{r.is_favorite ? '⭐' : '☆'}</button>
                <div>
                  <h4>{r.title}</h4>
                  <span>{[r.category, r.source].filter(Boolean).join(' · ') || '—'}{r.fixed_lang && ` · 📌${r.fixed_lang}`}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="Q-main">
          <div className="Q-pane">
            <button className="btn ghost xs Q-back-btn" style={{ marginBottom: 14 }} onClick={() => { setMode('view'); setSelId(null) }}>← All recipes</button>
            <Suspense fallback={<div className="Q-msg">Loading…</div>}>
              {mode === 'new' && <RecipeEditor onSave={saveRecipe} onCancel={() => { setMode('view'); setSelId(recipes[0]?.id || null) }} />}
              {mode === 'edit' && sel && <RecipeEditor initial={sel} onSave={saveRecipe} onCancel={() => setMode('view')} />}
              {mode === 'view' && sel && <RecipeView key={sel.id} recipe={sel} onEdit={() => setMode('edit')} onDelete={() => deleteRecipe(sel.id)} onUpdate={updateRecipe} allRecipes={recipes} onCopy={copyRecipe} onSaveVariant={saveVariant} />}
            </Suspense>
            {mode === 'view' && !sel && !loading && (
              <div className="Q-hero">
                <div className="glyph">❦</div>
                <h2>Quaderno+</h2>
                <p>Professional recipe intelligence with R&D tools. Baker's percentages, sensory evaluation, version tracking, media library, and AI assistance — all in one place.</p>
                <button className="btn amber" onClick={() => setMode('new')}>Add first recipe</button>
              </div>
            )}
          </div>
        </main>
      </div>

      {showAppAI && (
        <div className="Q-app-ai-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowAppAI(false) }}>
          <div className="Q-app-ai-panel">
            <Suspense fallback={<div className="Q-msg">Loading…</div>}>
              <AppAIChat recipes={recipes} onAction={handleAppAIAction} onClose={() => setShowAppAI(false)} />
            </Suspense>
          </div>
        </div>
      )}
      {showCompare && (
        <Suspense fallback={null}>
          <ComparePanel recipes={recipes} onClose={() => setShowCompare(false)} />
        </Suspense>
      )}
      {showLibrary && (
        <Suspense fallback={null}>
          <IngredientLibraryModal onClose={() => setShowLibrary(false)} recipes={recipes} />
        </Suspense>
      )}
    </div>
  )
}
