import { useEffect, useMemo, useState } from 'react'
import { MoreHorizontal, Search, Star, X } from 'lucide-react'
import {
  INGREDIENT_TYPES, collectAllIngredientNames, defaultCategoryForType, expandSearchQuery,
  findRecipesForIngredient, getAllCategories, libDelete, libFindMatch, libLoad, libUpsert,
} from '../lib/ingredientLibrary.js'
import { analyzeMacros, categorizeIngredients, describeIngredient } from '../lib/ai.js'
import Modal from './ui/Modal.jsx'
import Menu, { MenuItem, MenuLabel, MenuSep } from './ui/Menu.jsx'
import { toast } from './ui/Toaster.jsx'

const STD_PARAMS = ['fat_pct', 'water_pct', 'free_water_pct', 'sugar_pct', 'protein_pct', 'carbs_pct', 'cal_per100', 'flour_equivalent_pct']
const STD_LABELS = { fat_pct: 'Fat %', water_pct: 'Water %', free_water_pct: 'Free water %', sugar_pct: 'Sugar %', protein_pct: 'Protein %', carbs_pct: 'Carbs %', cal_per100: 'kcal / 100 g', flour_equivalent_pct: 'Flour equiv. %' }
const BLANK_ITEM = { name: '', canonical_name: '', ingredient_type: 'other', categories: [], aliases: [], params: {}, ai_notes: '', descriptor: '', is_favorite: false }
const BATCH_SIZE = 25

function applyAiResult(item, vals) {
  const type = vals.ingredient_type || item.ingredient_type
  const seeded = defaultCategoryForType(type)
  const categories = (item.categories || []).length ? item.categories : (seeded ? [seeded] : [])
  return {
    ...item,
    ingredient_type: type,
    categories,
    params: {
      fat_pct: vals.fat_pct || 0, water_pct: vals.water_pct || 0, free_water_pct: vals.free_water_pct || 0,
      sugar_pct: vals.sugar_pct || 0, protein_pct: vals.protein_pct || 0, carbs_pct: vals.carbs_pct || 0,
      cal_per100: vals.cal_per100 || 0, flour_equivalent_pct: vals.flour_equivalent_pct || 0,
    },
    ai_notes: vals.notes || '',
  }
}

function CategoryEditor({ categories, setCategories, allCategories }) {
  const [input, setInput] = useState('')
  const add = (raw) => {
    const c = raw.trim().toLowerCase()
    if (!c) return
    setCategories((prev) => (prev.includes(c) ? prev : [...prev, c]))
    setInput('')
  }
  const suggestions = allCategories.filter((c) => !categories.includes(c) && (!input || c.includes(input.toLowerCase()))).slice(0, 8)
  return (
    <div className="Q-field">
      <label>Categories</label>
      <div className="Q-tags">
        {categories.map((c) => (
          <span key={c} className="Q-tag">{c}<button type="button" onClick={() => setCategories((p) => p.filter((x) => x !== c))} aria-label={`Remove ${c}`}><X size={11} /></button></span>
        ))}
        <input
          className="Q-tag-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={categories.length ? 'Add…' : 'Add a category…'}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(input) } }}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="Q-tag-suggest">{suggestions.map((c) => <button key={c} type="button" onClick={() => add(c)}>{c}</button>)}</div>
      )}
    </div>
  )
}

function IngredientForm({ item, setItem, onSave, onCancel, saveLabel, allCategories }) {
  const [newParamKey, setNewParamKey] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [descBusy, setDescBusy] = useState(false)
  const set = (k) => (e) => setItem((p) => ({ ...p, [k]: e.target.value }))

  async function aiDescriptor() {
    if (!item.name.trim()) { toast.error('Enter a name first.'); return }
    setDescBusy(true)
    try {
      const { text } = await describeIngredient(item.name.trim(), item.ingredient_type)
      setItem((p) => ({ ...p, descriptor: text || p.descriptor }))
    } catch (e) { toast.error('Could not write a description: ' + e.message) } finally { setDescBusy(false) }
  }
  async function aiFill() {
    if (!item.name.trim()) { toast.error('Enter a name first.'); return }
    setAiBusy(true)
    try {
      const json = await analyzeMacros('Single ingredient lookup', [{ name: item.name.trim(), qty: 100, unit: 'g' }])
      const vals = Object.values(json.cache || {})[0]
      if (!vals) { toast.error('AI could not analyze this ingredient.'); return }
      setItem((p) => applyAiResult(p, vals))
    } catch (e) { toast.error('AI analysis failed: ' + e.message) } finally { setAiBusy(false) }
  }
  function addParam() {
    const key = newParamKey.trim().toLowerCase().split(' ').join('_')
    if (!key) return
    setItem((p) => ({ ...p, params: { ...p.params, [key]: 0 } })); setNewParamKey('')
  }
  const setParam = (key, v) => setItem((p) => ({ ...p, params: { ...p.params, [key]: parseFloat(v) || 0 } }))
  const customKeys = Object.keys(item.params || {}).filter((k) => !STD_PARAMS.includes(k))

  return (
    <div className="Q-ingform">
      <div className="Q-grid2">
        <div className="Q-field"><label>Name</label><input autoFocus value={item.name} onChange={set('name')} /></div>
        <div className="Q-field"><label>Also known as</label><input value={(item.aliases || []).join(', ')} placeholder="Comma separated" onChange={(e) => setItem((p) => ({ ...p, aliases: e.target.value.split(',').map((a) => a.trim()).filter(Boolean) }))} /></div>
      </div>
      <CategoryEditor categories={item.categories || []} setCategories={(fn) => setItem((p) => ({ ...p, categories: fn(p.categories || []) }))} allCategories={allCategories} />
      <div className="Q-field">
        <label>Description <button type="button" className="Q-link" onClick={aiDescriptor} disabled={descBusy}>{descBusy ? 'Writing…' : 'Write with AI'}</button></label>
        <input value={item.descriptor || ''} onChange={set('descriptor')} placeholder="What it is, its flavour, how it is used" />
      </div>
      <details className="Q-ingform-more">
        <summary>Nutrition data</summary>
        <div className="Q-ingform-row">
          <div className="Q-field">
            <label>Type</label>
            <select className="Q-select" value={item.ingredient_type} onChange={set('ingredient_type')}>
              {INGREDIENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button type="button" className="Q-link" onClick={aiFill} disabled={aiBusy}>{aiBusy ? 'Analyzing…' : 'Fill with AI'}</button>
        </div>
        <div className="Q-param-grid">
          {STD_PARAMS.map((key) => (
            <label key={key}><span>{STD_LABELS[key]}</span><input type="number" step="0.1" value={item.params?.[key] ?? ''} onChange={(e) => setParam(key, e.target.value)} /></label>
          ))}
          {customKeys.map((key) => (
            <label key={key}>
              <span>{key.replace(/_/g, ' ')} <button type="button" onClick={() => { const p = { ...item.params }; delete p[key]; setItem((x) => ({ ...x, params: p })) }} aria-label="Remove"><X size={11} /></button></span>
              <input type="number" step="0.01" value={item.params[key] ?? ''} onChange={(e) => setParam(key, e.target.value)} />
            </label>
          ))}
        </div>
        <div className="Q-ingform-row">
          <input className="Q-inline-input" value={newParamKey} onChange={(e) => setNewParamKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addParam() } }} placeholder="Add a parameter…" />
        </div>
        {item.ai_notes && <p className="Q-dim" style={{ margin: '8px 0 0' }}>{item.ai_notes}</p>}
      </details>
      <div className="Q-ingform-foot">
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary sm" onClick={onSave}>{saveLabel}</button>
      </div>
    </div>
  )
}

export default function IngredientLibraryModal({ onClose, recipes = [] }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [grouped, setGrouped] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [editItem, setEditItem] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newItem, setNewItem] = useState(BLANK_ITEM)
  const [collapsedCats, setCollapsedCats] = useState(new Set())
  const [busy, setBusy] = useState(null) // { label, done, total }
  const [scope, setScope] = useState('all') // 'all' | 'selected'
  const [scopeIds, setScopeIds] = useState(new Set())
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [bulkCat, setBulkCat] = useState('')

  useEffect(() => { libLoad().then((d) => { setItems(d); setLoading(false) }) }, [])
  const reload = async () => setItems(await libLoad())

  const allCategories = useMemo(() => getAllCategories(items), [items])
  const categoryCounts = useMemo(() => {
    const counts = new Map()
    for (const it of items) for (const c of it.categories || []) counts.set(c, (counts.get(c) || 0) + 1)
    return counts
  }, [items])
  const filtered = useMemo(() => {
    const terms = expandSearchQuery(search)
    return items
      .filter((it) => {
        const hay = [it.name, it.canonical_name, ...(it.aliases || [])].join(' ').toLowerCase()
        return (!terms.length || terms.some((t) => hay.includes(t)))
          && (!categoryFilter || (it.categories || []).includes(categoryFilter))
          && (!favoritesOnly || it.is_favorite)
      })
      .sort((a, b) => (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0) || a.name.localeCompare(b.name))
  }, [items, search, categoryFilter, favoritesOnly])
  // An item with several categories appears once under each (Reblochon → dairy, cheese, fermented).
  const groups = useMemo(() => {
    const g = new Map()
    for (const it of filtered) for (const c of (it.categories?.length ? it.categories : ['uncategorized'])) { if (!g.has(c)) g.set(c, []); g.get(c).push(it) }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])
  const usageMap = useMemo(() => {
    const m = new Map()
    for (const it of items) m.set(it.id, findRecipesForIngredient(it, recipes))
    return m
  }, [items, recipes])
  const scopedRecipes = scope === 'selected' ? recipes.filter((r) => scopeIds.has(r.id)) : recipes
  const missingNames = useMemo(() => collectAllIngredientNames(scopedRecipes).filter((n) => !libFindMatch(n, items)), [scopedRecipes, items])
  const targets = selected.size ? filtered.filter((i) => selected.has(i.id)) : filtered

  // ── actions ───────────────────────────────────────────────────────────────
  async function addMissing() {
    if (!missingNames.length) return
    if (!window.confirm(`Add ${missingNames.length} ingredient${missingNames.length === 1 ? '' : 's'} from your recipes to the library?`)) return
    setBusy({ label: 'Adding', done: 0, total: missingNames.length })
    for (let i = 0; i < missingNames.length; i++) {
      const name = missingNames[i]
      await libUpsert({ name, canonical_name: name, ingredient_type: 'other', categories: [], aliases: [], params: {}, ai_notes: '', source: 'manual' })
      setBusy({ label: 'Adding', done: i + 1, total: missingNames.length })
    }
    await reload(); setBusy(null); toast.success('Ingredients added')
  }
  async function analyzeMissing() {
    if (!missingNames.length) return
    setBusy({ label: 'Analyzing', done: 0, total: missingNames.length })
    for (let i = 0; i < missingNames.length; i += BATCH_SIZE) {
      const batch = missingNames.slice(i, i + BATCH_SIZE).map((name) => ({ name, qty: 100, unit: 'g' }))
      try {
        const json = await analyzeMacros('Ingredient Library — bulk analysis', batch)
        for (const [n, vals] of Object.entries(json.cache || {})) {
          await libUpsert({ ...applyAiResult({ name: n, canonical_name: n, ingredient_type: 'other', categories: [], aliases: [] }, vals), source: 'AI' })
        }
      } catch (e) { console.error('Bulk analysis batch failed:', e) }
      setBusy({ label: 'Analyzing', done: Math.min(missingNames.length, i + BATCH_SIZE), total: missingNames.length })
    }
    await reload(); setBusy(null); toast.success('Nutrition data added')
  }
  async function aiCategorize() {
    const list = targets
    if (!list.length) return
    setBusy({ label: 'Categorizing', done: 0, total: list.length })
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE)
      try {
        const json = await categorizeIngredients(batch.map((it) => ({ name: it.name, ingredient_type: it.ingredient_type })), allCategories)
        for (const [name, cats] of Object.entries(json.categories || {})) {
          if (!Array.isArray(cats) || !cats.length) continue
          const match = batch.find((it) => it.name === name) || batch.find((it) => it.name.toLowerCase() === name.toLowerCase())
          if (!match) continue
          await libUpsert({ ...match, categories: Array.from(new Set([...(match.categories || []), ...cats.map((c) => String(c).toLowerCase())])) })
        }
      } catch (e) { console.error('AI categorize batch failed:', e) }
      setBusy({ label: 'Categorizing', done: Math.min(list.length, i + BATCH_SIZE), total: list.length })
    }
    await reload(); setBusy(null); toast.success('Categories updated')
  }
  async function applyCategory() {
    const c = bulkCat.trim().toLowerCase()
    if (!c || !targets.length) return
    setBusy({ label: 'Applying', done: 0, total: targets.length })
    let n = 0
    for (const it of targets) {
      if (!(it.categories || []).includes(c)) await libUpsert({ ...it, categories: [...(it.categories || []), c] })
      setBusy({ label: 'Applying', done: ++n, total: targets.length })
    }
    await reload(); setBusy(null); setBulkCat(''); toast.success(`“${c}” added to ${targets.length} ingredients`)
  }
  async function saveEdit() { await libUpsert(editItem); await reload(); setEditItem(null) }
  async function saveCreate() {
    if (!newItem.name.trim()) { toast.error('Name is required.'); return }
    await libUpsert({ ...newItem, canonical_name: newItem.canonical_name.trim() || newItem.name.trim() })
    await reload(); setCreating(false)
  }
  async function remove(item) {
    if (!window.confirm(`Delete “${item.name}” from the library?`)) return
    await libDelete(item.id)
    setItems((p) => p.filter((i) => i.id !== item.id)); setOpenId(null)
  }
  async function toggleFavorite(item) {
    const updated = { ...item, is_favorite: !item.is_favorite }
    setItems((p) => p.map((i) => (i.id === item.id ? updated : i)))
    await libUpsert(updated)
  }
  const toggleSet = (setter, id) => setter((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  // ── rendering ─────────────────────────────────────────────────────────────
  const row = (item) => {
    if (editItem?.id === item.id) {
      return <li key={item.id} className="Q-ing-item editing"><IngredientForm item={editItem} setItem={setEditItem} onSave={saveEdit} onCancel={() => setEditItem(null)} saveLabel="Save" allCategories={allCategories} /></li>
    }
    const usage = usageMap.get(item.id) || []
    const open = openId === item.id
    return (
      <li key={item.id} className={`Q-ing-item${open ? ' open' : ''}${selecting && selected.has(item.id) ? ' on' : ''}`}>
        <div className="Q-ing-line" onClick={() => (selecting ? toggleSet(setSelected, item.id) : setOpenId(open ? null : item.id))}>
          {selecting && <span className="Q-check" aria-hidden="true" />}
          <span className="Q-ing-title">
            {item.name}
            {item.is_favorite && <Star size={12} fill="currentColor" className="Q-ing-star" />}
          </span>
          <span className="Q-ing-cats">{(item.categories || []).join(', ')}</span>
          <span className="Q-ing-uses">{usage.length ? `${usage.length} recipe${usage.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        {open && !selecting && (
          <div className="Q-ing-detail">
            {item.descriptor && <p>{item.descriptor}</p>}
            {(item.aliases || []).length > 0 && <p className="Q-dim">Also: {item.aliases.join(', ')}</p>}
            {usage.length > 0 && <p className="Q-dim">Used in {usage.map((r) => r.title).join(', ')}</p>}
            <div className="Q-ing-actions">
              <button onClick={() => setEditItem({ ...item, categories: [...(item.categories || [])], params: { ...(item.params || {}) }, aliases: [...(item.aliases || [])] })}>Edit</button>
              <button onClick={() => toggleFavorite(item)}>{item.is_favorite ? 'Unfavorite' : 'Favorite'}</button>
              <button className="danger" onClick={() => remove(item)}>Delete</button>
            </div>
          </div>
        )}
      </li>
    )
  }

  return (
    <Modal title="Ingredients" onClose={onClose} width={760} className="Q-lib">
      <div className="Q-lib-bar">
        <div className="Q-search">
          <Search size={15} className="Q-search-ico" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${items.length} ingredients`} aria-label="Search ingredients" />
        </div>
        <select className="Q-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {allCategories.map((c) => <option key={c} value={c}>{c}{categoryCounts.get(c) ? ` (${categoryCounts.get(c)})` : ''}</option>)}
        </select>
        <Menu width={270} trigger={(p) => <button className="Q-icon-btn" onClick={p.toggle} aria-label="Library tools" title="Library tools"><MoreHorizontal size={18} /></button>}>
          <MenuItem checked={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)}>Favorites only</MenuItem>
          <MenuItem checked={grouped} onClick={() => setGrouped((v) => !v)}>Group by category</MenuItem>
          <MenuSep />
          <MenuLabel>From {scope === 'all' ? 'all recipes' : `${scopeIds.size} chosen recipes`}</MenuLabel>
          <MenuItem disabled={!missingNames.length || !!busy} hint={missingNames.length || ''} onClick={addMissing}>Add missing ingredients</MenuItem>
          <MenuItem disabled={!missingNames.length || !!busy} hint={missingNames.length || ''} onClick={analyzeMissing}>Add them with nutrition (AI)</MenuItem>
          <MenuItem onClick={() => setScope((s) => (s === 'all' ? 'selected' : 'all'))}>{scope === 'all' ? 'Choose recipes…' : 'Use all recipes'}</MenuItem>
          <MenuSep />
          <MenuItem disabled={!targets.length || !!busy} hint={targets.length} onClick={aiCategorize}>Categorize with AI</MenuItem>
          <MenuItem onClick={() => { setSelecting((v) => !v); setSelected(new Set()) }}>{selecting ? 'Stop selecting' : 'Select ingredients…'}</MenuItem>
        </Menu>
        <button className="btn primary sm" onClick={() => { setEditItem(null); setNewItem(BLANK_ITEM); setCreating(true) }}>Add</button>
      </div>

      {busy && (
        <div className="Q-lib-busy">
          <span>{busy.label} {busy.done} of {busy.total}…</span>
          <div className="Q-meter"><i style={{ width: `${(busy.done / Math.max(1, busy.total)) * 100}%` }} /></div>
        </div>
      )}

      {scope === 'selected' && (
        <div className="Q-lib-scope">
          <div className="Q-dim">Tools use only these recipes:</div>
          <div className="Q-lib-chips">
            {recipes.map((r) => (
              <button key={r.id} className={scopeIds.has(r.id) ? 'on' : ''} onClick={() => toggleSet(setScopeIds, r.id)}>{r.title}</button>
            ))}
          </div>
        </div>
      )}

      {selecting && (
        <div className="Q-lib-select">
          <span>{selected.size ? `${selected.size} selected` : `All ${filtered.length} shown`}</span>
          <button className="Q-link" onClick={() => setSelected(new Set(filtered.map((i) => i.id)))}>Select all</button>
          {selected.size > 0 && <button className="Q-link" onClick={() => setSelected(new Set())}>Clear</button>}
          <input className="Q-inline-input" value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyCategory() }} placeholder="Category to add…" />
          <button className="btn ghost sm" disabled={!bulkCat.trim() || !!busy} onClick={applyCategory}>Apply</button>
          {bulkCat.trim() && (
            <div className="Q-tag-suggest wide">
              {allCategories.filter((c) => c.includes(bulkCat.trim().toLowerCase()) && c !== bulkCat.trim().toLowerCase()).slice(0, 8).map((c) => (
                <button key={c} type="button" onClick={() => setBulkCat(c)}>{c}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {creating && (
        <div className="Q-ing-item editing" style={{ marginBottom: 12 }}>
          <IngredientForm item={newItem} setItem={setNewItem} onSave={saveCreate} onCancel={() => setCreating(false)} saveLabel="Add ingredient" allCategories={allCategories} />
        </div>
      )}

      {loading && <div className="Q-msg">Loading…</div>}
      {!loading && !filtered.length && !creating && <div className="Q-msg">No ingredients found.</div>}

      {!grouped && <ul className="Q-ing-list">{filtered.map(row)}</ul>}
      {grouped && groups.map(([cat, list]) => {
        const collapsed = collapsedCats.has(cat)
        return (
          <div key={cat} className="Q-ing-group">
            <button className="Q-ing-group-h" onClick={() => toggleSet(setCollapsedCats, cat)}>
              <span>{cat}</span><span className="Q-dim">{list.length}{collapsed ? ' · show' : ''}</span>
            </button>
            {!collapsed && <ul className="Q-ing-list">{list.map(row)}</ul>}
          </div>
        )
      })}
    </Modal>
  )
}
