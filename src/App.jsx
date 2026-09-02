import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { dbDelete, dbInsert, dbUpdate, dbLoad, dbSetFolder } from './lib/db.js'
import { translateRecipe, autoCategorize } from './lib/ai.js'
import { ancestorPaths, buildVaultIndex, normalizeKey, tagsOf } from './lib/vault.js'
import { KEY_FOLDERS, KEY_HOME_MEDIA, loadSettings, saveSetting } from './lib/settings.js'
import { DEFAULT_LANGUAGES, applyRecipeTranslation, recipeStrings, translateMany } from './lib/i18n.js'
import LanguageBar from './components/LanguageBar.jsx'
import VaultSidebar from './components/VaultSidebar.jsx'
import HomePage from './components/HomePage.jsx'

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
const GraphView = lazyRetry(() => import('./components/GraphView.jsx'))
const Palette = lazyRetry(() => import('./components/Palette.jsx'))
const MovePicker = lazyRetry(() => import('./components/MovePicker.jsx'))

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
  const [showGraph, setShowGraph] = useState(false)
  const [palette, setPalette] = useState(null) // null | 'switcher' | 'command'
  const [folderFilter, setFolderFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [homeMedia, setHomeMedia] = useState('')
  const [createdFolders, setCreatedFolders] = useState([])
  const [homePath, setHomePath] = useState('')
  // Mobile only: the sidebar and the main pane share the screen, so this tracks which one
  // is showing. On desktop both are always visible and this has no effect.
  const [mobileNav, setMobileNav] = useState(false)
  const [moveTarget, setMoveTarget] = useState(null) // {kind,id,name,currentPath} being moved
  const [languages, setLanguages] = useState(DEFAULT_LANGUAGES)
  const [lang, setLang] = useState(() => localStorage.getItem('qdplus_lang') || 'en')
  const [transMap, setTransMap] = useState(null)   // Map(source -> translated) for the active language
  const [transBusy, setTransBusy] = useState(false)
  const [transProgress, setTransProgress] = useState(null)

  // Open on the home page rather than jumping straight into a recipe; the last recipe
  // you were working on is still one tap away via the "Continue" card there.
  const [lastRecipeId, setLastRecipeId] = useState(() => localStorage.getItem('qdplus_last_recipe') || null)

  useEffect(() => {
    dbLoad().then((data) => {
      setRecipes(data)
      const lastId = localStorage.getItem('qdplus_last_recipe')
      setLastRecipeId(lastId && data.some((r) => r.id === lastId) ? lastId : null)
    })
      .catch((e) => setSaveErr('Load failed: ' + e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadSettings().then((s) => {
      setHomeMedia(s[KEY_HOME_MEDIA]?.url || '')
      setCreatedFolders(Array.isArray(s[KEY_FOLDERS]) ? s[KEY_FOLDERS] : (s[KEY_FOLDERS]?.list || []))
      if (Array.isArray(s.languages) && s.languages.length) setLanguages(s.languages)
    })
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
      // While a translation is on screen, the object handed back carries translated text.
      // Keep the stored source text and take only the non-text changes.
      const original = recipes.find((r) => r.id === updated.id)
      const payload = (transMap && original)
        ? {
            ...updated,
            title: original.title, category: original.category, time: original.time,
            servings: original.servings, notes: original.notes,
            storage_note: original.storage_note, watch_out: original.watch_out,
            ingredients: original.ingredients, steps: original.steps,
          }
        : updated
      const saved = await dbUpdate(payload)
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
  // A create action can arrive with no usable payload (missing/!object `recipe`). Inserting it
  // anyway is what produced the empty "Untitled" ghost recipes, so reject it loudly instead.
  function isUsableAIRecipe(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false
    return Boolean((r.ingredients || []).length || (r.steps || []).length)
  }
  async function handleAppAIAction(action) {
    switch (action.type) {
      case 'create_recipe':
        if (!isUsableAIRecipe(action.recipe)) { setSaveErr('AI sent an empty recipe — nothing was created.'); break }
        try {
          const saved = await dbInsert({ ...sanitizeAIRecipe(action.recipe), notes_pad: '', thumbnail: '', source_photos: [], id_data: '', media_library: '', fixed_lang: null, copied_from: null })
          setRecipes((p) => [saved, ...p])
          setSelId(saved.id); setMode('view')
        } catch (e) { setSaveErr('Create failed: ' + e.message) }
        break
      case 'batch_create': {
        const usable = (action.recipes || []).filter(isUsableAIRecipe)
        if (!usable.length) { setSaveErr('AI sent no usable recipes — nothing was created.'); break }
        try {
          const created = await Promise.all(usable.map((r) => dbInsert({ ...sanitizeAIRecipe(r), notes_pad: '', thumbnail: '', source_photos: [], id_data: '', media_library: '', fixed_lang: null, copied_from: null })))
          setRecipes((p) => [...created, ...p])
          if (created[0]) { setSelId(created[0].id); setMode('view') }
        } catch (e) { setSaveErr('Batch create failed: ' + e.message) }
        break
      }
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

  // Translation is deliberately lazy. Doing the whole library at once would mean thousands
  // of strings and a long, expensive first switch, so this does the cheap list-level text
  // (titles and categories) up front and the full body of a recipe only when it is opened.
  // Everything lands in the shared cache, so each phrase is paid for exactly once, ever.
  useEffect(() => {
    localStorage.setItem('qdplus_lang', lang)
    if (lang === 'en' || !recipes.length) { setTransMap(null); return }
    let cancelled = false
    setTransBusy(true); setTransProgress(null)
    const folderSegments = recipes.flatMap((r) => String(r.folder || '').split('/')).map((x) => x.trim())
    const listStrings = [...new Set([
      ...recipes.flatMap((r) => [r.title, r.category]),
      ...folderSegments,
    ].filter(Boolean))]
    translateMany(listStrings, lang, { onProgress: (done, total) => !cancelled && setTransProgress({ done, total }) })
      .then((map) => { if (!cancelled) setTransMap((prev) => new Map([...(prev || []), ...map])) })
      .catch((e) => { if (!cancelled) setSaveErr('Translation failed: ' + e.message) })
      .finally(() => { if (!cancelled) { setTransBusy(false); setTransProgress(null) } })
    return () => { cancelled = true }
  }, [lang, recipes])

  // Full body of whichever recipe is open.
  useEffect(() => {
    if (lang === 'en' || !selId) return
    const source = recipes.find((r) => r.id === selId)
    if (!source) return
    let cancelled = false
    setTransBusy(true)
    translateMany(recipeStrings(source), lang, { onProgress: (done, total) => !cancelled && setTransProgress({ done, total }) })
      .then((map) => { if (!cancelled) setTransMap((prev) => new Map([...(prev || []), ...map])) })
      .catch(() => {})
      .finally(() => { if (!cancelled) { setTransBusy(false); setTransProgress(null) } })
    return () => { cancelled = true }
  }, [lang, selId, recipes])

  async function saveLanguages(list) {
    setLanguages(list)
    if (!(await saveSetting('languages', list))) setSaveErr('Could not save the language list.')
  }

  // What the UI actually renders: the stored recipes with translated text applied.
  const shownRecipes = useMemo(
    () => (transMap ? recipes.map((r) => applyRecipeTranslation(r, transMap)) : recipes),
    [recipes, transMap],
  )

  // Display-only translation for labels that double as identifiers (folder path segments).
  // The stored path is never rewritten — only what the user sees.
  const tr = useMemo(() => (text) => (transMap && transMap.get(text)) || text, [transMap])

  const sel = shownRecipes.find((x) => x.id === selId) || null
  // The stored, source-language record. Everything that *writes* must go through this so a
  // translated view can never be saved back over the original text.
  const selSource = recipes.find((x) => x.id === selId) || null
  const vault = useMemo(() => buildVaultIndex(shownRecipes), [shownRecipes])
  // Folders in use by recipes, plus empty ones the user created (and every parent of both).
  const allFolders = useMemo(() => {
    const set = new Set(vault.folderCounts.keys())
    for (const f of createdFolders) for (const anc of ancestorPaths(f)) set.add(anc)
    return [...set].sort()
  }, [vault, createdFolders])
  const allTags = useMemo(() => [...vault.tagCounts.keys()].sort(), [vault])

  const filtered = useMemo(() => {
    let list = shownRecipes.filter((r) => {
      if (folderFilter) {
        const f = String(r.folder || '')
        if (f !== folderFilter && !f.startsWith(folderFilter + '/')) return false
      }
      if (tagFilter && !tagsOf(r).some((t) => t === tagFilter || t.startsWith(tagFilter + '/'))) return false
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
  }, [shownRecipes, q, sortMode, recentlyOpened, folderFilter, tagFilter])

  const openRecipe = useCallback((id) => {
    setSelId(id); setMode('view'); setMobileNav(false)
    setRecentlyOpened((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 50)
      localStorage.setItem('qdplus_opened', JSON.stringify(next))
      return next
    })
  }, [])

  // Clicking an unresolved [[link]] creates that recipe, the way Obsidian creates a note on the fly.
  async function createFromLink(title) {
    const existing = recipes.find((r) => normalizeKey(r.title) === normalizeKey(title))
    if (existing) { openRecipe(existing.id); return }
    try {
      const saved = await dbInsert({
        title, category: '', time: '', servings: '', notes: '', source: 'Manual',
        ingredients: [], steps: [], notes_pad: '', thumbnail: '', source_photos: [],
        id_data: '', media_library: '', fixed_lang: null, copied_from: null,
        tags: [], folder: sel?.folder || '',
      })
      setRecipes((p) => [saved, ...p])
      setSelId(saved.id); setMode('edit')
    } catch (e) { setSaveErr('Create failed: ' + e.message) }
  }

  // Appends a [[link]] to the source recipe's notes — the "Link it" button on unlinked mentions.
  async function linkBack(fromId, targetTitle) {
    const r = recipes.find((x) => x.id === fromId)
    if (!r) return
    const note = (r.notes || '').trim()
    await updateRecipe({ ...r, notes: (note ? note + '\n' : '') + `Related: [[${targetTitle}]]` })
  }

  // Turns the existing (messy, inconsistently-cased) categories into a clean folder tree.
  // "Panadería / Viennoiserie" nests as two levels; "cookies"/"Cookies" collapse to one folder.
  async function fileByCategory() {
    const canonical = new Map()
    const freq = new Map()
    for (const r of recipes) {
      const cat = String(r.category || '').trim()
      if (!cat) continue
      const path = cat.split('/').map((p) => p.trim()).filter(Boolean).join('/')
      const key = path.toLowerCase()
      freq.set(key, (freq.get(key) || 0) + 1)
      const prev = canonical.get(key)
      // Prefer the capitalised spelling when the same folder appears in several casings.
      if (!prev || (/^[a-z]/.test(prev) && /^[A-Z]/.test(path))) canonical.set(key, path)
    }
    const targets = recipes.filter((r) => !String(r.folder || '').trim() && String(r.category || '').trim())
    if (!targets.length) { alert('Every recipe with a category is already filed.'); return }
    if (!window.confirm(`File ${targets.length} recipe${targets.length !== 1 ? 's' : ''} into ${canonical.size} folders based on their category?\n\nRecipes already in a folder are left alone.`)) return
    setCategorizingAI(true)
    try {
      for (const r of targets) {
        const key = String(r.category || '').split('/').map((p) => p.trim()).filter(Boolean).join('/').toLowerCase()
        const folder = canonical.get(key)
        if (!folder) continue
        const saved = await dbUpdate({ ...r, folder })
        setRecipes((p) => p.map((x) => (x.id === saved.id ? saved : x)))
      }
    } catch (e) { setSaveErr('Filing failed: ' + e.message) } finally { setCategorizingAI(false) }
  }

  // An empty folder has no recipe pointing at it, so it only exists in settings until used.
  async function createFolder(path) {
    const clean = String(path || '').split('/').map((p) => p.trim()).filter(Boolean).join('/')
    if (!clean || allFolders.includes(clean)) return
    const next = [...createdFolders, clean]
    setCreatedFolders(next)
    if (!(await saveSetting(KEY_FOLDERS, next))) setSaveErr('Could not save the new folder.')
  }

  // --- Moving things around the tree -------------------------------------------------
  // A folder is just a path prefix on its recipes, so moving or renaming one means
  // rewriting that prefix everywhere it appears — on recipes and in the created-folder list.
  async function rewriteFolderPrefix(fromPath, toPath) {
    if (!fromPath || fromPath === toPath) return
    const affected = recipes.filter((r) => {
      const f = String(r.folder || '')
      return f === fromPath || f.startsWith(fromPath + '/')
    })
    // Group by destination so each distinct new path is one request.
    const byDest = new Map()
    for (const r of affected) {
      const dest = toPath + String(r.folder).slice(fromPath.length)
      if (!byDest.has(dest)) byDest.set(dest, [])
      byDest.get(dest).push(r.id)
    }
    try {
      for (const [dest, ids] of byDest) {
        const saved = await dbSetFolder(ids, dest)
        setRecipes((p) => p.map((x) => saved.find((s) => s.id === x.id) || x))
      }
      const nextFolders = createdFolders.map((f) => (
        f === fromPath || f.startsWith(fromPath + '/') ? toPath + f.slice(fromPath.length) : f
      ))
      setCreatedFolders(nextFolders)
      await saveSetting(KEY_FOLDERS, nextFolders)
      // Keep the user where they were looking if they moved the folder they're inside.
      setHomePath((p) => (p === fromPath || p.startsWith(fromPath + '/') ? toPath + p.slice(fromPath.length) : p))
      setFolderFilter((p) => (p === fromPath || p.startsWith(fromPath + '/') ? toPath + p.slice(fromPath.length) : p))
    } catch (e) {
      setSaveErr('Move failed: ' + e.message)
    }
  }

  function isDescendant(path, maybeAncestor) {
    return path === maybeAncestor || path.startsWith(maybeAncestor + '/')
  }

  async function moveFolder(fromPath, toParent) {
    const name = fromPath.split('/').pop()
    const dest = toParent ? `${toParent}/${name}` : name
    if (dest === fromPath) return
    // Moving a folder inside itself would orphan the whole subtree.
    if (toParent && isDescendant(toParent, fromPath)) { setSaveErr("Can't move a folder into itself."); return }
    if (allFolders.includes(dest)) { setSaveErr(`"${dest}" already exists.`); return }
    await rewriteFolderPrefix(fromPath, dest)
  }

  async function renameFolder(fromPath, newName) {
    const clean = String(newName || '').trim().replace(/\//g, ' ')
    if (!clean) return
    const parent = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
    const dest = parent ? `${parent}/${clean}` : clean
    if (dest === fromPath) return
    if (allFolders.includes(dest)) { setSaveErr(`"${dest}" already exists.`); return }
    await rewriteFolderPrefix(fromPath, dest)
  }

  async function moveRecipe(id, toPath) {
    const r = recipes.find((x) => x.id === id)
    if (!r || String(r.folder || '') === toPath) return
    try {
      const saved = await dbSetFolder([id], toPath)
      setRecipes((p) => p.map((x) => saved.find((s) => s.id === x.id) || x))
    } catch (e) { setSaveErr('Move failed: ' + e.message) }
  }

  // Removing a folder never deletes recipes — they move up to the parent.
  async function deleteFolder(path) {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const inside = recipes.filter((r) => isDescendant(String(r.folder || ''), path))
    const msg = inside.length
      ? `Remove the folder "${path}"?\n\n${inside.length} recipe${inside.length !== 1 ? 's' : ''} will move ${parent ? `to "${parent}"` : 'to the top level'}. Nothing is deleted.`
      : `Remove the empty folder "${path}"?`
    if (!window.confirm(msg)) return
    try {
      if (inside.length) {
        const saved = await dbSetFolder(inside.map((r) => r.id), parent)
        setRecipes((p) => p.map((x) => saved.find((s) => s.id === x.id) || x))
      }
      const nextFolders = createdFolders.filter((f) => !isDescendant(f, path))
      setCreatedFolders(nextFolders)
      await saveSetting(KEY_FOLDERS, nextFolders)
      setHomePath((p) => (isDescendant(p, path) ? parent : p))
    } catch (e) { setSaveErr('Delete folder failed: ' + e.message) }
  }

  async function setCover(url) {
    setHomeMedia(url)
    if (!(await saveSetting(KEY_HOME_MEDIA, { url }))) setSaveErr('Could not save the cover.')
  }

  function goHome() { setSelId(null); setMode('view'); setHomePath(''); setMobileNav(false) }

  const commands = useMemo(() => [
    { id: 'home', icon: '⌂', title: 'Go to home page', shortcut: '', run: goHome },
    { id: 'newfolder', icon: '🗂', title: 'Create a new folder', shortcut: '', run: () => { goHome(); setTimeout(() => document.querySelector('.H-section-head .H-btn')?.click(), 60) } },
    { id: 'file', icon: '🗂', title: 'Organize: file recipes into folders by category', shortcut: '', run: fileByCategory },
    { id: 'new', icon: '＋', title: 'Create new recipe', shortcut: '', run: () => { setMode('new'); setSelId(null) } },
    { id: 'graph', icon: '🕸', title: 'Open graph view', shortcut: '⌘G', run: () => setShowGraph(true) },
    { id: 'switch', icon: '🔎', title: 'Quick switcher: jump to recipe', shortcut: '⌘O', run: () => setPalette('switcher') },
    { id: 'library', icon: '📦', title: 'Open ingredient library', shortcut: '', run: () => setShowLibrary(true) },
    { id: 'compare', icon: '⚖', title: 'Compare recipes', shortcut: '', run: () => setShowCompare(true) },
    { id: 'ai', icon: '🌐', title: 'Open AI assistant', shortcut: '', run: () => setShowAppAI(true) },
    { id: 'cat', icon: '🏷', title: 'AI auto-categorize recipes', shortcut: '', run: handleAutoCategories },
    { id: 'clearf', icon: '✕', title: 'Clear folder & tag filters', shortcut: '', run: () => { setFolderFilter(''); setTagFilter('') } },
    { id: 'star', icon: '★', title: 'Toggle bookmark on current recipe', shortcut: '', run: () => sel && updateRecipe({ ...sel, is_favorite: !sel.is_favorite }) },
    { id: 'edit', icon: '✎', title: 'Edit current recipe', shortcut: '', run: () => sel && setMode('edit') },
  ], [sel, recipes])

  // Obsidian's core shortcuts. Uses code-based keys so they work on non-QWERTY layouts too.
  useEffect(() => {
    function onKey(e) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
      if (e.code === 'KeyO' && !e.shiftKey) { e.preventDefault(); setPalette('switcher') }
      else if (e.code === 'KeyP' && !e.shiftKey) { e.preventDefault(); setPalette('command') }
      else if (e.code === 'KeyG' && !e.shiftKey) { e.preventDefault(); setShowGraph((v) => !v) }
      else if (e.code === 'KeyF' && e.shiftKey && !inField) { e.preventDefault(); setPalette(null); document.querySelector('.Q-search input')?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // On mobile the main pane (home page or a recipe) is the default; the sidebar is opened
  // deliberately. Desktop ignores this — the media query only kicks in under 700px.
  const isOpen = !mobileNav

  return (
    <div className="Q" data-open={isOpen ? '1' : '0'}>
      <header className="Q-top">
        <button className="Q-brand Q-brand-btn" onClick={goHome} title="Go to home page">
          Quaderno<span className="ai-badge">AI</span><span className="id-badge">+</span>
        </button>
        <div className="Q-top-right">
          {saveErr && <span style={{ color: '#9b2c2c', fontSize: 10, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{saveErr}</span>}
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>{!loading && `${recipes.length} recipe${recipes.length !== 1 ? 's' : ''}`}</span>
          <LanguageBar
            languages={languages} current={lang} onPick={setLang}
            onSaveLanguages={saveLanguages} busy={transBusy} progress={transProgress}
          />
          <button className="btn ghost xs Q-home-btn" onClick={goHome} title="Go to home page">⌂ Home</button>
          <button className="btn id xs" onClick={() => setShowCompare(true)} title="Compare recipes">⚖ Compare</button>
          <button className="btn id xs" onClick={() => setShowLibrary(true)} title="Ingredient Library">📦 Library</button>
          <button className="btn ai xs" onClick={() => setShowAppAI(true)} title="App AI Assistant">🌐 AI</button>
          <button className="btn amber" onClick={() => { setMode('new'); setSelId(null) }}>＋ New</button>
        </div>
      </header>

      <div className="Q-body">
        <VaultSidebar
          recipes={filtered} index={vault} selId={mode === 'view' ? selId : null} onOpen={openRecipe}
          q={q} setQ={setQ} sortMode={sortMode} setSortMode={setSortMode}
          onAutoCategorize={handleAutoCategories} categorizingAI={categorizingAI}
          folderFilter={folderFilter} setFolderFilter={setFolderFilter}
          tagFilter={tagFilter} setTagFilter={setTagFilter}
          loading={loading} onOpenGraph={() => setShowGraph(true)}
          onCreateFolder={createFolder} allFolders={allFolders}
          onMoveFolder={moveFolder} onMoveRecipe={moveRecipe} tr={tr}
        />

        <main className="Q-main">
          <div className="Q-pane">
            <button className="btn ghost xs Q-back-btn" style={{ marginBottom: 14 }} onClick={() => setMobileNav(true)}>☰ Folders & search</button>
            <Suspense fallback={<div className="Q-msg">Loading…</div>}>
              {mode === 'new' && <RecipeEditor onSave={saveRecipe} onCancel={() => { setMode('view'); setSelId(recipes[0]?.id || null) }} />}
              {mode === 'edit' && selSource && <RecipeEditor initial={selSource} onSave={saveRecipe} onCancel={() => setMode('view')} />}
              {mode === 'view' && sel && (
                <RecipeView
                  key={sel.id} recipe={sel} onEdit={() => setMode('edit')} onDelete={() => deleteRecipe(sel.id)}
                  onUpdate={updateRecipe} allRecipes={shownRecipes} onCopy={copyRecipe} onSaveVariant={saveVariant}
                  vault={vault} allFolders={allFolders} allTags={allTags}
                  onOpenRecipe={openRecipe} onCreateFromLink={createFromLink} onLinkBack={linkBack}
                />
              )}
            </Suspense>
            {mode === 'view' && !sel && !loading && (
              <>
                {lastRecipeId && recipes.some((r) => r.id === lastRecipeId) && !homePath && (
                  <button className="H-continue" onClick={() => openRecipe(lastRecipeId)}>
                    <span className="H-continue-label">Continue where you left off</span>
                    <span className="H-continue-title">{recipes.find((r) => r.id === lastRecipeId)?.title}</span>
                  </button>
                )}
                <HomePage
                  recipes={shownRecipes} folders={allFolders} path={homePath} setPath={setHomePath}
                  onOpenRecipe={openRecipe} onCreateFolder={createFolder}
                  mediaUrl={homeMedia} onSetMedia={setCover}
                  onNewRecipe={() => { setMode('new'); setSelId(null) }}
                  onMoveFolder={moveFolder} onRenameFolder={renameFolder}
                  onDeleteFolder={deleteFolder} onMoveRecipe={moveRecipe}
                  onRequestMove={setMoveTarget} tr={tr}
                />
              </>
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
      {showGraph && (
        <Suspense fallback={null}>
          <GraphView recipes={shownRecipes} index={vault} selId={selId} onOpen={openRecipe} onClose={() => setShowGraph(false)} />
        </Suspense>
      )}
      {moveTarget && (
        <Suspense fallback={null}>
          <MovePicker
            title={moveTarget.kind === 'bulk' ? 'Move selection' : `Move ${moveTarget.kind === 'folder' ? 'folder' : 'recipe'}`}
            subtitle={moveTarget.name}
            folders={allFolders}
            currentPath={moveTarget.currentPath}
            blockedPrefix={moveTarget.kind === 'folder' ? moveTarget.id : null}
            blockedPrefixes={moveTarget.kind === 'bulk' ? moveTarget.items.filter((i) => i.kind === 'folder').map((i) => i.id) : null}
            onPick={async (dest) => {
              if (moveTarget.kind === 'bulk') {
                // Folders first: moving a parent rewrites the paths of anything under it,
                // so doing recipes afterwards works off the settled tree.
                for (const it of moveTarget.items.filter((i) => i.kind === 'folder')) await moveFolder(it.id, dest)
                for (const it of moveTarget.items.filter((i) => i.kind === 'recipe')) await moveRecipe(it.id, dest)
              } else if (moveTarget.kind === 'folder') moveFolder(moveTarget.id, dest)
              else moveRecipe(moveTarget.id, dest)
            }}
            onClose={() => setMoveTarget(null)}
          />
        </Suspense>
      )}
      {palette && (
        <Suspense fallback={null}>
          <Palette
            mode={palette === 'command' ? 'command' : 'switcher'}
            recipes={shownRecipes} commands={commands}
            onClose={() => setPalette(null)}
            onOpenRecipe={openRecipe}
            onRunCommand={(c) => c.run()}
          />
        </Suspense>
      )}
    </div>
  )
}
