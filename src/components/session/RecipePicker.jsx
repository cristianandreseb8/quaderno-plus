import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import Modal from '../ui/Modal.jsx'

// Tick the recipes for this session; each tick adds or removes it straight away.
export default function RecipePicker({ recipes, selectedIds, onToggle, onClose }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const n = q.trim().toLowerCase()
    return recipes.filter((r) => !n || [r.title, r.category].join(' ').toLowerCase().includes(n))
  }, [recipes, q])

  return (
    <Modal
      title="Recipes for this session" onClose={onClose} width={520} className="Q-picker"
      footer={<><span className="Q-dim" style={{ marginRight: 'auto' }}>{selectedIds.size} selected</span><button className="btn primary" onClick={onClose}>Done</button></>}
    >
      <div className="Q-search" style={{ marginBottom: 10 }}>
        <Search size={15} className="Q-search-ico" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes" aria-label="Search recipes" />
      </div>
      <ul className="Q-pick-list">
        {list.map((r) => {
          const on = selectedIds.has(r.id)
          return (
            <li key={r.id} className={`Q-pick-row${on ? ' on' : ''}`} onClick={() => onToggle(r.id, !on)}>
              <span className="Q-check" aria-hidden="true" />
              <span className="Q-pick-txt"><b>{r.title}</b>{r.category && <span>{r.category}</span>}</span>
            </li>
          )
        })}
        {!list.length && <li className="Q-msg">No recipes match.</li>}
      </ul>
    </Modal>
  )
}
