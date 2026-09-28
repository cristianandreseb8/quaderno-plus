import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

const MenuCtx = createContext({ close: () => {} })
const GAP = 6
const EDGE = 8

// Anchored dropdown. The panel floats in a portal with fixed coordinates taken from the
// trigger, so it always opens right under its own button and is never clipped by a
// scrolling toolbar, a drawer or a modal.
export default function Menu({ trigger, children, align = 'end', width = 220, className = '' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const panelRef = useRef(null)

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    const w = Math.min(width, vw - EDGE * 2)
    let left = align === 'start' ? r.left : r.right - w
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE))
    const below = vh - r.bottom - GAP - EDGE
    const above = r.top - GAP - EDGE
    const up = below < 240 && above > below
    setPos({ left, width: w, ...(up ? { bottom: vh - r.top + GAP, maxHeight: above } : { top: r.bottom + GAP, maxHeight: below }) })
  }, [open, align, width])

  useEffect(() => {
    if (!open) return undefined
    const inside = (t) => (ref.current && ref.current.contains(t)) || (panelRef.current && panelRef.current.contains(t))
    const onDown = (e) => { if (!inside(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = (e) => { if (!panelRef.current || !panelRef.current.contains(e.target)) setOpen(false) }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const toggle = () => setOpen((p) => { if (p) setPos(null); return !p })
  const host = ref.current?.closest('.Q') || document.body

  return (
    <div className={`Q-menu-wrap ${className}`} ref={ref}>
      {trigger({ open, toggle, 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && pos && createPortal(
        <MenuCtx.Provider value={{ close: () => { setOpen(false); setPos(null) } }}>
          <div className="Q-menu" role="menu" ref={panelRef} style={pos}>
            {children}
          </div>
        </MenuCtx.Provider>,
        host,
      )}
    </div>
  )
}

// For custom content inside a menu (buttons, a small form) that should close it when used.
export const useMenuClose = () => useContext(MenuCtx).close

export function MenuItem({ icon: Icon, children, hint, onClick, danger, checked, disabled, keepOpen }) {
  const { close } = useContext(MenuCtx)
  return (
    <button
      role="menuitem" type="button" disabled={disabled}
      className={`Q-menu-item${danger ? ' danger' : ''}`}
      onClick={() => { if (!keepOpen) close(); onClick?.() }}
    >
      {(Icon || checked !== undefined) && <span className="Q-menu-ico">{checked ? <Check size={15} /> : Icon ? <Icon size={15} /> : null}</span>}
      <span className="Q-menu-txt">{children}</span>
      {hint && <span className="Q-menu-hint">{hint}</span>}
    </button>
  )
}

export function MenuLabel({ children }) {
  return <div className="Q-menu-label">{children}</div>
}

export function MenuSep() {
  return <div className="Q-menu-sep" />
}

export function MenuToggle({ checked, onChange, children }) {
  return (
    <label className="Q-menu-item Q-menu-toggle">
      <span className="Q-menu-ico"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /></span>
      <span className="Q-menu-txt">{children}</span>
    </label>
  )
}
