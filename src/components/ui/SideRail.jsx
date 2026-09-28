import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const MIN = 220
const MAX = 520
const COLLAPSE = 150 // released narrower than this, the list hides

// The line between the recipe list and the recipe. Drag it (the cursor turns into ↔) to make
// the list wider or narrower, or all the way left to hide it; drag from the left edge to bring
// it back. The button in the middle, or a double click on the line, shows or hides it too.
export default function SideRail({ open, onChange }) {
  const [dragging, setDragging] = useState(false)
  const ref = useRef(null)

  function onPointerDown(e) {
    if ((e.button !== undefined && e.button !== 0) || e.target.closest('button')) return
    e.preventDefault()
    const body = ref.current.closest('.Q-body')
    const left = body.getBoundingClientRect().left
    const before = body.style.getPropertyValue('--side-w')
    let width = null
    if (!open) onChange({ open: true })
    setDragging(true)
    document.body.classList.add('Q-resizing')
    const move = (ev) => {
      width = Math.max(0, Math.min(MAX, ev.clientX - left))
      body.style.setProperty('--side-w', `${Math.max(width, 48)}px`)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.classList.remove('Q-resizing')
      setDragging(false)
      // Hand the width back to React (settings), which sets it on the next render.
      if (before) body.style.setProperty('--side-w', before); else body.style.removeProperty('--side-w')
      if (width === null) return
      if (width < COLLAPSE) onChange({ open: false })
      else onChange({ open: true, width: Math.round(Math.max(MIN, width)) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div
      ref={ref} className={`Q-rail${dragging ? ' dragging' : ''}`} onPointerDown={onPointerDown}
      onDoubleClick={(e) => { if (!e.target.closest('button')) onChange({ open: !open }) }}
      title="Drag to resize the recipe list · double-click to hide or show it"
    >
      <button
        type="button" className="Q-rail-btn" onClick={() => onChange({ open: !open })}
        title={open ? 'Hide the recipe list (⌘\\)' : 'Show the recipe list (⌘\\)'} aria-label={open ? 'Hide the recipe list' : 'Show the recipe list'}
      >
        {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>
    </div>
  )
}
