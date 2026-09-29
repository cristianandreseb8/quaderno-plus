import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { GripVertical, X } from 'lucide-react'
import { isSectionHeader } from '../lib/recipeCalc.js'

function findScroller(fromEl) {
  let el = fromEl
  while (el && el !== document.body) {
    const s = getComputedStyle(el)
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) return el
    el = el.parentElement
  }
  return null
}

// The same row editor for ingredients and for the method. Steps are long, so their rows are
// text areas that grow with the text and show the step's number.
const KINDS = {
  ingredient: { add: '+ Ingredient', placeholder: '500 g  ingredient name', section: 'Section name', multiline: false },
  step: { add: '+ Step', placeholder: 'Describe the step', section: 'Section name, e.g. Shaping', multiline: true },
}

const bare = (line) => (isSectionHeader(line) ? line.replace(/^##?\s*/, '') : line)
const withPrefix = (line, text) => (isSectionHeader(line) ? '## ' + text : text)

export default function DraggableIngList({ lines, onChange, kind = 'ingredient', spellCheck }) {
  const K = KINDS[kind] || KINDS.ingredient
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)
  const [grab, setGrab] = useState(null) // the row whose handle is held: only it can be dragged
  const listRef = useRef(null)

  // While dragging near the top/bottom edge, scroll the list's scrollable ancestor (or the page)
  // so long lists can be reordered beyond the visible viewport — critical on small phone screens.
  // Listens on document because per-item dragover stops firing once the pointer leaves the list.
  useEffect(() => {
    if (dragIdx === null) return
    const MARGIN = 90
    const STEP = 14
    const onDragOver = (e) => {
      const y = e.clientY
      if (y === 0) return
      const scroller = findScroller(listRef.current)
      if (scroller) {
        const r = scroller.getBoundingClientRect()
        if (y < Math.max(r.top, 0) + MARGIN) scroller.scrollTop -= STEP
        else if (y > Math.min(r.bottom, window.innerHeight) - MARGIN) scroller.scrollTop += STEP
      } else if (y < MARGIN) {
        window.scrollBy(0, -STEP)
      } else if (y > window.innerHeight - MARGIN) {
        window.scrollBy(0, STEP)
      }
    }
    document.addEventListener('dragover', onDragOver)
    return () => document.removeEventListener('dragover', onDragOver)
  }, [dragIdx])

  // Step rows grow with their text (also when the width changes and the text rewraps).
  useLayoutEffect(() => {
    if (!K.multiline) return undefined
    const fit = () => listRef.current?.querySelectorAll('textarea.Q-drag-input').forEach((el) => {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    })
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  })

  function move(from, to) {
    if (from === to) return
    const n = [...lines]
    const [item] = n.splice(from, 1)
    n.splice(to, 0, item)
    onChange(n)
    setDragIdx(null)
    setOverIdx(null)
  }

  // Render synchronously so focus moves before the next keystroke arrives.
  function commitAndFocus(n, idx, caret) {
    flushSync(() => onChange(n))
    const el = listRef.current?.querySelectorAll('.Q-drag-input')[idx]
    if (!el) return
    el.focus()
    if (caret != null) el.setSelectionRange(caret, caret)
  }

  function onKeyDown(e, idx) {
    if (e.nativeEvent.isComposing) return
    const line = lines[idx]
    const el = e.currentTarget
    // Enter starts the next line — splitting this one at the cursor — so a whole list can be
    // typed without the mouse. (Lines never hold line breaks.)
    if (e.key === 'Enter') {
      e.preventDefault()
      const text = bare(line)
      const at = el.selectionStart ?? text.length
      const n = [...lines]
      n[idx] = withPrefix(line, text.slice(0, at).trimEnd())
      n.splice(idx + 1, 0, text.slice(el.selectionEnd ?? at).trimStart())
      commitAndFocus(n, idx + 1, 0)
      return
    }
    // Backspace in an empty line removes it and goes back to the end of the previous one.
    if (e.key === 'Backspace' && !bare(line) && idx > 0 && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault()
      const n = lines.filter((_, i) => i !== idx)
      commitAndFocus(n, idx - 1, bare(n[idx - 1]).length)
    }
  }

  // Pasting several lines fills several rows (a whole method from a message or a website).
  function onPaste(e, idx) {
    const text = e.clipboardData?.getData('text/plain') || ''
    if (!/\r?\n/.test(text.trim())) return
    e.preventDefault()
    // The first piece joins the text before the cursor and the last the text after it, so
    // only their outer edges keep their spaces.
    const raw = text.replace(/\r/g, '').split('\n')
    const parts = raw.map((l, k) => (k === 0 ? l.trimEnd() : k === raw.length - 1 ? l.trimStart() : l.trim())).filter((l) => l.trim())
    const el = e.currentTarget
    const line = lines[idx]
    const cur = bare(line)
    const a = el.selectionStart ?? cur.length, b = el.selectionEnd ?? cur.length
    const head = cur.slice(0, a), tail = cur.slice(b)
    const rows = [...parts]
    rows[0] = head + rows[0]
    const lastLen = rows[rows.length - 1].length
    rows[rows.length - 1] += tail
    const n = [...lines]
    n.splice(idx, 1, withPrefix(line, rows[0]), ...rows.slice(1))
    commitAndFocus(n, idx + rows.length - 1, rows.length === 1 ? head.length + lastLen : lastLen)
  }

  let stepNo = 0
  return (
    <div className={`Q-drag-list${K.multiline ? ' multiline' : ''}`} ref={listRef}>
      {lines.map((line, idx) => {
        const section = isSectionHeader(line)
        if (!section && String(line).trim()) stepNo += 1
        const Field = K.multiline && !section ? 'textarea' : 'input'
        return (
          <div
            key={idx}
            className={`Q-drag-item${overIdx === idx ? ' over' : ''}${dragIdx === idx ? ' dragging' : ''}${section ? ' is-section' : ''}`}
            draggable={grab === idx}
            onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(idx) }}
            onDrop={() => dragIdx !== null && move(dragIdx, idx)}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); setGrab(null) }}
          >
            <span
              className="Q-drag-handle" aria-hidden="true"
              onPointerDown={() => setGrab(idx)} onPointerUp={() => setGrab(null)}
            >
              <GripVertical size={15} />
            </span>
            {K.multiline && !section && <span className="Q-drag-num">{String(line).trim() ? stepNo : ''}</span>}
            <Field
              className={`Q-drag-input${section ? ' section' : ''}`}
              rows={Field === 'textarea' ? 1 : undefined}
              spellCheck={spellCheck}
              value={bare(line)}
              onChange={(e) => {
                const n = [...lines]
                n[idx] = withPrefix(line, e.target.value.replace(/\r?\n/g, ' '))
                onChange(n)
              }}
              onKeyDown={(e) => onKeyDown(e, idx)}
              onPaste={(e) => onPaste(e, idx)}
              placeholder={section ? K.section : K.placeholder}
            />
            <button type="button" className="Q-drag-rm" onClick={() => onChange(lines.filter((_, i) => i !== idx))} aria-label="Remove line"><X size={14} /></button>
          </div>
        )
      })}
      <div className="Q-drag-footer">
        <button type="button" className="Q-mini-btn" onClick={() => commitAndFocus([...lines, ''], lines.length)}>{K.add}</button>
        <button type="button" className="Q-mini-btn accent" onClick={() => commitAndFocus([...lines, '## '], lines.length)}>+ Section</button>
      </div>
    </div>
  )
}
