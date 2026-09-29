import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { addExtra, buildShoppingList, formatQty, removeExtra, setQtyOverride, toggleExtra, toggleHave, updateExtra } from '../../lib/session.js'
import { translateStrings } from '../../lib/ai.js'
import { guessLang } from '../../lib/timerNames.js'
import { toast } from '../ui/Toaster.jsx'

const LANG_NAME = { 'en-US': 'English', 'es-ES': 'Spanish', 'it-IT': 'Italian', 'fr-FR': 'French', 'de-DE': 'German' }

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

  // The list speaks the recipes' language, and items typed in another one join it: "Papel de
  // horno" in an English list becomes "baking paper" (Undo keeps it as typed).
  const listLang = useMemo(() => {
    const text = session.recipes.flatMap(({ id }) => {
      const r = recipesById.get(id)
      return r ? [...(r.ingredients || []), ...(r.steps || [])] : []
    }).join(' ')
    return text.trim() ? guessLang(text) : null
  }, [session.recipes, recipesById])
  const tried = useRef(new Set())
  useEffect(() => {
    if (!listLang || !LANG_NAME[listLang]) return
    const todo = extra.filter((e) => e.lang !== listLang && !e.keep && !tried.current.has(`${e.id}|${listLang}`))
    if (!todo.length) return
    todo.forEach((e) => tried.current.add(`${e.id}|${listLang}`))
    translateStrings(todo.map((e) => e.text), LANG_NAME[listLang]).then(({ items = [] } = {}) => {
      todo.forEach((e, i) => {
        const t = String(items[i] || '').trim()
        const changed = t && t.toLowerCase() !== String(e.text).trim().toLowerCase()
        change(updateExtra(e.id, changed ? { text: t, orig: e.orig || e.text, lang: listLang } : { lang: listLang }))
        if (changed) toast(`“${e.text}” → “${t}”`, { action: { label: 'Undo', onClick: () => change(updateExtra(e.id, { text: e.text, keep: true })) } })
      })
    }).catch(() => { /* offline: it stays as typed and is tried again next time */ })
  }, [listLang, extra])

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

  // Which recipe each item is for — with each one's amount when several share it — as soon as the
  // list covers more than one recipe (a linked one, like a Flan's pâte brisée, counts as its own).
  const many = new Set(items.flatMap((it) => it.recipes)).size > 1
  const forWhat = (r) => {
    if (!many || r.kind !== 'recipe' || !r.recipes.length) return ''
    if (r.recipes.length === 1) return r.recipes[0]
    return r.recipes.map((t) => (r.by?.[t] != null ? `${t} ${formatQty(r.by[t], r.unit)}` : t)).join(' · ')
  }
  const row = (r) => {
    const computed = r.kind === 'recipe' ? formatQty(r.qty, r.unit) : ''
    const src = forWhat(r)
    return (
      <li key={r.key} className={`Q-shop-row${r.done ? ' done' : ''}`} onClick={() => toggle(r)}>
        <span className="Q-check" aria-hidden="true" />
        {r.kind === 'recipe'
          ? <QtyField value={overrides[r.key] ?? computed} computed={computed} onCommit={(t) => change(setQtyOverride(r.key, t))} />
          : <span className="Q-shop-qty static" />}
        <span className="Q-shop-name">{r.name}{src && <small className="Q-shop-src">For {src}</small>}</span>
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
