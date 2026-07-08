import { useEffect, useMemo, useState } from 'react'
import {
  INGREDIENT_TYPES, collectAllIngredientNames, expandSearchQuery, findRecipesForIngredient, libDelete, libFindMatch, libLoad, libUpsert,
} from '../lib/ingredientLibrary.js'
import { analyzeMacros } from '../lib/ai.js'

const STD_PARAMS = ['fat_pct', 'water_pct', 'free_water_pct', 'sugar_pct', 'protein_pct', 'carbs_pct', 'cal_per100', 'flour_equivalent_pct']
const STD_LABELS = { fat_pct: 'Fat %', water_pct: 'Water %', free_water_pct: 'Free water %', sugar_pct: 'Sugar %', protein_pct: 'Protein %', carbs_pct: 'Carbs %', cal_per100: 'Cal/100g', flour_equivalent_pct: 'Flour equiv %' }
const BLANK_ITEM = { name: '', canonical_name: '', ingredient_type: 'other', aliases: [], params: {}, ai_notes: '', is_favorite: false }
const BATCH_SIZE = 25

function applyAiResult(item, vals) {
  return {
    ...item,
    ingredient_type: vals.ingredient_type || item.ingredient_type,
    params: {
      fat_pct: vals.fat_pct || 0, water_pct: vals.water_pct || 0, free_water_pct: vals.free_water_pct || 0,
      sugar_pct: vals.sugar_pct || 0, protein_pct: vals.protein_pct || 0, carbs_pct: vals.carbs_pct || 0,
      cal_per100: vals.cal_per100 || 0, flour_equivalent_pct: vals.flour_equivalent_pct || 0,
    },
    ai_notes: vals.notes || '',
  }
}

function IngredientForm({ item, setItem, onSave, onCancel, saveLabel }) {
  const [newParamKey, setNewParamKey] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
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
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Type</label>
          <select value={item.ingredient_type} onChange={(e) => setItem((p) => ({ ...p, ingredient_type: e.target.value }))} style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 13 }}>
            {INGREDIENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <button onClick={onSave} style={{ padding: '5px 12px', borderRadius: 5, border: 'none', background: 'var(--id)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{saveLabel}</button>
          <button onClick={onCancel} style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'none', color: 'var(--ink)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
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

function IngredientRow({ item, usage, expanded, onToggleExpand, onEdit, onDelete, onToggleFavorite }) {
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => onEdit(item)}>
        <button onClick={(e) => { e.stopPropagation(); onToggleFavorite(item) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: '0 2px', flexShrink: 0, lineHeight: 1 }} title={item.is_favorite ? 'Remove favorite' : 'Mark favorite'}>
          {item.is_favorite ? '⭐' : '☆'}
        </button>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14 }}>{item.name}</span>
          {item.canonical_name !== item.name && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>({item.canonical_name})</span>}
          <span style={{ fontSize: 10, background: '#f5f0e8', color: 'var(--muted)', borderRadius: 4, padding: '1px 6px', marginLeft: 8 }}>{item.ingredient_type}</span>
          {(item.aliases || []).length > 0 && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>+{item.aliases.length} aliases</span>}
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
  const [typeFilter, setTypeFilter] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [viewMode, setViewMode] = useState('list') // 'list' | 'category'
  const [expandedId, setExpandedId] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)
  const [scope, setScope] = useState('all') // 'all' | 'selected'
  const [showRecipePicker, setShowRecipePicker] = useState(false)
  const [selectedRecipeIds, setSelectedRecipeIds] = useState(new Set())

  useEffect(() => { libLoad().then((d) => { setItems(d); setLoading(false) }) }, [])

  const filtered = useMemo(() => {
    const terms = expandSearchQuery(search)
    return items
      .filter((it) => {
        const nm = (it.name || '').toLowerCase()
        const cn = (it.canonical_name || '').toLowerCase()
        const aliasText = (it.aliases || []).join(' ').toLowerCase()
        const matchesSearch = !terms.length || terms.some((t) => nm.includes(t) || cn.includes(t) || aliasText.includes(t))
        return matchesSearch && (!typeFilter || it.ingredient_type === typeFilter) && (!favoritesOnly || it.is_favorite)
      })
      .sort((a, b) => (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0) || a.name.localeCompare(b.name))
  }, [items, search, typeFilter, favoritesOnly])

  const groupedByType = useMemo(() => {
    const groups = new Map()
    for (const item of filtered) {
      const key = item.ingredient_type || 'other'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const usageMap = useMemo(() => {
    const map = new Map()
    for (const item of items) map.set(item.id, findRecipesForIngredient(item, recipes))
    return map
  }, [items, recipes])

  const typeCounts = useMemo(() => {
    const counts = new Map()
    for (const it of items) counts.set(it.ingredient_type, (counts.get(it.ingredient_type) || 0) + 1)
    return counts
  }, [items])

  const scopedRecipes = useMemo(
    () => (scope === 'selected' ? recipes.filter((r) => selectedRecipeIds.has(r.id)) : recipes),
    [scope, recipes, selectedRecipeIds],
  )

  const scopedMissingNames = useMemo(() => {
    const names = collectAllIngredientNames(scopedRecipes)
    return names.filter((n) => !libFindMatch(n, items))
  }, [scopedRecipes, items])

  function startEdit(item) { setCreating(false); setEditId(item.id); setEditItem({ ...item, params: { ...item.params }, aliases: [...(item.aliases || [])] }) }
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
      await libUpsert({ name, canonical_name: name, ingredient_type: 'other', aliases: [], params: {}, ai_notes: '', source: 'manual' })
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
          await libUpsert({ ...applyAiResult({ name: ingName, canonical_name: ingName, ingredient_type: 'other', aliases: [] }, vals), source: 'AI' })
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

  const rowProps = { expandedId, onToggleExpand: (id) => setExpandedId((p) => (p === id ? null : id)), onEdit: startEdit, onDelete: deleteItem, onToggleFavorite: toggleFavorite }

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
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--rule)', background: '#fff', color: 'var(--ink)', fontSize: 13 }}>
            <option value="">All types</option>
            {INGREDIENT_TYPES.map((t) => <option key={t} value={t}>{t}{typeCounts.get(t) ? ` (${typeCounts.get(t)})` : ''}</option>)}
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

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          {creating && (
            <div style={{ border: '1px solid var(--id)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
              <IngredientForm item={newItem} setItem={setNewItem} onSave={saveCreate} onCancel={() => setCreating(false)} saveLabel="Create" />
            </div>
          )}
          {loading && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 32 }}>Loading...</div>}
          {!loading && filtered.length === 0 && !creating && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 32 }}>No ingredients found.</div>}

          {viewMode === 'list' && filtered.map((item) => (
            editId === item.id ? (
              <div key={item.id} style={{ border: '1px solid var(--rule)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
                <IngredientForm item={editItem} setItem={setEditItem} onSave={saveEdit} onCancel={cancelEdit} saveLabel="Save" />
              </div>
            ) : (
              <IngredientRow key={item.id} item={item} usage={usageMap.get(item.id) || []} expanded={expandedId === item.id} {...rowProps} />
            )
          ))}

          {viewMode === 'category' && groupedByType.map(([type, groupItems]) => (
            <div key={type} style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--id)', marginBottom: 7, paddingBottom: 4, borderBottom: '1px solid var(--rule)' }}>
                {type} <span style={{ color: 'var(--muted)' }}>({groupItems.length})</span>
              </div>
              {groupItems.map((item) => (
                editId === item.id ? (
                  <div key={item.id} style={{ border: '1px solid var(--rule)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
                    <IngredientForm item={editItem} setItem={setEditItem} onSave={saveEdit} onCancel={cancelEdit} saveLabel="Save" />
                  </div>
                ) : (
                  <IngredientRow key={item.id} item={item} usage={usageMap.get(item.id) || []} expanded={expandedId === item.id} {...rowProps} />
                )
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
