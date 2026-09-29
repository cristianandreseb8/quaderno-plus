import { useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, Search } from 'lucide-react'
import Modal from './ui/Modal.jsx'
import { fmtQty, getTotalGrams, linkToken } from '../lib/recipeCalc.js'

// Use another recipe inside this one — a Pâte brisée in a Flan. In the ingredients it asks how
// much (grams of it, or batches); in the method it marks where that recipe's steps go.
export default function LinkRecipeModal({ where, library, selfId, onPick, onClose }) {
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState(null)
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState('g')
  const list = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (library || [])
      .filter((r) => r.id !== selfId && (!n || [r.title, r.category].join(' ').toLowerCase().includes(n)))
      .sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }))
  }, [library, q, selfId])

  function choose(r) {
    if (where === 'step') { onPick(linkToken(r)); return }
    const total = getTotalGrams(r.ingredients || [])
    setChosen({ r, total })
    setUnit(total > 0 ? 'g' : 'batch')
    setAmount(total > 0 ? fmtQty(total) : '1')
  }
  function insert() {
    const n = parseFloat(String(amount).replace(',', '.'))
    const qty = n > 0 ? (unit === 'g' ? `${fmtQty(n)} g` : fmtQty(n)) : ''
    onPick(`${qty ? qty + '  ' : ''}${linkToken(chosen.r)}`)
  }

  const title = where === 'step' ? 'Steps of another recipe' : 'Use another recipe'
  if (chosen) {
    const { r, total } = chosen
    return (
      <Modal
        title={r.title} icon={BookOpen} onClose={onClose} width={440}
        footer={<><button className="btn ghost sm" onClick={() => setChosen(null)}><ArrowLeft size={14} /> Back</button><button className="btn primary sm" onClick={insert}>Add to ingredients</button></>}
      >
        <p className="Q-link-help">How much of it goes into this recipe?{total > 0 ? ` The whole recipe makes about ${fmtQty(total)} g.` : ''}</p>
        <div className="Q-link-amount">
          <input
            type="number" inputMode="decimal" min="0" step="any" autoFocus value={amount}
            onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') insert() }} aria-label="Amount"
          />
          <div className="Q-seg">
            {total > 0 && <button type="button" className={unit === 'g' ? 'on' : ''} onClick={() => { setUnit('g'); setAmount(fmtQty(total)) }}>grams</button>}
            <button type="button" className={unit === 'batch' ? 'on' : ''} onClick={() => { setUnit('batch'); setAmount('1') }}>× the recipe</button>
          </div>
        </div>
        <p className="Q-link-help dim">It goes first, in a section of its own. Its ingredients go into the shopping list in that amount, and in chef mode its steps come first — or where you place them with “+ Recipe” in the method.</p>
      </Modal>
    )
  }
  return (
    <Modal title={title} icon={BookOpen} onClose={onClose} width={520} className="Q-picker">
      {where === 'step' && <p className="Q-link-help">Its steps go at the top of the method — drag it to where they are cooked.</p>}
      <div className="Q-search" style={{ marginBottom: 10 }}>
        <Search size={15} className="Q-search-ico" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your recipes" aria-label="Search your recipes" />
      </div>
      <ul className="Q-pick-list">
        {list.map((r) => (
          <li key={r.id} className="Q-pick-row" onClick={() => choose(r)}>
            <span className="Q-pick-txt"><b>{r.title}</b>{r.category && <span>{r.category}</span>}</span>
          </li>
        ))}
        {!list.length && <li className="Q-msg">No recipes match.</li>}
      </ul>
    </Modal>
  )
}
