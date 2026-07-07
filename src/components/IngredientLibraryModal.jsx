import { useEffect, useState } from 'react'
import { libDelete, libLoad, libUpsert } from '../lib/ingredientLibrary.js'

const TYPES = ['flour', 'butter', 'egg', 'egg_yolk', 'sugar', 'milk', 'cream', 'salt', 'yeast', 'sourdough', 'honey', 'oil', 'water', 'chocolate', 'other']
const STD_PARAMS = ['fat_pct', 'water_pct', 'free_water_pct', 'sugar_pct', 'protein_pct', 'carbs_pct', 'cal_per100', 'flour_equivalent_pct']
const STD_LABELS = { fat_pct: 'Fat %', water_pct: 'Water %', free_water_pct: 'Free water %', sugar_pct: 'Sugar %', protein_pct: 'Protein %', carbs_pct: 'Carbs %', cal_per100: 'Cal/100g', flour_equivalent_pct: 'Flour equiv %' }

export default function IngredientLibraryModal({ onClose }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editId, setEditId] = useState(null)
  const [editItem, setEditItem] = useState(null)
  const [newParamKey, setNewParamKey] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  useEffect(() => { libLoad().then((d) => { setItems(d); setLoading(false) }) }, [])

  const filtered = items.filter((it) => {
    const nm = (it.name || '').toLowerCase()
    const q = search.toLowerCase()
    return (!q || nm.includes(q)) && (!typeFilter || it.ingredient_type === typeFilter)
  })

  function startEdit(item) { setEditId(item.id); setEditItem({ ...item, params: { ...item.params }, aliases: [...(item.aliases || [])] }) }
  function cancelEdit() { setEditId(null); setEditItem(null) }
  async function saveEdit() {
    await libUpsert(editItem)
    const fresh = await libLoad()
    setItems(fresh); setEditId(null); setEditItem(null)
  }
  async function deleteItem(id) {
    if (!window.confirm('Delete this ingredient?')) return
    await libDelete(id); setItems(items.filter((i) => i.id !== id))
  }
  function addCustomParam() {
    if (!newParamKey.trim()) return
    const key = newParamKey.trim().toLowerCase().split(' ').join('_')
    setEditItem((prev) => ({ ...prev, params: { ...prev.params, [key]: 0 } })); setNewParamKey('')
  }
  function removeCustomParam(key) { const p = { ...editItem.params }; delete p[key]; setEditItem((prev) => ({ ...prev, params: p })) }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--paper)', borderRadius: 12, width: 'min(900px,96vw)', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid var(--rule)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>📦</span>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>Ingredient Library</h2>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>AI-powered · {items.length} ingredients</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>&#x2715;</button>
        </div>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--rule)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ingredients..." style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--rule)', background: '#fff', color: 'var(--ink)', fontSize: 13 }} />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--rule)', background: '#fff', color: 'var(--ink)', fontSize: 13 }}>
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          {loading && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 32 }}>Loading...</div>}
          {!loading && filtered.length === 0 && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 32 }}>No ingredients found.</div>}
          {filtered.map((item) => (
            <div key={item.id} style={{ border: '1px solid var(--rule)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
              {editId === item.id ? (
                <div style={{ padding: 14, background: '#f5f0e8' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 10 }}>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Name</label>
                      <input value={editItem.name} onChange={(e) => setEditItem((p) => ({ ...p, name: e.target.value }))} style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Type</label>
                      <select value={editItem.ingredient_type} onChange={(e) => setEditItem((p) => ({ ...p, ingredient_type: e.target.value }))} style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 13 }}>
                        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                      <button onClick={saveEdit} style={{ padding: '5px 12px', borderRadius: 5, border: 'none', background: 'var(--id)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Save</button>
                      <button onClick={cancelEdit} style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'none', color: 'var(--ink)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Aliases (comma-separated)</label>
                    <input value={(editItem.aliases || []).join(', ')} onChange={(e) => setEditItem((p) => ({ ...p, aliases: e.target.value.split(',').map((a) => a.trim()).filter(Boolean) }))} style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12, boxSizing: 'border-box', marginBottom: 10 }} />
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Parameters</label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 6, marginBottom: 10 }}>
                    {STD_PARAMS.map((key) => (
                      <div key={key}>
                        <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block' }}>{STD_LABELS[key]}</label>
                        <input type="number" step="0.1" value={editItem.params[key] != null ? editItem.params[key] : ''} onChange={(e) => setEditItem((p) => ({ ...p, params: { ...p.params, [key]: parseFloat(e.target.value) || 0 } }))} style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12, boxSizing: 'border-box' }} />
                      </div>
                    ))}
                    {Object.keys(editItem.params).filter((k) => !STD_PARAMS.includes(k)).map((key) => (
                      <div key={key}>
                        <label style={{ fontSize: 10, color: '#7c3aed', display: 'block' }}>{key.replace(/_/g, ' ')}</label>
                        <div style={{ display: 'flex', gap: 3 }}>
                          <input type="number" step="0.01" value={editItem.params[key] != null ? editItem.params[key] : ''} onChange={(e) => setEditItem((p) => ({ ...p, params: { ...p.params, [key]: parseFloat(e.target.value) || 0 } }))} style={{ flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid #7c3aed', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12 }} />
                          <button onClick={() => removeCustomParam(key)} style={{ padding: '0 5px', borderRadius: 4, border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}>&#x2715;</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input value={newParamKey} onChange={(e) => setNewParamKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomParam() } }} placeholder="New param name..." style={{ flex: 1, padding: '4px 8px', borderRadius: 5, border: '1px dashed var(--muted)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12 }} />
                    <button onClick={addCustomParam} style={{ padding: '4px 10px', borderRadius: 5, border: '1px dashed var(--muted)', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>+ Add</button>
                  </div>
                  {editItem.ai_notes && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{editItem.ai_notes}</div>}
                </div>
              ) : (
                <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => startEdit(item)}>
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
                  <button onClick={(e) => { e.stopPropagation(); deleteItem(item.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, opacity: 0.5 }}>&#x1F5D1;</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
