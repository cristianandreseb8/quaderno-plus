import { useEffect, useRef, useState } from 'react'
import { STATUSES, statusOf } from '../lib/status.js'

/** Read-only marker used in lists, cards and the switcher. Renders nothing when unset. */
export function StatusBadge({ recipe, size = 'sm' }) {
  const s = statusOf(recipe)
  if (!s) return null
  return (
    <span
      className={`ST-badge ST-${size}`}
      style={{ color: s.color, background: s.bg, borderColor: s.border }}
      title={s.label}
    >
      <span className="ST-icon">{s.icon}</span>
      {size !== 'sm' && <span className="ST-text">{s.short}</span>}
    </span>
  )
}

/** Compact icon-only marker for tight rows (sidebar, palette). */
export function StatusDot({ recipe }) {
  const s = statusOf(recipe)
  if (!s) return null
  return <span className="ST-dot" title={s.label}>{s.icon}</span>
}

/** Editable control on the recipe itself. */
export function StatusPicker({ recipe, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = statusOf(recipe)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function pick(key) {
    setOpen(false)
    if ((recipe.status || '') !== key) onChange({ ...recipe, status: key })
  }

  return (
    <span className="ST-picker" ref={ref}>
      <button
        className="ST-picker-btn"
        style={current ? { color: current.color, background: current.bg, borderColor: current.border } : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? <>{current.icon} {current.short}</> : <span className="ST-none">Set status</span>}
        <span className="V-caret">▾</span>
      </button>
      {open && (
        <span className="ST-menu">
          {STATUSES.map((s) => (
            <button key={s.key} onClick={() => pick(s.key)} className={current?.key === s.key ? 'active' : ''}>
              <span>{s.icon}</span> {s.label}
            </button>
          ))}
          {current && <button className="ST-clear" onClick={() => pick('')}>✕ Clear status</button>}
        </span>
      )}
    </span>
  )
}
