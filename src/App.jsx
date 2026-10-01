import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpDown, MoreHorizontal, Plus, Search, Star, X } from 'lucide-react'
import { dbDelete, dbInsert, dbUpdate, dbLoad, dbLoadByIds, dbLoadOne, dbLoadPublic, dbLoadThumbs } from './lib/db.js'
import { readList, writeList } from './lib/listCache.js'
import { translateRecipe, autoCategorize } from './lib/ai.js'
import { SettingsContext, applySettings, loadSettings, saveSettings, useSettings } from './lib/settings.js'
import { setNewPassword, signOut, useAuth } from './lib/auth.js'
import { VISIBILITY, acceptInvite, linkTarget, recipePath } from './lib/sharing.js'
import {
  LIKED_NAME, addToCollection, createCollection, deleteCollection, loadCollections, loadFavorites, removeFromCollection, renameCollection, setFavorite,
} from './lib/collections.js'
import AuthScreen from './components/AuthScreen.jsx'
import GuestBrowser from './components/GuestBrowser.jsx'
import Modal from './components/ui/Modal.jsx'
import SideRail from './components/ui/SideRail.jsx'
import { RecipeTimerBadge, TimerDock, TimersButton } from './components/Timers.jsx'
import HeyChef, { HeyChefButton } from './components/HeyChef.jsx'
import Toaster, { toast } from './components/ui/Toaster.jsx'
import Menu, { MenuItem, MenuLabel, MenuSep } from './components/ui/Menu.jsx'
import { allStepKeys } from './lib/links.js'
import { savedFactor } from './lib/scales.js'
import { addExtra, addRecipe, buildShoppingList, clearProgress, removeRecipe, resetTicks, setFactor, toggleProgress, useSession } from './lib/session.js'
import { INSTALL_HELP, useInstall } from './lib/install.js'

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
const RecipePicker = lazyRetry(() => import('./components/session/RecipePicker.jsx'))
const PlanView = lazyRetry(() => import('./components/session/PlanView.jsx'))
const TimesReport = lazyRetry(() => import('./components/TimesReport.jsx'))
const ShareModal = lazyRetry(() => import('./components/ShareModal.jsx'))
const isPhone = () => window.matchMedia('(max-width: 760px)').matches

// What the recipe list shows. Other people's public recipes only appear in "Everyone's public
// recipes"; collections ("col:<id>") and favorites come after, from broad to most personal.
const SCOPES = [
  ['library', 'My library'],
  ['mine', 'My recipes'],
  ['shared', 'Shared with me'],
]
const PUBLIC_SCOPES = [
  ['my-public', 'My public recipes'],
  ['public', 'Everyone’s public recipes'],
]
const byNewest = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))

const SORTS = [
  ['recent', 'Recently added'],
  ['opened', 'Recently opened'],
  ['az', 'Title A → Z'],
  ['za', 'Title Z → A'],
  ['category', 'Category'],
  ['favorites', 'Favorites first'],
]

// The session's last screen on this device ('shopping' or a recipe id).
const SESS_SEL_KEY = 'qdplus_sess_sel'
const lastSessSel = () => { try { return localStorage.getItem(SESS_SEL_KEY) || null } catch (_) { return null } }

function Workspace({ user, profile, setProfile, invite, openId }) {
  // Open with the list kept on this device, if any; the database refreshes it right after.
  const [cached] = useState(() => readList(user.id))
  const [recipes, setRecipes] = useState(() => cached?.recipes || [])
  const [loading, setLoading] = useState(!cached)
  const [fresh, setFresh] = useState(false) // the database's list has arrived
  const [selId, setSelId] = useState(() => {
    if (!cached || openId || invite || isPhone()) return null
    const lastId = localStorage.getItem('qdplus_last_recipe')
    return lastId && cached.recipes.some((r) => r.id === lastId) ? lastId : cached.recipes[0]?.id || null
  })
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
  const { settings, update: updateSettings } = useSettings()
  const uid = user.id
  const [scope, setScope] = useState(() => localStorage.getItem('qdplus_scope') || 'library') // see SCOPES
  const [collections, setCollections] = useState(() => cached?.collections || []) // [{ id, name, items: [recipe ids, newest first] }]
  const [favorites, setFavorites] = useState(() => cached?.favorites || new Set())
  const [publicLoading, setPublicLoading] = useState(false)
  const [nameModal, setNameModal] = useState(null) // { kind: 'new' | 'rename', id?, name?, addRecipe?, open? }
  const recipesRef = useRef(recipes)
  recipesRef.current = recipes
  const requestedRef = useRef(new Set())
  const [shareFor, setShareFor] = useState(null)
  const [view, setView] = useState(() => localStorage.getItem('qdplus_view') || 'recipes') // 'recipes' | 'session'
  // What the session shows: 'shopping' or a recipe id. The last one is kept on the device, so the
  // session reopens on the recipe being cooked — also after leaving it or closing the app.
  const [sessSel, setSessSel] = useState(() => lastSessSel() || (isPhone() ? null : 'shopping'))
  const [showPicker, setShowPicker] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const searchRef = useRef(null)
  const toggleSidebarRef = useRef(() => {})
  const { session, loaded: sessionLoaded, change: changeSession, finish: finishSession } = useSession(toast.error)
  useEffect(() => {
    if (!sessSel) return
    try { localStorage.setItem(SESS_SEL_KEY, sessSel) } catch (_) { /* ignore */ }
  }, [sessSel])
  // A recipe no longer in the session: back to the shopping list (the list of the session on a phone).
  useEffect(() => {
    if (!sessionLoaded || !sessSel || sessSel === 'shopping' || sessSel === 'plan') return
    if ((session?.recipes || []).some((e) => e.id === sessSel)) return
    try { localStorage.removeItem(SESS_SEL_KEY) } catch (_) { /* ignore */ }
    setSessSel(isPhone() ? null : 'shopping')
  }, [sessionLoaded, session, sessSel])
  const install = useInstall()


  useEffect(() => {
    (async () => {
      // An invite link binds to this account first, so the shared recipe is in the first load.
      let target = openId
      if (invite) {
        try {
          const rid = await acceptInvite(invite)
          if (rid) { target = rid; toast.success('A recipe was shared with you') } else toast.error('This invite link has already been used by someone else.')
        } catch (e) { toast.error('Could not open the invite: ' + e.message) }
        try { sessionStorage.removeItem('qdplus_invite') } catch (_) { /* ignore */ }
      }
      if (invite || openId) window.history.replaceState(null, '', '/')
      const [data, cols, favs] = await Promise.all([
        dbLoad(uid),
        loadCollections().catch(() => []),
        loadFavorites().catch(() => new Set()),
      ])
      setCollections(cols); setFavorites(favs)
      // Recipes kept in a collection or starred may belong to someone else: load those too.
      const have = new Set(data.map((r) => r.id))
      const extra = [...new Set([...cols.flatMap((c) => c.items), ...favs, ...(target ? [target] : [])])].filter((id) => !have.has(id))
      extra.forEach((id) => requestedRef.current.add(id))
      const all = extra.length ? [...data, ...(await dbLoadByIds(extra).catch(() => []))] : data
      setRecipes((prev) => {
        // Over the list shown from this device: keep a recipe already opened (unless it changed
        // since), the thumbnails already shown, and other people's public recipes being browsed.
        const old = new Map(prev.map((r) => [r.id, r]))
        const next = all.map((r) => {
          const o = old.get(r.id)
          if (o && !o._lite && o.updated_at === r.updated_at) return o
          return o?.thumbnail && !r.thumbnail ? { ...r, thumbnail: o.thumbnail } : r
        })
        const ids = new Set(next.map((r) => r.id))
        return [...next, ...prev.filter((r) => !ids.has(r.id) && r.owner_id !== uid && r.visibility === 'public')]
      })
      setFresh(true)
      if (target && all.some((r) => r.id === target)) { setSelId(target); return }
      // On phones the list is the home screen; only auto-open a recipe on wide screens.
      const lastId = localStorage.getItem('qdplus_last_recipe')
      const restored = lastId && data.some((r) => r.id === lastId) ? lastId : data[0]?.id || null
      setSelId((cur) => (cur && all.some((r) => r.id === cur) ? cur : isPhone() ? null : restored))
      // Then the photo thumbnails, which are most of the list's size.
      dbLoadThumbs(uid)
        .then((thumbs) => setRecipes((p) => p.map((r) => (thumbs[r.id] && r.thumbnail !== thumbs[r.id] ? { ...r, thumbnail: thumbs[r.id] } : r))))
        .catch(() => { /* the list works without them */ })
    })()
      .catch((e) => toast.error(cached ? 'Showing the recipes saved on this device — could not refresh them: ' + e.message : 'Could not load recipes: ' + e.message))
      .finally(() => setLoading(false))
  }, [])

  // Keep the list on this device for the next start (a moment after changes settle).
  useEffect(() => {
    if (!fresh) return undefined
    const t = setTimeout(() => {
      const kept = new Set([...favorites, ...collections.flatMap((c) => c.items)])
      writeList(uid, recipes.filter((r) => r.owner_id === uid || r.visibility === 'shared' || kept.has(r.id)), favorites, collections)
    }, 1500)
    return () => clearTimeout(t)
  }, [fresh, recipes, favorites, collections])

  useEffect(() => {
    if (mode === 'view' && selId) localStorage.setItem('qdplus_last_recipe', selId)
  }, [selId, mode])

  // The address bar names the open recipe (/r/<id>), so a link copied or shared from the browser
  // opens it — with its title and photo in WhatsApp and the like when it is public — and a reload
  // stays on it. (Waits for the first load, which reads and clears the link it was opened with.)
  useEffect(() => {
    if (loading) return
    const id = view === 'recipes' ? (mode === 'view' ? selId : null) : !['shopping', 'plan'].includes(sessSel) ? sessSel : null
    const want = recipePath(id)
    if (window.location.pathname + window.location.search !== want) window.history.replaceState(null, '', want)
    const title = id && recipesRef.current.find((r) => r.id === id)?.title
    document.title = title ? `${title} · Quaderno+` : 'Quaderno+'
  }, [loading, view, mode, selId, sessSel])

  // A session can hold someone else's public recipe that is not in the library.
  useEffect(() => {
    if (!loading && session?.recipes?.length) ensureLoaded(session.recipes.map((e) => e.id))
  }, [session, loading])

  // Everyone's public recipes load only when that view is open (and follow the search).
  useEffect(() => {
    if (scope !== 'public' || loading) return undefined
    let cancelled = false
    setPublicLoading(true)
    const t = setTimeout(() => {
      dbLoadPublic({ q })
        .then((rows) => { if (!cancelled) mergeRecipes(rows) })
        .catch((e) => { if (!cancelled) toast.error('Could not load public recipes: ' + e.message) })
        .finally(() => { if (!cancelled) setPublicLoading(false) })
    }, q ? 300 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [scope, q, loading])

  useEffect(() => {
    if (fresh && scope.startsWith('col:') && !collections.some((c) => 'col:' + c.id === scope)) pickScope('library')
  }, [fresh, scope, collections])

  // Shortcuts from the installed app's icon menu: /?new=blank|pdf, /?view=session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const next = params.get('new'), v = params.get('view')
    if (!next && !v) return
    if (v === 'session') { setView('session'); setSessSel(lastSessSel() || (isPhone() ? null : 'shopping')) }
    if (next === 'pdf') setImportOpen(true)
    else if (next) { setView('recipes'); setEditorStart(next === 'blank' ? 'blank' : next); setMode('new'); setSelId(null) }
    window.history.replaceState(null, '', '/')
  }, [])

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
  function pickScope(v) { setScope(v); try { localStorage.setItem('qdplus_scope', v) } catch (_) { /* storage unavailable */ } }
  const isMine = (r) => !!r && r.owner_id === uid
  const ownerName = (r) => r?.owner?.display_name || 'another cook'

  // ── Recipes that are not in the library (public, kept in a collection, in the session) ──
  function mergeRecipes(rows) {
    if (!rows.length) return
    setRecipes((p) => { const have = new Set(p.map((r) => r.id)); const add = rows.filter((r) => !have.has(r.id)); return add.length ? [...p, ...add] : p })
  }
  async function ensureLoaded(ids) {
    const have = new Set(recipesRef.current.map((r) => r.id))
    const missing = [...new Set(ids)].filter((id) => id && !have.has(id) && !requestedRef.current.has(id))
    if (!missing.length) return
    missing.forEach((id) => requestedRef.current.add(id))
    try { mergeRecipes(await dbLoadByIds(missing)) } catch (_) { /* a recipe that became private just stays hidden */ }
  }

  // ── Favorites and collections ──
  async function toggleFavorite(id) {
    const on = !favorites.has(id)
    const flip = (want) => setFavorites((p) => { const n = new Set(p); if (want) n.add(id); else n.delete(id); return n })
    flip(on)
    try { await setFavorite(id, on) } catch (e) { flip(!on); toast.error('Could not update favorites: ' + e.message) }
  }
  async function toggleInCollection(col, recipeId, quiet = false) {
    const on = !col.items.includes(recipeId)
    const apply = (want) => setCollections((p) => p.map((c) => (c.id !== col.id ? c : { ...c, items: want ? [recipeId, ...c.items.filter((x) => x !== recipeId)] : c.items.filter((x) => x !== recipeId) })))
    apply(on)
    try {
      if (on) await addToCollection(col.id, recipeId); else await removeFromCollection(col.id, recipeId)
      if (!quiet) toast(on ? `Added to ${col.name}` : `Removed from ${col.name}`)
    } catch (e) { apply(!on); toast.error('Could not update the collection: ' + e.message) }
  }
  // "Like" keeps a recipe in "Recipes I like", made the first time it is used.
  async function toggleLike(recipeId) {
    let col = collections.find((c) => c.name === LIKED_NAME)
    try {
      if (!col) { col = await createCollection(LIKED_NAME); setCollections((p) => [...p, col]) }
      await toggleInCollection(col, recipeId)
    } catch (e) { toast.error('Could not save it: ' + e.message) }
  }
  async function submitName(name) {
    const m = nameModal
    setNameModal(null)
    try {
      if (m.kind === 'rename') {
        await renameCollection(m.id, name)
        setCollections((p) => p.map((c) => (c.id === m.id ? { ...c, name: name.trim() } : c)))
        return
      }
      const col = await createCollection(name)
      setCollections((p) => [...p, col])
      if (m.addRecipe) await toggleInCollection(col, m.addRecipe)
      else pickScope('col:' + col.id)
    } catch (e) { toast.error('Could not save the collection: ' + e.message) }
  }
  async function removeCollection(col) {
    if (!window.confirm(`Delete the collection "${col.name}"? The recipes in it are not deleted.`)) return
    try {
      await deleteCollection(col.id)
      setCollections((p) => p.filter((c) => c.id !== col.id))
      if (scope === 'col:' + col.id) pickScope('library')
    } catch (e) { toast.error('Could not delete the collection: ' + e.message) }
  }

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
    const uncategorized = recipes.filter((r) => !r.category && r.owner_id === uid)
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

  const activeCol = scope.startsWith('col:') ? collections.find((c) => 'col:' + c.id === scope) || null : null
  const scopeLabel = activeCol ? activeCol.name : scope === 'favorites' ? 'Favorites'
    : ([...SCOPES, ...PUBLIC_SCOPES].find(([k]) => k === scope) || SCOPES[0])[1]
  // The recipes of the chosen view, before search, category and sorting.
  const scoped = useMemo(() => {
    const inCol = activeCol ? new Set(activeCol.items) : null
    return recipes.filter((r) => {
      const mine = r.owner_id === uid
      if (scope === 'library') return mine || r.visibility === 'shared'
      if (scope === 'mine') return mine
      if (scope === 'shared') return !mine && r.visibility === 'shared'
      if (scope === 'my-public') return mine && r.visibility === 'public'
      if (scope === 'public') return r.visibility === 'public'
      if (scope === 'favorites') return favorites.has(r.id)
      if (inCol) return inCol.has(r.id)
      return mine || r.visibility === 'shared'
    })
  }, [recipes, scope, uid, activeCol, favorites])

  const categories = useMemo(() => {
    const counts = new Map()
    scoped.forEach((r) => { const c = (r.category || '').trim(); if (c) counts.set(c, (counts.get(c) || 0) + 1) })
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [scoped])

  const sel = recipes.find((x) => x.id === selId) || null
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = scoped.filter((r) => {
      if (catFilter && (r.category || '').trim() !== catFilter) return false
      if (!needle) return true
      return [r.title, r.category, r.source, ...(r.ingredients || [])].join(' ').toLowerCase().includes(needle)
    })
    if (sortMode === 'recent') {
      // In a collection "recently added" means added to the collection.
      const at = activeCol ? new Map(activeCol.items.map((id, i) => [id, i])) : null
      list = at ? [...list].sort((a, b) => at.get(a.id) - at.get(b.id)) : [...list].sort(byNewest)
    } else if (sortMode === 'az') list = [...list].sort((a, b) => a.title.localeCompare(b.title))
    else if (sortMode === 'za') list = [...list].sort((a, b) => b.title.localeCompare(a.title))
    else if (sortMode === 'category') list = [...list].sort((a, b) => (a.category || '').localeCompare(b.category || ''))
    else if (sortMode === 'favorites') list = [...list].sort((a, b) => (favorites.has(b.id) ? 1 : 0) - (favorites.has(a.id) ? 1 : 0))
    else if (sortMode === 'opened') {
      const idx = (id) => recentlyOpened.indexOf(id)
      list = [...list].sort((a, b) => { const ia = idx(a.id), ib = idx(b.id); if (ia === -1 && ib === -1) return 0; if (ia === -1) return 1; if (ib === -1) return -1; return ia - ib })
    }
    return list
  }, [scoped, q, catFilter, sortMode, recentlyOpened, activeCol, favorites])

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
    if (v === 'session' && !sessSel) setSessSel(lastSessSel() || (isPhone() ? null : 'shopping'))
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
  // Steps of the recipes used inside a recipe (a Flan's Pâte brisée) count as its own.
  const stepStats = (r) => {
    const keys = allStepKeys(r, recipes)
    const done = new Set(session?.progress?.[r.id]?.steps || [])
    return { done: keys.filter((k) => done.has(k)).length, total: keys.length }
  }
  function toggleInSession(id, on) {
    // A recipe joins the session at the scale it was last shown at.
    changeSession(on ? addRecipe(id, savedFactor(id)) : removeRecipe(id))
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
    try { localStorage.removeItem(SESS_SEL_KEY) } catch (_) { /* ignore */ }
    toast('Session finished')
  }

  const isOpen = view === 'session' ? !!sessSel : (mode !== 'view' || !!sel)
  const sidebarOpen = settings.sidebar !== false
  toggleSidebarRef.current = () => updateSettings({ sidebar: !sidebarOpen })
  const uncategorizedCount = recipes.filter((r) => !r.category && r.owner_id === uid).length
  const importMounted = importOpen || !!importStatus
  const cookEntry = view === 'session' && sessSel && sessSel !== 'shopping' ? sessionEntries.find((e) => e.id === sessSel) : null
  const cookRecipe = cookEntry ? recipesById.get(cookEntry.id) : null

  // The session opens its recipes on the full recipe screen too, so load the complete row.
  const cookLiteId = cookRecipe?._lite ? cookRecipe.id : null
  useEffect(() => {
    if (!cookLiteId) return undefined
    let cancelled = false
    dbLoadOne(cookLiteId)
      .then((full) => { if (!cancelled) setRecipes((p) => p.map((x) => (x.id === full.id && x._lite ? full : x))) })
      .catch((e) => { if (!cancelled) toast.error('Could not open the recipe: ' + e.message) })
    return () => { cancelled = true }
  }, [cookLiteId])

  // What the recipe screen needs about a recipe, wherever it is opened (recipes or session).
  const recipeProps = (r) => ({
    recipe: r, onUpdate: updateRecipe, onDelete: () => deleteRecipe(r.id), allRecipes: recipes, onOpenRecipe: openRecipe,
    canEdit: isMine(r), ownerName: isMine(r) ? null : ownerName(r), onShare: () => setShareFor(r),
    isFavorite: favorites.has(r.id), onToggleFavorite: () => toggleFavorite(r.id),
    liked: collections.some((c) => c.name === LIKED_NAME && c.items.includes(r.id)), onToggleLike: () => toggleLike(r.id),
    collections: collections.map((c) => ({ id: c.id, name: c.name, has: c.items.includes(r.id) })),
    onToggleCollection: (id) => {
      if (!id) { setNameModal({ kind: 'new', addRecipe: r.id }); return }
      const col = collections.find((c) => c.id === id)
      if (col) toggleInCollection(col, r.id)
    },
  })

  async function installApp() {
    if (install.canPrompt) {
      const ok = await install.prompt()
      if (ok) toast.success('Quaderno+ is installed')
      return
    }
    toast(INSTALL_HELP[install.platform], { duration: 9000 })
  }

  const moreItems = (phone) => (
    <>
      {phone && <MenuItem onClick={() => setShowAppAI(true)}>Assistant</MenuItem>}
      <MenuItem onClick={() => setShowLibrary(true)}>Ingredients</MenuItem>
      <MenuItem onClick={() => setShowCompare(true)}>Compare recipes</MenuItem>
      <MenuItem onClick={() => setShowReport(true)}>Time report</MenuItem>
      <MenuSep />
      {!install.installed && <MenuItem onClick={installApp}>Install app</MenuItem>}
      <MenuItem onClick={() => setShowSettings(true)}>Settings</MenuItem>
      <MenuSep />
      <div className="Q-menu-account">
        {profile?.display_name && <b>{profile.display_name}</b>}
        <span>{user.email}</span>
      </div>
      <MenuItem onClick={() => signOut()}>Sign out</MenuItem>
    </>
  )

  return (
    <>
      <div className="Q" data-open={isOpen ? '1' : '0'} data-side={sidebarOpen ? '1' : '0'}>
        <header className="Q-top">
          <div className="Q-brand">Quaderno<b>+</b></div>
          {importStatus && (
            <button className="Q-import-pill" onClick={() => setImportOpen(true)} title="Show PDF import">
              <span className="dot" /> Importing · {importStatus.pct}%{importStatus.found ? ` · ${importStatus.found} found` : ''}
            </button>
          )}
          <div className="Q-top-right">
            <HeyChefButton />
            <TimersButton />
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

        <div className="Q-body" style={settings.sideWidth ? { '--side-w': `${settings.sideWidth}px` } : undefined}>
          <SideRail open={sidebarOpen} onChange={({ open, width }) => updateSettings({ sidebar: open, ...(width ? { sideWidth: width } : {}) })} />
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
                    width={250}
                    trigger={(p) => (
                      <button className={`Q-icon-btn${catFilter || sortMode !== 'recent' || scope !== 'library' ? ' on' : ''}`} onClick={p.toggle} title="Show, sort and filter" aria-label="Show, sort and filter">
                        <ArrowUpDown size={16} />
                      </button>
                    )}
                  >
                    <MenuLabel>Show</MenuLabel>
                    {SCOPES.map(([k, l]) => <MenuItem key={k} checked={scope === k} onClick={() => pickScope(k)}>{l}</MenuItem>)}
                    <MenuSep />
                    <MenuLabel>Public</MenuLabel>
                    {PUBLIC_SCOPES.map(([k, l]) => <MenuItem key={k} checked={scope === k} onClick={() => pickScope(k)}>{l}</MenuItem>)}
                    <MenuSep />
                    <MenuLabel>Collections</MenuLabel>
                    {collections.map((c) => <MenuItem key={c.id} checked={scope === 'col:' + c.id} hint={c.items.length || ''} onClick={() => pickScope('col:' + c.id)}>{c.name}</MenuItem>)}
                    <MenuItem checked={false} onClick={() => setNameModal({ kind: 'new' })}>New collection…</MenuItem>
                    {activeCol && <MenuItem checked={false} onClick={() => setNameModal({ kind: 'rename', id: activeCol.id, name: activeCol.name })}>Rename this collection…</MenuItem>}
                    {activeCol && <MenuItem checked={false} danger onClick={() => removeCollection(activeCol)}>Delete this collection</MenuItem>}
                    <MenuSep />
                    <MenuItem checked={scope === 'favorites'} hint={favorites.size || ''} onClick={() => pickScope('favorites')}>Favorites</MenuItem>
                    <MenuSep />
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
                    : <span>{loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'recipe' : 'recipes'}${scope !== 'library' ? ' · ' + scopeLabel : ''}`}</span>}
                  {catFilter && <span>{filtered.length}</span>}
                </div>
                <div className="Q-list">
                  {loading && Array.from({ length: 8 }).map((_, i) => <div key={i} className="Q-list-skel"><i /><div><b /><s /></div></div>)}
                  {!loading && !filtered.length && (
                    <div className="Q-msg">
                      {scope === 'public' && publicLoading ? 'Loading public recipes…'
                        : q || catFilter ? 'No recipes match.'
                          : scope === 'public' ? 'No public recipes yet.'
                            : scope === 'my-public' ? 'None of your recipes is public. Open one and choose Share → Public.'
                              : scope === 'favorites' ? 'Star a recipe to keep it here.'
                                : activeCol?.name === LIKED_NAME ? 'Tap Like on a recipe to keep it here.'
                                  : activeCol ? 'Empty. Open a recipe and choose ⋯ → Add to collection.'
                                    : 'No recipes yet.'}
                    </div>
                  )}
                  {filtered.map((r) => (
                    <div
                      key={r.id} className="Q-list-item" role="button" tabIndex={0} aria-selected={r.id === selId && mode === 'view'}
                      onClick={() => openRecipe(r.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecipe(r.id) } }}
                    >
                      {r.thumbnail ? <img src={r.thumbnail} className="Q-list-thumb" alt="" loading="lazy" /> : <div className="Q-list-thumb ph">{(r.title || '?').trim().charAt(0).toUpperCase()}</div>}
                      <div className="Q-list-txt">
                        <h4>{r.title}</h4>
                        <span>
                          {isMine(r) && r.visibility && r.visibility !== 'private' && <em className="Q-vis-tag">{VISIBILITY[r.visibility]} · </em>}
                          {isMine(r)
                            ? [r.category, r.source].filter(Boolean).join(' · ') || 'Uncategorized'
                            : [`by ${ownerName(r)}`, r.category].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <RecipeTimerBadge recipeId={r.id} />
                      {sessionIds.has(r.id) && <span className="Q-dot" title="In the session" />}
                      <button
                        className={`Q-fav${favorites.has(r.id) ? ' on' : ''}`} title={favorites.has(r.id) ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(r.id) }}
                      >
                        <Star size={14} fill={favorites.has(r.id) ? 'currentColor' : 'none'} />
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
                <div
                  className="Q-list-item Q-sess-shop" role="button" tabIndex={0} aria-selected={sessSel === 'plan'}
                  onClick={() => setSessSel('plan')} onKeyDown={(e) => { if (e.key === 'Enter') setSessSel('plan') }}
                >
                  <div className="Q-list-txt">
                    <h4>Plan</h4>
                    <span>{sessionEntries.length > 1 ? 'Cook them in parallel' : 'Timeline and session clock'}</span>
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
                      <RecipeTimerBadge recipeId={r.id} />
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
                    {mode === 'new' && <RecipeEditor key={'new-' + editorStart} startWith={editorStart} library={recipes} onImportPdf={() => setImportOpen(true)} onSave={saveRecipe} onCancel={() => { setMode('view'); setSelId(isPhone() ? null : recipes[0]?.id || null) }} />}
                    {mode === 'edit' && sel && !sel._lite && isMine(sel) && <RecipeEditor initial={sel} library={recipes} onSave={saveRecipe} onCancel={() => setMode('view')} />}
                    {mode === 'view' && sel && sel._lite && <div className="Q-view-loading"><div /><div /><div /></div>}
                    {mode === 'view' && sel && !sel._lite && (
                      <RecipeView
                        key={sel.id} {...recipeProps(sel)} onEdit={() => setMode('edit')} onCopy={copyRecipe} onSaveVariant={saveVariant}
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
                {view === 'session' && sessSel === 'plan' && (
                  <PlanView session={session} recipesById={recipesById} library={recipes} change={changeSession} onOpenReport={() => setShowReport(true)} />
                )}
                {view === 'session' && cookRecipe && cookRecipe._lite && <div className="Q-view-loading"><div /><div /><div /></div>}
                {view === 'session' && cookRecipe && !cookRecipe._lite && (
                  <RecipeView
                    key={'cook-' + cookRecipe.id} {...recipeProps(cookRecipe)}
                    onEdit={() => { switchView('recipes'); setSelId(cookRecipe.id); setMode('edit') }}
                    onCopy={(r, lang) => { switchView('recipes'); copyRecipe(r, lang) }}
                    onSaveVariant={(r, label) => { switchView('recipes'); saveVariant(r, label) }}
                    cook={{
                      factor: cookEntry.factor,
                      progress: session?.progress?.[cookRecipe.id],
                      onFactor: (f) => changeSession(setFactor(cookRecipe.id, f)),
                      onToggleIng: (i) => changeSession(toggleProgress(cookRecipe.id, 'ing', i)),
                      onToggleStep: (i) => changeSession(toggleProgress(cookRecipe.id, 'steps', i)),
                      onClear: (kind) => changeSession(clearProgress(cookRecipe.id, kind)),
                      onOpenRecipe: () => openRecipe(cookRecipe.id),
                      onRemove: () => toggleInSession(cookRecipe.id, false),
                      sessionId: session?.id || null,
                    }}
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
              onClose={() => setShowSettings(false)} recipeCount={recipes.filter(isMine).length}
              uncategorizedCount={uncategorizedCount} categorizing={categorizingAI} onAutoCategorize={handleAutoCategories}
              user={user} profile={profile} onProfile={setProfile}
            />
          </Suspense>
        )}
        {shareFor && (
          <Suspense fallback={null}>
            <ShareModal
              recipe={shareFor} fromName={profile?.display_name} onClose={() => setShareFor(null)}
              onVisibility={(v) => { setRecipes((p) => p.map((x) => (x.id === shareFor.id ? { ...x, visibility: v } : x))); setShareFor((p) => ({ ...p, visibility: v })) }}
            />
          </Suspense>
        )}
        <TimerDock />
        <HeyChef
          recipes={recipes}
          current={view === 'recipes' ? (mode === 'view' ? sel : null) : cookRecipe}
          onOpenRecipe={(id) => openRecipe(id)}
          onAddToSession={(id) => { if (!sessionIds.has(id)) toggleInSession(id, true) }}
          onAddShopping={(text) => changeSession(addExtra(text))}
          onGoShopping={() => { switchView('session'); setSessSel('shopping') }}
          onGoSession={() => { switchView('session'); setSessSel('plan') }}
          onCreateRecipe={async (r) => {
            switchView('recipes')
            await saveRecipe({
              title: r.title || 'New recipe', category: r.category || '', time: r.time || '', servings: r.servings || '', notes: r.notes || '',
              source: 'Hey chef (AI)', notes_pad: '', thumbnail: '', source_photos: [], ingredients: r.ingredients || [], steps: r.steps || [],
              id_data: '', media_library: '', fixed_lang: null, copied_from: null, createdAt: Date.now(), videos: [],
            })
          }}
        />
        {nameModal && (
          <NameModal
            title={nameModal.kind === 'rename' ? 'Rename collection' : 'New collection'}
            initial={nameModal.name || ''} cta={nameModal.kind === 'rename' ? 'Save' : 'Create'}
            onSubmit={submitName} onClose={() => setNameModal(null)}
          />
        )}
        {showPicker && (
          <Suspense fallback={null}>
            <RecipePicker recipes={recipes} selectedIds={sessionIds} onToggle={toggleInSession} onClose={() => setShowPicker(false)} />
          </Suspense>
        )}
        {showReport && (
          <Suspense fallback={null}>
            <TimesReport recipesById={recipesById} onClose={() => setShowReport(false)} />
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
              knownCategories={[...new Set(recipes.filter(isMine).map((r) => (r.category || '').trim()).filter(Boolean))]}
            />
          </Suspense>
        )}
      </div>
    </>
  )
}

// Shown to anyone (signed in or not) who opens the link of a public recipe.
function NameModal({ title, initial, cta, onSubmit, onClose }) {
  const [name, setName] = useState(initial)
  const ok = name.trim().length > 0 && name.trim().length <= 80
  return (
    <Modal
      title={title} onClose={onClose} width={420}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={() => onSubmit(name)}>{cta}</button></>}
    >
      <div className="Q-field">
        <label>Name</label>
        <input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) onSubmit(name) }} placeholder="e.g. Christmas baking" />
      </div>
    </Modal>
  )
}

function SetPasswordModal({ onDone }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    if (pw.length < 8) { toast.error('Use at least 8 characters.'); return }
    setBusy(true)
    try { await setNewPassword(pw); toast.success('Password updated'); onDone() } catch (ex) { toast.error(ex.message) } finally { setBusy(false) }
  }
  return (
    <div className="Q-modal-overlay">
      <form className="Q-modal" style={{ maxWidth: 420 }} onSubmit={save}>
        <div className="Q-modal-head"><h2>Choose a new password</h2></div>
        <div className="Q-modal-body">
          <div className="Q-field"><label>New password</label><input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
        </div>
        <div className="Q-modal-foot"><button className="btn primary" disabled={busy}>Save password</button></div>
      </form>
    </div>
  )
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings)
  const updateSettings = useCallback((patch) => {
    setSettings((prev) => { const next = { ...prev, ...patch }; saveSettings(next); return next })
  }, [])
  useEffect(() => { applySettings(settings) }, [settings])
  const settingsCtx = useMemo(() => ({ settings, update: updateSettings }), [settings, updateSettings])

  const auth = useAuth()
  const [target] = useState(() => linkTarget())
  const openId = target.openId
  // Keep an invite token across the sign-in / sign-up round trip.
  const [invite] = useState(() => {
    const t = target.invite
    try { if (t) sessionStorage.setItem('qdplus_invite', t); return t || sessionStorage.getItem('qdplus_invite') } catch (_) { return t }
  })
  // Guests browse public recipes without an account; a public link opens straight into that.
  const [guest, setGuestState] = useState(() => { try { return sessionStorage.getItem('qdplus_guest') === '1' } catch (_) { return false } })
  const setGuest = (on) => { setGuestState(on); try { if (on) sessionStorage.setItem('qdplus_guest', '1'); else sessionStorage.removeItem('qdplus_guest') } catch (_) { /* ignore */ } }
  const [wantsAuth, setWantsAuth] = useState(false)
  useEffect(() => { if (auth.user) { setGuest(false); setWantsAuth(false) } }, [auth.user])

  let content
  if (auth.loading) content = <div className="Q-splash">Quaderno<b>+</b></div>
  else if (!auth.user && (guest || (openId && !invite)) && !wantsAuth) {
    content = <GuestBrowser openId={openId} onSignIn={() => setWantsAuth(true)} />
  } else if (!auth.user) {
    const browsing = guest || (openId && !invite)
    content = (
      <AuthScreen
        reason={invite ? 'Someone shared a recipe with you. Sign in, or create a free account, to open it.' : null}
        onCancel={browsing ? () => setWantsAuth(false) : null} cancelLabel="Back to public recipes"
        onGuest={browsing || invite ? null : () => { setGuest(true); setWantsAuth(false) }}
      />
    )
  } else {
    content = (
      <>
        <Workspace key={auth.user.id} user={auth.user} profile={auth.profile} setProfile={auth.setProfile} invite={invite} openId={openId} />
        {auth.recovering && <SetPasswordModal onDone={auth.doneRecovering} />}
      </>
    )
  }
  return (
    <SettingsContext.Provider value={settingsCtx}>
      {content}
      <Toaster />
    </SettingsContext.Provider>
  )
}
