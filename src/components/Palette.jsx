import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzySearch } from '../lib/vault.js'
import { statusOf } from '../lib/status.js'

// Renders the target string with the fuzzy-matched characters emphasised, the way
// Obsidian's switcher shows you *why* a result matched.
function FuzzyLabel({ text, positions }) {
  if (!positions || !positions.length) return <>{text}</>
  const set = new Set(positions)
  return (
    <>
      {[...text].map((ch, i) => (set.has(i) ? <b key={i} className="V-fz">{ch}</b> : <span key={i}>{ch}</span>))}
    </>
  )
}

/**
 * One modal used for both the quick switcher (jump to a recipe) and the command palette
 * (run an action) — they differ only in what they list and what Enter does.
 */
export default function Palette({ mode, recipes, commands, onClose, onOpenRecipe, onRunCommand }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setActive(0) }, [query, mode])

  const results = useMemo(() => {
    if (mode === 'command') return fuzzySearch(query, commands, (c) => c.title, 60)
    return fuzzySearch(query, recipes, (r) => r.title || 'Untitled', 60)
  }, [mode, query, recipes, commands])

  // Keep the highlighted row inside the scroll viewport as the user arrows through.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="1"]')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  function choose(i) {
    const hit = results[i]
    if (!hit) return
    if (mode === 'command') onRunCommand(hit.item)
    else onOpenRecipe(hit.item.id)
    onClose()
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div className="V-palette-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="V-palette">
        <input
          ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
          placeholder={mode === 'command' ? 'Type a command…' : 'Jump to a recipe…'}
          className="V-palette-input"
        />
        <div className="V-palette-list" ref={listRef}>
          {!results.length && <div className="V-palette-empty">No matches.</div>}
          {results.map((hit, i) => (
            <div
              key={mode === 'command' ? hit.item.id : hit.item.id}
              data-active={i === active ? '1' : '0'}
              className={`V-palette-row${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(i) }}
            >
              {mode === 'command' ? (
                <>
                  <span className="V-palette-icon">{hit.item.icon || '›'}</span>
                  <span className="V-palette-title"><FuzzyLabel text={hit.item.title} positions={hit.positions} /></span>
                  {hit.item.shortcut && <span className="V-palette-kbd">{hit.item.shortcut}</span>}
                </>
              ) : (
                <>
                  <span className="V-palette-icon" title={statusOf(hit.item)?.label || undefined}>{statusOf(hit.item)?.icon || '📄'}</span>
                  <span className="V-palette-title"><FuzzyLabel text={hit.item.title || 'Untitled'} positions={hit.positions} /></span>
                  <span className="V-palette-meta">{hit.item.folder || hit.item.category || ''}</span>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="V-palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
