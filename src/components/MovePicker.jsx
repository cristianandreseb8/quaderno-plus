import { useMemo, useState } from 'react'
import { fuzzySearch } from '../lib/vault.js'

/**
 * Destination picker for moving a recipe or a folder. Drag-and-drop covers the desktop
 * case, but this is the one that works on a phone, so it's the primary path.
 *
 * `blockedPrefix` is set when moving a folder: that folder and everything under it are
 * invalid destinations (a folder can't contain itself).
 */
export default function MovePicker({ title, subtitle, folders, currentPath, blockedPrefix, blockedPrefixes, onPick, onClose }) {
  const [query, setQuery] = useState('')

  const options = useMemo(() => {
    // A folder can never be moved into itself or its own subtree — true for a single
    // folder and for every folder in a multi-selection.
    const blocked = [blockedPrefix, ...(blockedPrefixes || [])].filter(Boolean)
    const usable = folders.filter((f) => !blocked.some((b) => f === b || f.startsWith(b + '/')))
    const rows = [{ path: '', label: 'Top level (Home)' }, ...usable.map((f) => ({ path: f, label: f }))]
    if (!query.trim()) return rows
    return fuzzySearch(query, rows, (r) => r.label, 60).map((h) => h.item)
  }, [folders, blockedPrefix, blockedPrefixes, query])

  return (
    <div className="MP-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="MP">
        <div className="MP-head">
          <div className="MP-title">{title}</div>
          {subtitle && <div className="MP-sub">{subtitle}</div>}
        </div>
        <input
          autoFocus className="MP-search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search folders…"
          onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
        />
        <div className="MP-list">
          {!options.length && <div className="MP-empty">No matching folder.</div>}
          {options.map((o) => {
            const isCurrent = o.path === currentPath
            return (
              <button
                key={o.path || '__root'} className={`MP-row${isCurrent ? ' current' : ''}`}
                disabled={isCurrent}
                onClick={() => { onPick(o.path); onClose() }}
              >
                <span className="MP-icon">{o.path ? '🗂' : '⌂'}</span>
                <span className="MP-label">{o.label}</span>
                {isCurrent && <span className="MP-here">already here</span>}
              </button>
            )
          })}
        </div>
        <div className="MP-foot">
          <button className="H-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
