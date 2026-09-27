import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { addExtra, buildShoppingList, formatQty, removeExtra, setQtyOverride, shortTitle, toggleExtra, toggleHave } from '../../lib/session.js'
import { toast } from '../ui/Toaster.jsx'

function QtyField({ value, computed, onCommit }) {
  const [text, setText] = useState(value)
  useEffect(() => { setText(value) }, [value])
  const commit = () => { if (text !== value) onCommit(text.trim() === computed ? '' : text.trim()) }
  return (
    <input
      className="Q-shop-qty" value={text} placeholder="—" aria-label="Quantity"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(value); e.currentTarget.blur() } }}
    />
  )
}

export default function ShoppingList({ session, recipesById, change }) {
  const [hideReady, setHideReady] = useState(() => localStorage.getItem('qdplus_hide_ready') === '1')
  const [newItem, setNewItem] = useState('')
  // Items ticked while the list is on screen stay where they are, so the next row never slides
  // under your finger; they join "Ready" the next time the list opens.
  const [stay, setStay] = useState(() => new Set())
  const items = useMemo(() => buildShoppingList(session.recipes, recipesById), [session.recipes, recipesById])
  const { have, qty: overrides, extra } = session.shopping

  const rows = [
    ...items.map((it) => ({ ...it, kind: 'recipe', done: !!have[it.key] })),
    ...extra.map((e) => ({ key: 'x:' + e.id, id: e.id, name: e.text, kind: 'extra', done: e.have, recipes: [] })),
  ]
  const open = rows.filter((r) => !r.done || stay.has(r.key))
  const ready = rows.filter((r) => r.done && !stay.has(r.key))
  const readyCount = rows.filter((r) => r.done).length

  function toggleHideReady() {
    setHideReady((v) => { try { localStorage.setItem('qdplus_hide_ready', v ? '0' : '1') } catch (_) { /* ignore */ } return !v })
  }
  function toggle(row) {
    if (!row.done) setStay((p) => new Set(p).add(row.key))
    change(row.kind === 'extra' ? toggleExtra(row.id) : toggleHave(row))
  }
  function add() {
    const t = newItem.trim()
    if (!t) return
    change(addExtra(t)); setNewItem('')
  }
  async function copyList() {
    const text = open.filter((r) => !r.done).map((r) => {
      const q = r.kind === 'recipe' ? (overrides[r.key] ?? formatQty(r.qty, r.unit)) : ''
      return `${q ? q + ' ' : ''}${r.name}`
    }).join('\n')
    try { await navigator.clipboard.writeText(text); toast.success('Shopping list copied') } catch (_) { toast.error('Could not copy') }
  }

  const row = (r) => {
    const computed = r.kind === 'recipe' ? formatQty(r.qty, r.unit) : ''
    return (
      <li key={r.key} className={`Q-shop-row${r.done ? ' done' : ''}`} onClick={() => toggle(r)}>
        <span className="Q-check" aria-hidden="true" />
        {r.kind === 'recipe'
          ? <QtyField value={overrides[r.key] ?? computed} computed={computed} onCommit={(t) => change(setQtyOverride(r.key, t))} />
          : <span className="Q-shop-qty static" />}
        <span className="Q-shop-name">{r.name}</span>
        {r.recipes.length > 1 && <span className="Q-shop-src" title={r.recipes.join(', ')}>{r.recipes.map(shortTitle).join(' + ')}</span>}
        {r.kind === 'extra' && (
          <button className="Q-shop-rm" onClick={(e) => { e.stopPropagation(); change(removeExtra(r.id)) }} aria-label="Remove item"><X size={14} /></button>
        )}
      </li>
    )
  }

  return (
    <div className="Q-shop">
      <div className="Q-sess-head">
        <div>
          <h1>Shopping list</h1>
          <p>{rows.length ? `${readyCount} of ${rows.length} ready` : 'Nothing to get yet'}{session.recipes.length ? ` · ${session.recipes.length} recipe${session.recipes.length === 1 ? '' : 's'}` : ''}</p>
        </div>
        <div className="Q-textbtns">
          {readyCount < rows.length && <button onClick={copyList}>Copy</button>}
          {ready.length > 0 && <button onClick={toggleHideReady}>{hideReady ? 'Show ready' : 'Hide ready'}</button>}
        </div>
      </div>
      {rows.length > 0 && <div className="Q-meter"><i style={{ width: `${(readyCount / rows.length) * 100}%` }} /></div>}

      <ul className="Q-shop-list">{open.map(row)}</ul>
      <div className="Q-shop-add">
        <input value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} placeholder="Add an item…" aria-label="Add an item" />
      </div>

      {ready.length > 0 && !hideReady && (
        <>
          <div className="Q-shop-label">Ready</div>
          <ul className="Q-shop-list">{ready.map(row)}</ul>
        </>
      )}
    </div>
  )
}
