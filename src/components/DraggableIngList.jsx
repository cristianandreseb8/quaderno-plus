import { useState } from 'react'
import { isSectionHeader } from '../lib/recipeCalc.js'

export default function DraggableIngList({ lines, onChange }) {
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)

  function move(from, to) {
    if (from === to) return
    const n = [...lines]
    const [item] = n.splice(from, 1)
    n.splice(to, 0, item)
    onChange(n)
    setDragIdx(null)
    setOverIdx(null)
  }

  return (
    <div className="Q-drag-list">
      {lines.map((line, idx) => (
        <div
          key={idx}
          className={`Q-drag-item${overIdx === idx ? ' over' : ''}${dragIdx === idx ? ' dragging' : ''}${isSectionHeader(line) ? ' is-section' : ''}`}
          draggable
          onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move' }}
          onDragOver={(e) => { e.preventDefault(); setOverIdx(idx) }}
          onDrop={() => dragIdx !== null && move(dragIdx, idx)}
          onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
        >
          <span className="Q-drag-handle">⠇</span>
          <input
            className={`Q-drag-input${isSectionHeader(line) ? ' section' : ''}`}
            value={isSectionHeader(line) ? line.replace(/^##?\s*/, '') : line}
            onChange={(e) => {
              const n = [...lines]
              n[idx] = isSectionHeader(line) ? '## ' + e.target.value : e.target.value
              onChange(n)
            }}
            placeholder={isSectionHeader(line) ? 'Section name' : '500 g  ingredient name'}
          />
          <button className="Q-drag-rm" onClick={() => onChange(lines.filter((_, i) => i !== idx))}>×</button>
        </div>
      ))}
      <div className="Q-drag-footer">
        <button
          onClick={() => onChange([...lines, ''])}
          style={{ fontSize: 11.5, background: 'none', border: '1px solid var(--rule)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', color: 'var(--muted)' }}
        >
          + Ingredient
        </button>
        <button
          onClick={() => onChange([...lines, '## '])}
          style={{ fontSize: 11.5, background: 'none', border: '1px solid var(--amber)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', color: 'var(--amber)' }}
        >
          + Section
        </button>
      </div>
    </div>
  )
}
