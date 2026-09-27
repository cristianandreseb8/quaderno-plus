import { useRef, useState } from 'react'
import { ChevronDown, GripVertical } from 'lucide-react'
import { normalizeBlocks, useSettings } from '../../lib/settings.js'

// The boxes of a recipe page (ingredients, method, video…). Each one folds to its title, and
// can be dragged by its handle to another place — or, side by side, to the other column.
// The arrangement is a personal preference saved with the settings, so every recipe opens
// the same way. Pointer events (not HTML drag-and-drop) so it also works with a finger.
export default function Blocks({ blocks, split = false }) {
  const { settings, update } = useSettings()
  const saved = normalizeBlocks(settings.blocks)
  const [live, setLive] = useState(null) // layout while a drag is in progress
  const [dragId, setDragId] = useState(null)
  const wrapRef = useRef(null)
  const layout = live || saved
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const shown = layout.order.filter((id) => byId.has(id))

  const toggle = (id) => update({ blocks: { ...saved, collapsed: { ...saved.collapsed, [id]: !saved.collapsed[id] } } })

  // Listeners live on the window: reordering moves the dragged box in the DOM, which drops
  // pointer capture on its handle, so the handle itself would never hear the release.
  const dragRef = useRef(null)
  function onDown(e, id) {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    dragRef.current = { id, live: saved }
    setDragId(id); setLive(saved)
    const move = (ev) => onMove(ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const d = dragRef.current
      dragRef.current = null
      if (d) update({ blocks: d.live })
      setDragId(null); setLive(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  function onMove(e) {
    const d = dragRef.current
    if (!d) return
    const wrap = wrapRef.current
    if (!wrap) return
    const x = e.clientX, y = e.clientY
    // Nudge the page when the pointer nears the top or bottom edge.
    const scroller = wrap.closest('.Q-main')
    if (scroller) {
      const r = scroller.getBoundingClientRect()
      if (y < r.top + 70) scroller.scrollTop -= 14
      else if (y > r.bottom - 70) scroller.scrollTop += 14
    }
    let col = d.live.col[d.id]
    if (split) {
      const L = wrap.querySelector('.Q-col.left').getBoundingClientRect()
      const R = wrap.querySelector('.Q-col.right').getBoundingClientRect()
      const sideBySide = R.left >= L.right - 1 // narrow screens stack the two columns
      col = sideBySide ? (x >= R.left - 24 ? 'right' : 'left') : (y >= R.top ? 'right' : 'left')
    }
    const others = [...wrap.querySelectorAll('.Q-block')].filter((el) => el.dataset.id !== d.id && (!split || el.dataset.col === col))
    let before = null
    for (const el of others) {
      const r = el.getBoundingClientRect()
      if (y < r.top + r.height / 2) { before = el.dataset.id; break }
    }
    const order = d.live.order.filter((id) => id !== d.id)
    let idx = order.length
    if (before) idx = order.indexOf(before)
    else if (others.length) idx = order.indexOf(others[others.length - 1].dataset.id) + 1
    order.splice(idx, 0, d.id)
    if (order.join() === d.live.order.join() && col === d.live.col[d.id]) return
    d.live = { ...d.live, order, col: { ...d.live.col, [d.id]: col } }
    setLive(d.live)
  }

  const renderBlock = (id) => {
    const b = byId.get(id)
    const collapsed = !!saved.collapsed[id] && dragId !== id
    return (
      <section key={id} data-id={id} data-col={layout.col[id]} className={`Q-block${collapsed ? ' collapsed' : ''}${dragId === id ? ' dragging' : ''}`}>
        <header className="Q-block-h">
          <span
            className="Q-grip" role="button" aria-label={`Move ${b.title}`} title="Drag to move"
            onPointerDown={(e) => onDown(e, id)}
          >
            <GripVertical size={14} />
          </span>
          <button type="button" className="Q-block-title" onClick={() => toggle(id)} aria-expanded={!collapsed}>
            {b.title}{collapsed && b.summary ? <em>{b.summary}</em> : null}
          </button>
          {!collapsed && b.actions && <span className="Q-block-actions">{b.actions}</span>}
          <button type="button" className="Q-block-fold" onClick={() => toggle(id)} aria-label={collapsed ? `Show ${b.title}` : `Minimize ${b.title}`}>
            <ChevronDown size={15} />
          </button>
        </header>
        {!collapsed && <div className="Q-block-body">{b.content}</div>}
      </section>
    )
  }

  if (!split) {
    return <div className={`Q-blocks${dragId ? ' is-dragging' : ''}`} ref={wrapRef}>{shown.map(renderBlock)}</div>
  }
  const left = shown.filter((id) => layout.col[id] !== 'right')
  const right = shown.filter((id) => layout.col[id] === 'right')
  return (
    <div className={`Q-blocks split${dragId ? ' is-dragging' : ''}`} ref={wrapRef}>
      <div className="Q-col left">{left.map(renderBlock)}{dragId && !left.length && <div className="Q-col-empty">Drop here</div>}</div>
      <div className="Q-col right">{right.map(renderBlock)}{dragId && !right.length && <div className="Q-col-empty">Drop here</div>}</div>
    </div>
  )
}
