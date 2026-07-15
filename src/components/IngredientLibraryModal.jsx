import { useEffect, useMemo, useState } from 'react'
import {
  INGREDIENT_TYPES, collectAllIngredientNames, defaultCategoryForType, expandSearchQuery,
  findRecipesForIngredient, getAllCategories, libDelete, libFindMatch, libLoad, libUpsert,
} from '../lib/ingredientLibrary.js'
import { analyzeMacros, categorizeIngredients, describeIngredient } from '../lib/ai.js'

const STD_PARAMS = ['fat_pct', 'water_pct', 'free_water_pct', 'sugar_pct', 'protein_pct', 'carbs_pct', 'cal_per100', 'flour_equivalent_pct']
const STD_LABELS = { fat_pct: 'Fat %', water_pct: 'Water %', free_water_pct: 'Free water %', sugar_pct: 'Sugar %', protein_pct: 'Protein %', carbs_pct: 'Carbs %', cal_per100: 'Cal/100g', flour_equivalent_pct: 'Flour equiv %' }
const BLANK_ITEM = { name: '', canonical_name: '', ingredient_type: 'other', categories: [], aliases: [], params: {}, ai_notes: '', descriptor: '', is_favorite: false }
const BATCH_SIZE = 25

function applyAiResult(item, vals) {
  const type = vals.ingredient_type || item.ingredient_type
  const seeded = defaultCategoryForType(type)
  const categories = (item.categories || []).length
    ? item.categories
    : (seeded ? [seeded] : [])
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
  function addCategory(raw) {
    const c = raw.trim().toLowerCase()
    if (!c) return
    setCategories((prev) => (prev.includes(c) ? prev : [...prev, c]))
    setInput('')
  }
  function removeCategory(c) {
    setCategories((prev) => prev.filter((x) => x !== c))
  }
  const suggestions = allCategories.filter((c) => !categories.includes(c) && (!input || c.includes(input.toLowerCase()))).slice(0, 8)
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categories (an ingredient can belong to several)</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
        {categories.map((c) => (
          <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, padding: '3px 4px 3px 10px', borderRadius: 14, background: '#EEF1F5', color: 'var(--id)', border: '1px solid #C8DFF0' }}>
            {c}
            <button onClick={() => removeCategory(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--id)', fontSize: 12, padding: '0 3px', lineHeight: 1 }}>×</button>
          </span>
        ))}
        {categories.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--muted)', fontStyle: 'italic' }}>none yet</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(input) } }}
          placeholder="Type to add or create a category…"
          style={{ flex: 1, padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12.5 }}
        />
        <button onClick={() => addCategory(input)} disabled={!input.trim()} style={{ padding: '5px 12px', borderRadius: 5, border: '1px dashed var(--id)', background: 'none', color: 'var(--id)', cursor: input.trim() ? 'pointer' : 'default', fontSize: 12, opacity: input.trim() ? 1 : 0.5 }}>+ Add</button>
      </div>
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {suggestions.map((c) => (
            <button key={c} onClick={() => addCategory(c)} style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 12, border: '1px solid var(--rule)', background: '#fff', color: 'var(--muted)', cursor: 'pointer' }}>+ {c}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function IngredientForm({ item, setItem, onSave, onCancel, saveLabel, allCategories }) {
  const [newParamKey, setNewParamKey] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [descBusy, setDescBusy] = useState(false)

  async function aiGenerateDescriptor() {
    if (!item.name.trim()) { alert('Enter a name first.'); return }
    setDescBusy(true)
    try {
      const { text } = await describeIngredient(item.name.trim(), item.ingredient_type)
      setItem((prev) => ({ ...prev, descriptor: text || prev.descriptor }))
    } catch (e) {
      alert('AI descriptor generation failed: ' + e.message)
    } finally {
      setDescBusy(false)
    }
  }
  function addCustomParam() {
    if (!newParamKey.trim()) return
    const key = newParamKey.trim().toLowerCase().split(' ').join('_')
    setItem((prev) => ({ ...prev, params: { ...prev.params, [key]: 0 } })); setNewParamKey('')
  }
  function removeCustomParam(key) { const p = { ...item.params }; delete p[key]; setItem((prev) => ({ ...prev, params: p })) }

  async function aiFillThis() {
    if (!item.name.trim()) { alert('Enter a name first.'); return }
    setAiBusy(true)
    try {
      const json = await analyzeMacros('Single ingredient lookup', [{ name: item.name.trim(), qty: 100, unit: 'g' }])
      const vals = Object.values(json.cache || {})[0]
      if (!vals) { alert('AI could not analyze this ingredient.'); return }
      setItem((prev) => applyAiResult(prev, vals))
    } catch (e) {
      alert('AI analysis failed: ' + e.message)
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div style={{ padding: 14, background: '#f5f0e8' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Name</label>
          <input autoFocus value={item.name} onChange={(e) => setItem((p) => ({ ...p, name: e.target.value }))} style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 13, boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Nutrition type <span style={{ opacity: 0.7 }}>(used for macro estimates)</span></label>
          <select value={item.ingredient_type} onChange={(e) => setItem((p) => ({ ...p, ingredient_type: e.target.value }))} style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 13 }}>
            {INGREDIENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <button onClick={onSave} style={{ padding: '5px 12px', borderRadius: 5, border: 'none', background: 'var(--id)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{saveLabel}</button>
          <button onClick={onCancel} style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'none', color: 'var(--ink)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
        </div>
      </div>
      <CategoryEditor categories={item.categories || []} setCategories={(updater) => setItem((p) => ({ ...p, categories: updater(p.categories || []) }))} allCategories={allCategories} />
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Descriptor</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={item.descriptor || ''} onChange={(e) => setItem((p) => ({ ...p, descriptor: e.target.value }))}
            placeholder="Short description — what it is, flavor, culinary role…"
            style={{ flex: 1, padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12.5 }}
          />
          <button onClick={aiGenerateDescriptor} disabled={descBusy} style={{ padding: '5px 10px', borderRadius: 5, border: 'none', background: 'linear-gradient(135deg,#4f8ef7,#7c3aed)', color: '#fff', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', cursor: descBusy ? 'default' : 'pointer', opacity: descBusy ? 0.6 : 1 }}>
            {descBusy ? '🤖 …' : '🤖 Generate'}
          </button>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <button onClick={aiFillThis} disabled={aiBusy} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg,#4f8ef7,#7c3aed)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: aiBusy ? 'default' : 'pointer', opacity: aiBusy ? 0.6 : 1 }}>
          {aiBusy ? '🤖 Analyzing…' : '🤖 AI auto-fill this ingredient'}
        </button>
        <span style={{ fontSize: 10.5, color: 'var(--muted)', marginLeft: 8 }}>Looks up branded/specific products on the web when needed</span>
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Aliases (comma-separated)</label>
        <input value={(item.aliases || []).join(', ')} onChange={(e) => setItem((p) => ({ ...p, aliases: e.target.value.split(',').map((a) => a.trim()).filter(Boolean) }))} style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12, boxSizing: 'border-box', marginBottom: 10 }} />
      </div>
      <div style={{ marginBottom: 6 }}>
        <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Parameters</label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 6, marginBottom: 10 }}>
        {STD_PARAMS.map((key) => (
          <div key={key}>
            <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block' }}>{STD_LABELS[key]}</label>
            <input type="number" step="0.1" value={item.params[key] != null ? item.params[key] : ''} onChange={(e) => setItem((p) => ({ ...p, params: { ...p.params, [key]: parseFloat(e.target.value) || 0 } }))} style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12, boxSizing: 'border-box' }} />
          </div>
        ))}
        {Object.keys(item.params).filter((k) => !STD_PARAMS.includes(k)).map((key) => (
          <div key={key}>
            <label style={{ fontSize: 10, color: '#7c3aed', display: 'block' }}>{key.replace(/_/g, ' ')}</label>
            <div style={{ display: 'flex', gap: 3 }}>
              <input type="number" step="0.01" value={item.params[key] != null ? item.params[key] : ''} onChange={(e) => setItem((p) => ({ ...p, params: { ...p.params, [key]: parseFloat(e.target.value) || 0 } }))} style={{ flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid #7c3aed', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12 }} />
              <button onClick={() => removeCustomParam(key)} style={{ padding: '0 5px', borderRadius: 4, border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}>&#x2715;</button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={newParamKey} onChange={(e) => setNewParamKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomParam() } }} placeholder="New param name..." style={{ flex: 1, padding: '4px 8px', borderRadius: 5, border: '1px dashed var(--muted)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12 }} />
        <button onClick={addCustomParam} style={{ padding: '4px 10px', borderRadius: 5, border: '1px dashed var(--muted)', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>+ Add</button>
      </div>
      {item.ai_notes && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{item.ai_notes}</div>}
    </div>
  )
}

function IngredientRow({ item, usage, expanded, selected, onToggleExpand, onToggleSelect, onEdit, onDelete, onToggleFavorite }) {
  return (
    <div style={{ border: `1px solid ${selected ? 'var(--id)' : 'var(--rule)'}`, borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => onEdit(item)}>
        <input type="checkbox" checked={!!selected} onClick={(e) => e.stopPropagation()} onChange={() => onToggleSelect(item.id)} style={{ flexShrink: 0, cursor: 'pointer' }} />
        <button onClick={(e) => { e.stopPropagation(); onToggleFavorite(item) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: '0 2px', flexShrink: 0, lineHeight: 1 }} title={item.is_favorite ? 'Remove favorite' : 'Mark favorite'}>
          {item.is_favorite ? '⭐' : '☆'}
        </button>
        <div style={{ flex: 1 }}>
          <div>
            <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14 }}>{item.name}</span>
            {item.canonical_name !== item.name && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>({item.canonical_name})</span>}
            {(item.categories || []).length > 0
              ? item.categories.map((c) => <span key={c} style={{ fontSize: 10, background: '#EEF1F5', color: 'var(--id)', borderRadius: 4, padding: '1px 6px', marginLeft: 6 }}>{c}</span>)
              : <span style={{ fontSize: 10, background: '#f5f0e8', color: 'var(--muted)', borderRadius: 4, padding: '1px 6px', marginLeft: 8 }}>{item.ingredient_type}</span>}
            {(item.aliases || []).length > 0 && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>+{item.aliases.length} aliases</span>}
          </div>
          {item.descriptor && <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', marginTop: 2 }}>{item.descriptor}</div>}
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--muted)' }}>
          {item.params.fat_pct != null && <span>Fat:{item.params.fat_pct}%</span>}
          {item.params.flour_equivalent_pct != null && <span>FlEq:{item.params.flour_equivalent_pct}%</span>}
          {item.params.free_water_pct != null && <span>FrW:{item.params.free_water_pct}%</span>}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onDelete(item.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, opacity: 0.5 }}>&#x1F5D1;</button>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleExpand(item.id) }}
        style={{ width: '100%', textAlign: 'left', padding: '5px 14px 7px', background: 'none', border: 'none', borderTop: '1px dotted var(--rule)', cursor: usage.length ? 'pointer' : 'default', fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--mono)' }}
        disabled={!usage.length}
      >
        {usage.length ? `${expanded ? '▲' : '▼'} used in ${usage.length} recipe${usage.length !== 1 ? 's' : ''}` : 'not used in any recipe'}
      </button>
      {expanded && usage.length > 0 && (
        <div style={{ padding: '2px 14px 10px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {usage.map((r) => (
            <span key={r.id} style={{ fontSize: 11, background: '#F8FBFF', border: '1px solid #C8DFF0', borderRadius: 20, padding: '2px 9px', color: 'var(--id)' }}>{r.title}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function IngredientLibraryModal({ onClose, recipes = [] }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editId, setEditId] = useState(null)
  const [editItem, setEditItem] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newItem, setNewItem] = useState(BLANK_ITEM)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [viewMode, setViewMode] = useState('list') // 'list' | 'category'
  const [expandedId, setExpandedId] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)
  const [scope, setScope] = useState('all') // 'all' | 'selected'
  const [showRecipePicker, setShowRecipePicker] = useState(false)
  const [selectedRecipeIds, setSelectedRecipeIds] = useState(new Set())
  const [selectedIngredientIds, setSelectedIngredientIds] = useState(new Set())
  const [collapsedCats, setCollapsedCats] = useState(new Set())
  const [bulkCatInput, setBulkCatInput] = useState('')
  const [showCatSuggest, setShowCatSuggest] = useState(false)
  const [catBulkBusy, setCatBulkBusy] = useState(false)

  useEffect(() => { libLoad().then((d) => { setItems(d); setLoading(false) }) }, [])

  const allCategories = useMemo(() => getAllCategories(items), [items])

  const filtered = useMemo(() => {
    const terms = expandSearchQuery(search)
    return items
      .filter((it) => {
        const nm = (it.name || '').toLowerCase()
        const cn = (it.canonical_name || '').toLowerCase()
        const aliasText = (it.aliases || []).join(' ').toLowerCase()
        const matchesSearch = !terms.length || terms.some((t) => nm.includes(t) || cn.includes(t) || aliasText.includes(t))
        const matchesCategory = !categoryFilter || (it.categories || []).includes(categoryFilter)
        return matchesSearch && matchesCategory && (!favoritesOnly || it.is_favorite)
      })
      .sort((a, b) => (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0) || a.name.localeCompare(b.name))
  }, [items, search, categoryFilter, favoritesOnly])

  // An item with multiple categories appears once under each of them (Reblochon → dairy AND cheese AND fermented).
  const groupedByCategory = useMemo(() => {
    const groups = new Map()
    for (const item of filtered) {
      const cats = (item.categories && item.categories.length) ? item.categories : ['uncategorized']
      for (const c of cats) {
        if (!groups.has(c)) groups.set(c, [])
        groups.get(c).push(item)
      }
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const usageMap = useMemo(() => {
    const map = new Map()
    for (const item of items) map.set(item.id, findRecipesForIngredient(item, recipes))
    return map
  }, [items, recipes])

  const categoryCounts = useMemo(() => {
    const counts = new Map()
    for (const it of items) for (const c of it.categories || []) counts.set(c, (counts.get(c) || 0) + 1)
    return counts
  }, [items])

  const bulkCatSuggestions = useMemo(() => {
    const q = bulkCatInput.trim().toLowerCase()
    return allCategories.filter((c) => !q || c.includes(q)).slice(0, 30)
  }, [allCategories, bulkCatInput])

  const scopedRecipes = useMemo(
    () => (scope === 'selected' ? recipes.filter((r) => selectedRecipeIds.has(r.id)) : recipes),
    [scope, recipes, selectedRecipeIds],
  )

  const scopedMissingNames = useMemo(() => {
    const names = collectAllIngredientNames(scopedRecipes)
    return names.filter((n) => !libFindMatch(n, items))
  }, [scopedRecipes, items])

  // "todo o lo que seleccione": operates on the checked ingredients, or on every currently
  // filtered/visible ingredient when nothing is checked.
  const categorizeTargets = selectedIngredientIds.size ? filtered.filter((i) => selectedIngredientIds.has(i.id)) : filtered

  function toggleSelectIngredient(id) {
    setSelectedIngredientIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAllFiltered() { setSelectedIngredientIds(new Set(filtered.map((i) => i.id))) }
  function clearIngredientSelection() { setSelectedIngredientIds(new Set()) }

  function toggleCollapsedCategory(cat) {
    setCollapsedCats((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  async function applyCategoryToTargets(raw) {
    const c = raw.trim().toLowerCase()
    if (!c || !categorizeTargets.length) return
    setCatBulkBusy(true)
    for (const item of categorizeTargets) {
      if ((item.categories || []).includes(c)) continue
      await libUpsert({ ...item, categories: [...(item.categories || []), c] })
    }
    const fresh = await libLoad()
    setItems(fresh)
    setCatBulkBusy(false)
    setBulkCatInput('')
  }

  // Lets the AI decide categories for the target ingredients (batched), merging into whatever
  // categories each ingredient already has rather than overwriting them.
  async function aiCategorizeTargets() {
    const targets = categorizeTargets
    if (!targets.length) return
    setCatBulkBusy(true)
    setBulkProgress({ done: 0, total: targets.length })
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE)
      try {
        const json = await categorizeIngredients(
          batch.map((it) => ({ name: it.name, ingredient_type: it.ingredient_type })),
          allCategories,
        )
        for (const [name, cats] of Object.entries(json.categories || {})) {
          if (!Array.isArray(cats) || !cats.length) continue
          const match = batch.find((it) => it.name === name) || batch.find((it) => it.name.toLowerCase() === name.toLowerCase())
          if (!match) continue
          const merged = Array.from(new Set([...(match.categories || []), ...cats.map((c) => String(c).toLowerCase())]))
          await libUpsert({ ...match, categories: merged })
        }
      } catch (e) {
        console.error('AI categorize batch failed:', e)
      }
      setBulkProgress({ done: Math.min(targets.length, i + BATCH_SIZE), total: targets.length })
    }
    const fresh = await libLoad()
    setItems(fresh)
    setCatBulkBusy(false)
    setBulkProgress(null)
  }

  function startEdit(item) { setCreating(false); setEditId(item.id); setEditItem({ ...item, categories: [...(item.categories || [])], params: { ...item.params }, aliases: [...(item.aliases || [])] }) }
  function cancelEdit() { setEditId(null); setEditItem(null) }
  async function saveEdit() {
    await libUpsert(editItem)
    const fresh = await libLoad()
    setItems(fresh); setEditId(null); setEditItem(null)
  }

  function startCreate() { setEditId(null); setNewItem(BLANK_ITEM); setCreating(true) }
  async function saveCreate() {
    if (!newItem.name.trim()) { alert('Name is required.'); return }
    await libUpsert({ ...newItem, canonical_name: newItem.canonical_name.trim() || newItem.name.trim() })
    const fresh = await libLoad()
    setItems(fresh); setCreating(false)
  }

  async function deleteItem(id) {
    if (!window.confirm('Delete this ingredient?')) return
    await libDelete(id); setItems(items.filter((i) => i.id !== id))
    setSelectedIngredientIds((prev) => { const next = new Set(prev); next.delete(id); return next })
  }

  async function toggleFavorite(item) {
    const updated = { ...item, is_favorite: !item.is_favorite }
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
    await libUpsert(updated)
  }

  function toggleSelectedRecipe(id) {
    setSelectedRecipeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Registers every ingredient name from the current scope as a library row (blank params, no AI call).
  async function addScopedIngredients() {
    if (!scopedMissingNames.length) { alert('Nothing new to add for this scope.'); return }
    if (!window.confirm(`Add ${scopedMissingNames.length} ingredient${scopedMissingNames.length !== 1 ? 's' : ''} to the library?`)) return
    setBulkBusy(true)
    for (const name of scopedMissingNames) {
      await libUpsert({ name, canonical_name: name, ingredient_type: 'other', categories: [], aliases: [], params: {}, ai_notes: '', source: 'manual' })
    }
    const fresh = await libLoad()
    setItems(fresh)
    setBulkBusy(false)
  }

  // Fills macro params (via AI, with web search for branded products) for the current scope's ingredients.
  async function analyzeScopedIngredients() {
    if (!scopedMissingNames.length) { alert('Every ingredient in this scope is already in the library.'); return }
    setBulkBusy(true)
    setBulkProgress({ done: 0, total: scopedMissingNames.length })
    for (let i = 0; i < scopedMissingNames.length; i += BATCH_SIZE) {
      const batch = scopedMissingNames.slice(i, i + BATCH_SIZE).map((name) => ({ name, qty: 100, unit: 'g' }))
      try {
        const json = await analyzeMacros('Ingredient Library — bulk analysis', batch)
        for (const [ingName, vals] of Object.entries(json.cache || {})) {
          await libUpsert({ ...applyAiResult({ name: ingName, canonical_name: ingName, ingredient_type: 'other', categories: [], aliases: [] }, vals), source: 'AI' })
        }
      } catch (e) {
        console.error('Bulk ingredient analysis batch failed:', e)
      }
      setBulkProgress({ done: Math.min(scopedMissingNames.length, i + BATCH_SIZE), total: scopedMissingNames.length })
    }
    const fresh = await libLoad()
    setItems(fresh)
    setBulkBusy(false)
    setBulkProgress(null)
  }

  const rowProps = { expandedId, onToggleExpand: (id) => setExpandedId((p) => (p === id ? null : id)), onToggleSelect: toggleSelectIngredient, onEdit: startEdit, onDelete: deleteItem, onToggleFavorite: toggleFavorite }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--paper)', borderRadius: 12, width: 'min(900px,96vw)', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid var(--rule)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>📦</span>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>Ingredient Library</h2>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>AI-powered · {items.length} ingredients</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>&#x2715;</button>
        </div>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--rule)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ingredients..." style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--rule)', background: '#fff', color: 'var(--ink)', fontSize: 13 }} />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--rule)', background: '#fff', color: 'var(--ink)', fontSize: 13 }}>
            <option value="">All categories</option>
            {allCategories.map((c) => <option key={c} value={c}>{c}{categoryCounts.get(c) ? ` (${categoryCounts.get(c)})` : ''}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer', color: 'var(--ink)' }}>
            <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} /> ⭐ Favorites only
          </label>
          <div style={{ display: 'flex', border: '1px solid var(--rule)', borderRadius: 6, overflow: 'hidden' }}>
            <button onClick={() => setViewMode('list')} style={{ padding: '5px 10px', fontSize: 12, border: 'none', cursor: 'pointer', background: viewMode === 'list' ? 'var(--id)' : '#fff', color: viewMode === 'list' ? '#fff' : 'var(--muted)' }}>List</button>
            <button onClick={() => setViewMode('category')} style={{ padding: '5px 10px', fontSize: 12, border: 'none', cursor: 'pointer', background: viewMode === 'category' ? 'var(--id)' : '#fff', color: viewMode === 'category' ? '#fff' : 'var(--muted)' }}>By category</button>
          </div>
          <button onClick={startCreate} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--id)', background: 'none', color: 'var(--id)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Add ingredient</button>
        </div>

        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--rule)', background: '#f8f5ee' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--muted)' }}>Scope:</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer' }}>
              <input type="radio" checked={scope === 'all'} onChange={() => { setScope('all'); setShowRecipePicker(false) }} /> Whole app ({recipes.length} recipes)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer' }}>
              <input type="radio" checked={scope === 'selected'} onChange={() => { setScope('selected'); setShowRecipePicker(true) }} /> Selected recipes ({selectedRecipeIds.size})
            </label>
            {scope === 'selected' && (
              <button onClick={() => setShowRecipePicker((p) => !p)} style={{ fontSize: 11.5, padding: '3px 9px', borderRadius: 14, border: '1px solid var(--rule)', background: '#fff', color: 'var(--muted)', cursor: 'pointer' }}>
                {showRecipePicker ? 'Hide list' : 'Choose recipes…'}
              </button>
            )}
          </div>
          {scope === 'selected' && showRecipePicker && (
            <div style={{ maxHeight: 140, overflow: 'auto', display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8, padding: 8, background: '#fff', border: '1px solid var(--rule)', borderRadius: 7 }}>
              {recipes.map((r) => (
                <button key={r.id} onClick={() => toggleSelectedRecipe(r.id)}
                  style={{
                    fontSize: 11.5, padding: '3px 10px', borderRadius: 14, cursor: 'pointer',
                    border: `1.5px solid ${selectedRecipeIds.has(r.id) ? 'var(--id)' : 'var(--rule)'}`,
                    background: selectedRecipeIds.has(r.id) ? '#EEF1F5' : '#fff',
                    color: selectedRecipeIds.has(r.id) ? 'var(--id)' : 'var(--muted)',
                  }}>
                  {r.title}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={addScopedIngredients} disabled={bulkBusy || !scopedMissingNames.length}
              title="Register missing ingredient names in the library without calling the AI"
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--rule)', background: '#fff', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, cursor: bulkBusy || !scopedMissingNames.length ? 'default' : 'pointer', opacity: bulkBusy || !scopedMissingNames.length ? 0.5 : 1 }}>
              + Add {scopedMissingNames.length || ''} ingredient{scopedMissingNames.length !== 1 ? 's' : ''} to library
            </button>
            <button onClick={analyzeScopedIngredients} disabled={bulkBusy || !scopedMissingNames.length}
              title="Fill macro parameters via AI (searches the web for branded/specific products)"
              style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg,#4f8ef7,#7c3aed)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: bulkBusy || !scopedMissingNames.length ? 'default' : 'pointer', opacity: bulkBusy || !scopedMissingNames.length ? 0.6 : 1 }}>
              {bulkBusy && bulkProgress ? `🤖 Analyzing ${bulkProgress.done}/${bulkProgress.total}…` : `🤖 Analyze macros (${scopedMissingNames.length})`}
            </button>
          </div>
        </div>

        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--rule)', background: '#f4f0ea', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--muted)' }}>Categorize:</span>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {selectedIngredientIds.size ? `${selectedIngredientIds.size} selected` : `all ${filtered.length} shown`}
          </span>
          <button onClick={selectAllFiltered} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, border: '1px solid var(--rule)', background: '#fff', color: 'var(--muted)', cursor: 'pointer' }}>Select all shown</button>
          {selectedIngredientIds.size > 0 && (
            <button onClick={clearIngredientSelection} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, border: '1px solid var(--rule)', background: '#fff', color: 'var(--muted)', cursor: 'pointer' }}>Clear selection</button>
          )}
          {/* Own dropdown instead of <datalist>: the native popup is positioned by the browser
              and escapes the modal, rendering against the far edge of the window. */}
          <div style={{ position: 'relative' }}>
            <input
              value={bulkCatInput}
              onChange={(e) => { setBulkCatInput(e.target.value); setShowCatSuggest(true) }}
              onFocus={() => setShowCatSuggest(true)}
              onBlur={() => setTimeout(() => setShowCatSuggest(false), 120)} // let a click on a suggestion land first
              onKeyDown={(e) => {
                if (e.key === 'Enter' && bulkCatInput.trim()) { setShowCatSuggest(false); applyCategoryToTargets(bulkCatInput) }
                if (e.key === 'Escape') setShowCatSuggest(false)
              }}
              placeholder="category to apply…"
              style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: '#fff', color: 'var(--ink)', fontSize: 12, width: 160, boxSizing: 'border-box' }}
            />
            {showCatSuggest && bulkCatSuggestions.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 3, width: 160, maxHeight: 190, overflowY: 'auto', background: '#fff', border: '1px solid var(--rule)', borderRadius: 6, boxShadow: '0 6px 18px rgba(0,0,0,.13)', zIndex: 20 }}>
                {bulkCatSuggestions.map((c) => (
                  <button
                    key={c}
                    onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur doesn't beat the click
                    onClick={() => { setBulkCatInput(c); setShowCatSuggest(false) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 9px', background: 'none', border: 'none', borderBottom: '1px solid #f0ece4', cursor: 'pointer', fontSize: 12, color: 'var(--ink)' }}
                  >
                    {c}{categoryCounts.get(c) ? <span style={{ color: 'var(--muted)', fontSize: 10.5 }}> ({categoryCounts.get(c)})</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => applyCategoryToTargets(bulkCatInput)} disabled={catBulkBusy || !bulkCatInput.trim() || !categorizeTargets.length}
            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--rule)', background: '#fff', color: 'var(--ink)', fontSize: 12, fontWeight: 600, cursor: catBulkBusy || !bulkCatInput.trim() ? 'default' : 'pointer', opacity: catBulkBusy || !bulkCatInput.trim() ? 0.5 : 1 }}>
            + Apply to {categorizeTargets.length}
          </button>
          <button onClick={aiCategorizeTargets} disabled={catBulkBusy || !categorizeTargets.length}
            title="Let AI assign categories to the target ingredients"
            style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg,#4f8ef7,#7c3aed)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: catBulkBusy || !categorizeTargets.length ? 'default' : 'pointer', opacity: catBulkBusy || !categorizeTargets.length ? 0.6 : 1 }}>
            {catBulkBusy && bulkProgress ? `🤖 ${bulkProgress.done}/${bulkProgress.total}…` : `🤖 AI-categorize ${categorizeTargets.length}`}
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          {creating && (
            <div style={{ border: '1px solid var(--id)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
              <IngredientForm item={newItem} setItem={setNewItem} onSave={saveCreate} onCancel={() => setCreating(false)} saveLabel="Create" allCategories={allCategories} />
            </div>
          )}
          {loading && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 32 }}>Loading...</div>}
          {!loading && filtered.length === 0 && !creating && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 32 }}>No ingredients found.</div>}

          {viewMode === 'list' && filtered.map((item) => (
            editId === item.id ? (
              <div key={item.id} style={{ border: '1px solid var(--rule)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
                <IngredientForm item={editItem} setItem={setEditItem} onSave={saveEdit} onCancel={cancelEdit} saveLabel="Save" allCategories={allCategories} />
              </div>
            ) : (
              <IngredientRow key={item.id} item={item} usage={usageMap.get(item.id) || []} expanded={expandedId === item.id} selected={selectedIngredientIds.has(item.id)} {...rowProps} />
            )
          ))}

          {viewMode === 'category' && groupedByCategory.map(([cat, groupItems]) => {
            const isCollapsed = collapsedCats.has(cat)
            return (
              <div key={cat} style={{ marginBottom: 16 }}>
                <button
                  onClick={() => toggleCollapsedCategory(cat)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--id)', marginBottom: 7, paddingBottom: 4, borderBottom: '1px solid var(--rule)' }}
                >
                  <span style={{ fontSize: 9, width: 10, display: 'inline-block' }}>{isCollapsed ? '▸' : '▾'}</span>
                  {cat} <span style={{ color: 'var(--muted)' }}>({groupItems.length})</span>
                </button>
                {!isCollapsed && groupItems.map((item) => (
                  editId === item.id ? (
                    <div key={item.id} style={{ border: '1px solid var(--rule)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
                      <IngredientForm item={editItem} setItem={setEditItem} onSave={saveEdit} onCancel={cancelEdit} saveLabel="Save" allCategories={allCategories} />
                    </div>
                  ) : (
                    <IngredientRow key={item.id} item={item} usage={usageMap.get(item.id) || []} expanded={expandedId === item.id} selected={selectedIngredientIds.has(item.id)} {...rowProps} />
                  )
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
