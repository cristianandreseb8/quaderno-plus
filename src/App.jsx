import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpDown, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Search, Star, X } from 'lucide-react'
import { dbDelete, dbInsert, dbUpdate, dbLoad, dbLoadOne } from './lib/db.js'
import { translateRecipe, autoCategorize } from './lib/ai.js'
import { SettingsContext, applySettings, loadSettings, saveSettings } from './lib/settings.js'
import Toaster, { toast } from './components/ui/Toaster.jsx'
import Menu, { MenuItem, MenuLabel, MenuSep } from './components/ui/Menu.jsx'
import { addRecipe, buildShoppingList, removeRecipe, resetTicks, useSession } from './lib/session.js'
import { numberSteps } from './lib/recipeCalc.js'

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
const SettingsModal = lazyRetry(() => import('./components/SettingsModal.jsx'))
const PdfImport = lazyRetry(() => import('./components/PdfImport.jsx'))
const ShoppingList = lazyRetry(() => import('./components/session/ShoppingList.jsx'))
const CookView = lazyRetry(() => import('./components/session/CookView.jsx'))
const RecipePicker = lazyRetry(() => import('./components/session/RecipePicker.jsx'))
const isPhone = () => window.matchMedia('(max-width: 760px)').matches

const SORTS = [
  ['recent', 'Recently added'],
  ['opened', 'Recently opened'],
  ['az', 'Title A → Z'],
  ['za', 'Title Z → A'],
  ['category', 'Category'],
  ['favorites', 'Favorites first'],
]

export default function App() {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState(null)
  const [mode, setMode] = useState('view')
  const [editorStart, setEditorStart] = useState('blank')
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [sortMode, setSortMode] = useState(() => localStorage.getItem('qdplus_sort') || 'recent')
  const [recentlyOpened, setRecentlyOpened] = useState(() => { try { return JSON.parse(localStorage.getItem('qdplus_opened') || '[]') } catch { return [] } })
  const [showAppAI, setShowAppAI] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importStatus, setImportStatus] = useState(null) // { running, pct, found } while a PDF import is alive
  const [categorizingAI, setCategorizingAI] = useState(false)
  const [settings, setSettings] = useState(loadSettings)
  const [view, setView] = useState(() => localStorage.getItem('qdplus_view') || 'recipes') // 'recipes' | 'session'
  const [sessSel, setSessSel] = useState(() => (isPhone() ? null : 'shopping')) // 'shopping' | recipe id
  const [showPicker, setShowPicker] = useState(false)
  const searchRef = useRef(null)
  const toggleSidebarRef = useRef(() => {})
  const { session, change: changeSession, finish: finishSession } = useSession(toast.error)

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => { const next = { ...prev, ...patch }; saveSettings(next); return next })
  }, [])
  useEffect(() => { applySettings(settings) }, [settings])
  const settingsCtx = useMemo(() => ({ settings, update: updateSettings }), [settings, updateSettings])

  useEffect(() => {
    dbLoad().then((data) => {
      setRecipes(data)
      const lastId = localStorage.getItem('qdplus_last_recipe')
      const restored = lastId && data.some((r) => r.id === lastId) ? lastId : data[0]?.id || null
      // On phones the list is the home screen; only auto-open a recipe on wide screens.
      setSelId(window.matchMedia('(max-width: 760px)').matches ? null : restored)
    })
      .catch((e) => toast.error('Could not load recipes: ' + e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (mode === 'view' && selId) localStorage.setItem('qdplus_last_recipe', selId)
  }, [selId, mode])

  // The list holds "lite" rows; fetch the full recipe (photos, media) when one is opened.
  const selLite = recipes.find((x) => x.id === selId)?._lite
  useEffect(() => {
    if (!selId || !selLite) return undefined
    let cancelled = false
    dbLoadOne(selId)
      .then((full) => {
        if (cancelled) return
        // Only replace a row that is still lite — a save in the meantime already returned the full row.
        setRecipes((p) => p.map((x) => (x.id === full.id && x._lite ? full : x)))
      })
      .catch((e) => { if (!cancelled) toast.error('Could not open the recipe: ' + e.message) })
    return () => { cancelled = true }
  }, [selId, selLite])

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase()
      if (e.key === '/' && !['input', 'textarea', 'select'].includes(tag) && !e.target.isContentEditable) {
        e.preventDefault()
        updateSettings({ sidebar: true })
        setTimeout(() => searchRef.current?.focus(), 0)
      }
      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); toggleSidebarRef.current()
      }
      if (e.key === 'Escape' && !document.querySelector('.Q-menu, .Q-modal-overlay:not([style*="none"])')) {
        setShowAppAI(false); setShowCompare(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [])

  function setSort(s) { setSortMode(s); try { localStorage.setItem('qdplus_sort', s) } catch (_) { /* storage unavailable */ } }

  async function saveRecipe(rec) {
    try {
      const saved = rec.id && recipes.some((x) => x.id === rec.id) ? await dbUpdate(rec) : await dbInsert(rec)
      setRecipes((p) => { const ex = p.some((x) => x.id === saved.id); return ex ? p.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...p] })
      setSelId(saved.id); setMode('view')
      toast.success('Recipe saved')
    } catch (e) {
      toast.error('Save failed: ' + e.message)
    }
  }
  async function updateRecipe(updated) {
    try {
      const saved = await dbUpdate(updated)
      setRecipes((p) => p.map((x) => (x.id === saved.id ? saved : x)))
    } catch (e) {
      toast.error('Update failed: ' + e.message)
    }
  }
  async function deleteRecipe(id) {
    const rec = recipes.find((x) => x.id === id)
    if (!window.confirm(`Delete "${rec?.title || 'this recipe'}"? This cannot be undone.`)) return
    try {
      await dbDelete(id)
      const next = recipes.filter((x) => x.id !== id)
      setRecipes(next); setSelId(window.matchMedia('(max-width: 760px)').matches ? null : next[0]?.id || null); setMode('view')
      toast('Recipe deleted')
    } catch (e) {
      toast.error('Delete failed: ' + e.message)
    }
  }
  async function copyRecipe(sourceRecipe, fixedLang) {
    try {
      let rec = { ...sourceRecipe, id: undefined, title: sourceRecipe.title + (fixedLang ? ` (${fixedLang})` : '  (Copy)'), notes_pad: '', media_library: '', id_data: '', fixed_lang: fixedLang || null, copied_from: sourceRecipe.id }
      if (fixedLang) {
        toast(`Translating to ${fixedLang}…`)
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
      toast.success('Copy created')
    } catch (e) {
      toast.error('Copy failed: ' + e.message)
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
      toast.success('Saved as a new recipe')
    } catch (e) {
      toast.error('Save copy failed: ' + e.message)
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
  // A create action can arrive with no usable payload (missing/!object `recipe`). Inserting it
  // anyway is what produced the empty "Untitled" ghost recipes, so reject it loudly instead.
  function isUsableAIRecipe(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false
    return Boolean((r.ingredients || []).length || (r.steps || []).length)
  }
  async function handleAppAIAction(action) {
    switch (action.type) {
      case 'create_recipe':
        if (!isUsableAIRecipe(action.recipe)) { toast.error('AI sent an empty recipe — nothing was created.'); break }
        try {
          const saved = await dbInsert({ ...sanitizeAIRecipe(action.recipe), notes_pad: '', thumbnail: '', source_photos: [], id_data: '', media_library: '', fixed_lang: null, copied_from: null })
          setRecipes((p) => [saved, ...p])
          setSelId(saved.id); setMode('view')
        } catch (e) { toast.error('Create failed: ' + e.message) }
        break
      case 'batch_create': {
        const usable = (action.recipes || []).filter(isUsableAIRecipe)
        if (!usable.length) { toast.error('AI sent no usable recipes — nothing was created.'); break }
        try {
          const created = await Promise.all(usable.map((r) => dbInsert({ ...sanitizeAIRecipe(r), notes_pad: '', thumbnail: '', source_photos: [], id_data: '', media_library: '', fixed_lang: null, copied_from: null })))
          setRecipes((p) => [...created, ...p])
          if (created[0]) { setSelId(created[0].id); setMode('view') }
        } catch (e) { toast.error('Batch create failed: ' + e.message) }
        break
      }
      case 'delete_recipe':
        if (window.confirm(`Delete "${action.title || action.id}"?`)) {
          try {
            await dbDelete(action.id)
            setRecipes((p) => p.filter((r) => r.id !== action.id))
            if (selId === action.id) setSelId(null)
          } catch (e) { toast.error('Delete failed: ' + e.message) }
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
    if (!uncategorized.length) { toast('All recipes already have a category.'); return }
    if (!window.confirm('Let AI suggest a category for ' + uncategorized.length + ' recipes without one?')) return
    setCategorizingAI(true)
    try {
      const data = await autoCategorize(uncategorized.map((r) => ({ id: r.id, title: r.title, category: '', ingredients: (r.ingredients || []).slice(0, 8) })))
      for (const u of data?.updates || []) {
        const rec = recipes.find((r) => r.id === u.id)
        if (rec) { const saved = await dbUpdate({ ...rec, category: u.category }); setRecipes((p) => p.map((r) => (r.id === saved.id ? saved : r))) }
      }
      toast.success('Categorized ' + (data?.updates?.length || 0) + ' recipes')
    } catch (e) {
      toast.error('Auto-categorize failed: ' + e.message)
    } finally {
      setCategorizingAI(false)
    }
  }

  // PDF import saves each recipe as soon as it is found, so the list fills up live.
  const onImportedRecipe = useCallback((saved) => { setRecipes((p) => [saved, ...p]) }, [])
  const onImportRemoved = useCallback((id) => { setRecipes((p) => p.filter((r) => r.id !== id)) }, [])

  const categories = useMemo(() => {
    const counts = new Map()
    recipes.forEach((r) => { const c = (r.category || '').trim(); if (c) counts.set(c, (counts.get(c) || 0) + 1) })
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [recipes])

  const sel = recipes.find((x) => x.id === selId) || null
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = recipes.filter((r) => {
      if (catFilter && (r.category || '').trim() !== catFilter) return false
      if (!needle) return true
      return [r.title, r.category, r.source, ...(r.ingredients || [])].join(' ').toLowerCase().includes(needle)
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
  }, [recipes, q, catFilter, sortMode, recentlyOpened])

  function openRecipe(id) {
    setView('recipes'); setSelId(id); setMode('view')
    setRecentlyOpened((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 50)
      localStorage.setItem('qdplus_opened', JSON.stringify(next))
      return next
    })
  }
  function switchView(v) {
    setView(v)
    try { localStorage.setItem('qdplus_view', v) } catch (_) { /* ignore */ }
    if (v === 'session' && !isPhone() && !sessSel) setSessSel('shopping')
  }
  function startNew(kind) {
    if (kind === 'pdf') { setImportOpen(true); return }
    switchView('recipes')
    setEditorStart(kind); setMode('new'); setSelId(null)
  }
  function goBack() {
    if (view === 'session') { setSessSel(null); return }
    setMode('view'); setSelId(null)
  }

  // ── Session ────────────────────────────────────────────────────────────
  const recipesById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes])
  const sessionEntries = useMemo(() => (session?.recipes || []).filter((e) => recipesById.has(e.id)), [session, recipesById])
  const sessionIds = useMemo(() => new Set(sessionEntries.map((e) => e.id)), [sessionEntries])
  const shopStats = useMemo(() => {
    if (!session) return { ready: 0, total: 0 }
    const items = buildShoppingList(sessionEntries, recipesById)
    const extra = session.shopping.extra || []
    return {
      total: items.length + extra.length,
      ready: items.filter((it) => session.shopping.have[it.key]).length + extra.filter((e) => e.have).length,
    }
  }, [session, sessionEntries, recipesById])
  const stepStats = (r) => {
    const total = numberSteps(r.steps).filter((st) => st.n).length
    const done = (session?.progress?.[r.id]?.steps || []).length
    return { done: Math.min(done, total), total }
  }
  function toggleInSession(id, on) {
    changeSession(on ? addRecipe(id) : removeRecipe(id))
    if (sessSel === id && !on) setSessSel('shopping')
  }
  function toggleFromRecipe(id) {
    const on = !sessionIds.has(id)
    toggleInSession(id, on)
    if (on) toast.success('Added to the session', { action: { label: 'Open', onClick: () => { switchView('session'); setSessSel('shopping') } } })
    else toast('Removed from the session')
  }
  async function endSession() {
    if (!window.confirm('Finish this session? Its shopping list and progress are archived and a fresh session starts.')) return
    await finishSession(); setSessSel(isPhone() ? null : 'shopping')
    toast('Session finished')
  }

  const isOpen = view === 'session' ? !!sessSel : (mode !== 'view' || !!sel)
  const sidebarOpen = settings.sidebar !== false
  toggleSidebarRef.current = () => updateSettings({ sidebar: !sidebarOpen })
  const uncategorizedCount = recipes.filter((r) => !r.category).length
  const importMounted = importOpen || !!importStatus
  const cookEntry = view === 'session' && sessSel && sessSel !== 'shopping' ? sessionEntries.find((e) => e.id === sessSel) : null
  const cookRecipe = cookEntry ? recipesById.get(cookEntry.id) : null

  const moreItems = (phone) => (
    <>
      {phone && <MenuItem onClick={() => setShowAppAI(true)}>Assistant</MenuItem>}
      <MenuItem onClick={() => setShowLibrary(true)}>Ingredients</MenuItem>
      <MenuItem onClick={() => setShowCompare(true)}>Compare recipes</MenuItem>
      <MenuSep />
      <MenuItem onClick={() => setShowSettings(true)}>Settings</MenuItem>
    </>
  )

  return (
    <SettingsContext.Provider value={settingsCtx}>
      <div className="Q" data-open={isOpen ? '1' : '0'} data-side={sidebarOpen ? '1' : '0'}>
        <header className="Q-top">
          <button
            className="Q-hbtn icon Q-side-toggle" onClick={() => toggleSidebarRef.current()}
            title={sidebarOpen ? 'Hide the recipe list (⌘\\)' : 'Show the recipe list (⌘\\)'} aria-label={sidebarOpen ? 'Hide the recipe list' : 'Show the recipe list'}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <div className="Q-brand">Quaderno<b>+</b></div>
          {importStatus && (
            <button className="Q-import-pill" onClick={() => setImportOpen(true)} title="Show PDF import">
              <span className="dot" /> Importing · {importStatus.pct}%{importStatus.found ? ` · ${importStatus.found} found` : ''}
            </button>
          )}
          <div className="Q-top-right">
            <button className="Q-hbtn Q-top-wide" onClick={() => setShowAppAI(true)}>Assistant</button>
            <Menu className="Q-top-wide" width={200} trigger={(p) => <button className="Q-hbtn icon" onClick={p.toggle} aria-label="More" title="More"><MoreHorizontal size={18} /></button>}>
              {moreItems(false)}
            </Menu>
            <Menu className="Q-top-narrow" width={210} trigger={(p) => <button className="Q-hbtn icon" onClick={p.toggle} aria-label="More"><MoreHorizontal size={20} /></button>}>
              {moreItems(true)}
            </Menu>
            <Menu
              width={240}
              trigger={(p) => (
                <button className="btn primary Q-new" onClick={p.toggle} aria-expanded={p.open} title="Add a recipe">
                  <Plus size={16} strokeWidth={2.4} /><span className="lbl">New</span>
                </button>
              )}
            >
              <MenuItem onClick={() => startNew('blank')} hint="Write it">Blank recipe</MenuItem>
              <MenuItem onClick={() => startNew('text')} hint="AI tidies it">Paste text</MenuItem>
              <MenuItem onClick={() => startNew('photo')} hint="AI reads it">From photos</MenuItem>
              <MenuSep />
              <MenuItem onClick={() => startNew('pdf')} hint="One or many">Import PDF or book</MenuItem>
            </Menu>
          </div>
        </header>

        <div className="Q-body">
          <aside className="Q-side">
            <div className="Q-side-switch" role="tablist">
              <button role="tab" aria-selected={view === 'recipes'} className={view === 'recipes' ? 'on' : ''} onClick={() => switchView('recipes')}>Recipes</button>
              <button role="tab" aria-selected={view === 'session'} className={view === 'session' ? 'on' : ''} onClick={() => switchView('session')}>
                Session{sessionEntries.length > 0 && <span className="Q-count">{sessionEntries.length}</span>}
              </button>
            </div>

            {view === 'recipes' && (
              <>
                <div className="Q-side-tools">
                  <div className="Q-search">
                    <Search size={15} className="Q-search-ico" />
                    <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes" aria-label="Search recipes" />
                    {q && <button className="Q-search-x" onClick={() => setQ('')} aria-label="Clear search"><X size={14} /></button>}
                  </div>
                  <Menu
                    width={230}
                    trigger={(p) => (
                      <button className={`Q-icon-btn${catFilter || sortMode !== 'recent' ? ' on' : ''}`} onClick={p.toggle} title="Sort and filter" aria-label="Sort and filter">
                        <ArrowUpDown size={16} />
                      </button>
                    )}
                  >
                    <MenuLabel>Sort by</MenuLabel>
                    {SORTS.map(([k, l]) => <MenuItem key={k} checked={sortMode === k} onClick={() => setSort(k)}>{l}</MenuItem>)}
                    {categories.length > 0 && (
                      <>
                        <MenuSep />
                        <MenuLabel>Category</MenuLabel>
                        <div className="Q-menu-scroll">
                          <MenuItem checked={!catFilter} onClick={() => setCatFilter('')}>All categories</MenuItem>
                          {categories.map(([c, n]) => <MenuItem key={c} checked={catFilter === c} hint={n} onClick={() => setCatFilter(c)}>{c}</MenuItem>)}
                        </div>
                      </>
                    )}
                  </Menu>
                </div>
                <div className="Q-side-meta">
                  {catFilter
                    ? <button className="Q-chip-filter" onClick={() => setCatFilter('')}>{catFilter}<X size={12} /></button>
                    : <span>{loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'recipe' : 'recipes'}`}</span>}
                  {catFilter && <span>{filtered.length}</span>}
                </div>
                <div className="Q-list">
                  {loading && Array.from({ length: 8 }).map((_, i) => <div key={i} className="Q-list-skel"><i /><div><b /><s /></div></div>)}
                  {!loading && !filtered.length && <div className="Q-msg">{q || catFilter ? 'No recipes match.' : 'No recipes yet.'}</div>}
                  {filtered.map((r) => (
                    <div
                      key={r.id} className="Q-list-item" role="button" tabIndex={0} aria-selected={r.id === selId && mode === 'view'}
                      onClick={() => openRecipe(r.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecipe(r.id) } }}
                    >
                      {r.thumbnail ? <img src={r.thumbnail} className="Q-list-thumb" alt="" loading="lazy" /> : <div className="Q-list-thumb ph">{(r.title || '?').trim().charAt(0).toUpperCase()}</div>}
                      <div className="Q-list-txt">
                        <h4>{r.title}</h4>
                        <span>{[r.category, r.source].filter(Boolean).join(' · ') || 'Uncategorized'}</span>
                      </div>
                      {sessionIds.has(r.id) && <span className="Q-dot" title="In the session" />}
                      <button
                        className={`Q-fav${r.is_favorite ? ' on' : ''}`} title={r.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={(e) => { e.stopPropagation(); updateRecipe({ ...r, is_favorite: !r.is_favorite }) }}
                      >
                        <Star size={14} fill={r.is_favorite ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {view === 'session' && (
              <div className="Q-list Q-sess-side">
                <div
                  className="Q-list-item Q-sess-shop" role="button" tabIndex={0} aria-selected={sessSel === 'shopping'}
                  onClick={() => setSessSel('shopping')} onKeyDown={(e) => { if (e.key === 'Enter') setSessSel('shopping') }}
                >
                  <div className="Q-list-txt">
                    <h4>Shopping list</h4>
                    <span>{shopStats.total ? `${shopStats.ready} of ${shopStats.total} ready` : 'Empty'}</span>
                  </div>
                </div>
                <div className="Q-side-label">Cooking</div>
                {sessionEntries.map((e) => {
                  const r = recipesById.get(e.id)
                  const st = stepStats(r)
                  return (
                    <div
                      key={e.id} className="Q-list-item" role="button" tabIndex={0} aria-selected={sessSel === e.id}
                      onClick={() => setSessSel(e.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') setSessSel(e.id) }}
                    >
                      {r.thumbnail ? <img src={r.thumbnail} className="Q-list-thumb" alt="" loading="lazy" /> : <div className="Q-list-thumb ph">{(r.title || '?').trim().charAt(0).toUpperCase()}</div>}
                      <div className="Q-list-txt">
                        <h4>{r.title}</h4>
                        <span>{(Number(e.factor) || 1) !== 1 ? `×${+Number(e.factor).toFixed(2)} · ` : ''}{st.total ? `${st.done} of ${st.total} steps` : 'No method'}</span>
                      </div>
                      {st.total > 0 && st.done === st.total && <span className="Q-done-mark">Done</span>}
                    </div>
                  )
                })}
                <button className="Q-side-add" onClick={() => setShowPicker(true)}>{sessionEntries.length ? 'Add or remove recipes' : 'Choose recipes'}</button>
                {session && (sessionEntries.length > 0 || shopStats.total > 0) && (
                  <div className="Q-side-foot">
                    <button onClick={() => { if (window.confirm('Clear every tick in this session?')) changeSession(resetTicks()) }}>Clear ticks</button>
                    <button onClick={endSession}>Finish session</button>
                  </div>
                )}
              </div>
            )}
          </aside>

          <main className="Q-main">
            <div className="Q-pane">
              {isOpen && <button className="Q-back-btn" onClick={goBack}><ArrowLeft size={16} /> {view === 'session' ? 'Session' : 'Recipes'}</button>}
              <Suspense fallback={<div className="Q-msg">Loading…</div>}>
                {view === 'recipes' && (
                  <>
                    {mode === 'new' && <RecipeEditor key={'new-' + editorStart} startWith={editorStart} onImportPdf={() => setImportOpen(true)} onSave={saveRecipe} onCancel={() => { setMode('view'); setSelId(isPhone() ? null : recipes[0]?.id || null) }} />}
                    {mode === 'edit' && sel && !sel._lite && <RecipeEditor initial={sel} onSave={saveRecipe} onCancel={() => setMode('view')} />}
                    {mode === 'view' && sel && sel._lite && <div className="Q-view-loading"><div /><div /><div /></div>}
                    {mode === 'view' && sel && !sel._lite && (
                      <RecipeView
                        key={sel.id} recipe={sel} onEdit={() => setMode('edit')} onDelete={() => deleteRecipe(sel.id)} onUpdate={updateRecipe}
                        allRecipes={recipes} onCopy={copyRecipe} onSaveVariant={saveVariant}
                        inSession={sessionIds.has(sel.id)} onToggleSession={() => toggleFromRecipe(sel.id)}
                      />
                    )}
                  </>
                )}
                {view === 'session' && sessSel === 'shopping' && (
                  sessionEntries.length || shopStats.total
                    ? <ShoppingList session={session} recipesById={recipesById} change={changeSession} />
                    : (
                      <div className="Q-hero">
                        <h2>Plan a session</h2>
                        <p>Choose the recipes you will cook. Their ingredients merge into one shopping list you tick off, and each recipe gets a step-by-step checklist for the kitchen.</p>
                        <div className="Q-hero-actions"><button className="btn primary" onClick={() => setShowPicker(true)}>Choose recipes</button></div>
                      </div>
                    )
                )}
                {view === 'session' && cookRecipe && (
                  <CookView
                    key={cookRecipe.id} recipe={cookRecipe} entry={cookEntry} progress={session?.progress?.[cookRecipe.id]} change={changeSession}
                    onOpenRecipe={() => openRecipe(cookRecipe.id)} onRemove={() => toggleInSession(cookRecipe.id, false)}
                    onVideos={(v) => updateRecipe({ ...cookRecipe, videos: v })}
                  />
                )}
              </Suspense>
              {view === 'recipes' && mode === 'view' && !sel && !loading && (
                <div className="Q-hero">
                  <h2>{recipes.length ? 'Pick a recipe' : 'Welcome to Quaderno+'}</h2>
                  <p>{recipes.length
                    ? 'Open one from the list, or add something new — type it, paste it, snap a photo, or import a PDF cookbook.'
                    : 'Your professional recipe notebook. Add your first recipe by typing it, pasting text, taking photos, or importing a PDF cookbook.'}</p>
                  <div className="Q-hero-actions">
                    <button className="btn primary" onClick={() => startNew('blank')}>New recipe</button>
                    <button className="btn ghost" onClick={() => startNew('pdf')}>Import PDF or book</button>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>

        {showAppAI && (
          <div className="Q-drawer-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAppAI(false) }}>
            <div className="Q-drawer Q-app-ai-panel">
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
        {showSettings && (
          <Suspense fallback={null}>
            <SettingsModal
              onClose={() => setShowSettings(false)} recipeCount={recipes.length}
              uncategorizedCount={uncategorizedCount} categorizing={categorizingAI} onAutoCategorize={handleAutoCategories}
            />
          </Suspense>
        )}
        {showPicker && (
          <Suspense fallback={null}>
            <RecipePicker recipes={recipes} selectedIds={sessionIds} onToggle={toggleInSession} onClose={() => setShowPicker(false)} />
          </Suspense>
        )}
        {importMounted && (
          <Suspense fallback={null}>
            <PdfImport
              hidden={!importOpen}
              onHide={() => setImportOpen(false)}
              onStatus={setImportStatus}
              onSaved={onImportedRecipe}
              onRemoved={onImportRemoved}
              onOpenRecipe={(id) => { setImportOpen(false); openRecipe(id) }}
              onShowAll={(source) => { setImportOpen(false); switchView('recipes'); setCatFilter(''); setQ(source) }}
              knownCategories={categories.map(([c]) => c)}
            />
          </Suspense>
        )}
        <Toaster />
      </div>
    </SettingsContext.Provider>
  )
}
