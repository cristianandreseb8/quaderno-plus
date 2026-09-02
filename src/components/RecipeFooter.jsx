import { useMemo, useState } from 'react'
import { fuzzySearch } from '../lib/vault.js'
import { StatusPicker } from './StatusBadge.jsx'

/** Click-to-edit block of prose (storage instructions, things to watch out for). */
function EditableNote({ label, hint, value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')

  function open() { setDraft(value || ''); setEditing(true) }
  function save() { onSave(draft.trim()); setEditing(false) }

  return (
    <div className="RF-note">
      <div className="RF-note-h">
        {label}
        {!editing && <button className="RF-edit" onClick={open}>{value ? 'edit' : '+ add'}</button>}
      </div>
      {editing ? (
        <div className="RF-note-edit">
          <textarea
            autoFocus rows={4} value={draft} placeholder={hint}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
          />
          <div className="RF-note-actions">
            <button className="H-btn primary" onClick={save}>Save</button>
            <button className="H-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        value
          ? <div className="RF-note-body">{value}</div>
          : <div className="RF-note-empty">{hint}</div>
      )}
    </div>
  )
}

/** Picks an existing recipe by fuzzy title, or accepts free text for a technique/reference. */
function RecipePicker({ recipes, excludeId, placeholder, allowFreeText, onPick, onClose }) {
  const [q, setQ] = useState('')
  const results = useMemo(
    () => fuzzySearch(q, recipes.filter((r) => r.id !== excludeId), (r) => r.title || '', 30),
    [q, recipes, excludeId],
  )
  return (
    <div className="RF-picker">
      <input
        autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && allowFreeText && q.trim() && !results.length) { onPick({ id: null, label: q.trim() }); onClose() }
        }}
      />
      <div className="RF-picker-list">
        {results.map((h) => (
          <button key={h.item.id} onMouseDown={(e) => { e.preventDefault(); onPick({ id: h.item.id, label: h.item.title }); onClose() }}>
            📄 {h.item.title}
          </button>
        ))}
        {allowFreeText && q.trim() && (
          <button className="RF-freetext" onMouseDown={(e) => { e.preventDefault(); onPick({ id: null, label: q.trim() }); onClose() }}>
            ＋ Add “{q.trim()}” as a technique / reference
          </button>
        )}
        {!results.length && !q.trim() && <div className="RF-picker-empty">Start typing to search recipes.</div>}
      </div>
      <button className="H-btn" onClick={onClose}>Cancel</button>
    </div>
  )
}

export default function RecipeFooter({ recipe, recipes, onUpdate, onOpenRecipe }) {
  const [addingRelated, setAddingRelated] = useState(false)
  const [pickingNext, setPickingNext] = useState(false)

  const related = Array.isArray(recipe.related) ? recipe.related : []
  const next = recipe.next_recipe_id ? recipes.find((r) => r.id === recipe.next_recipe_id) : null

  function setRelated(list) { onUpdate({ ...recipe, related: list }) }

  return (
    <div className="RF">
      <div className="RF-grid">
        <EditableNote
          label="Storage" hint="How and how long to keep it — container, temperature, shelf life."
          value={recipe.storage_note} onSave={(v) => onUpdate({ ...recipe, storage_note: v })}
        />
        <EditableNote
          label="Watch out for" hint="Failure modes, allergens, timing traps, anything that ruins the batch."
          value={recipe.watch_out} onSave={(v) => onUpdate({ ...recipe, watch_out: v })}
        />
      </div>

      <div className="RF-block">
        <div className="RF-note-h">
          Related recipes &amp; techniques
          {!addingRelated && <button className="RF-edit" onClick={() => setAddingRelated(true)}>+ add</button>}
        </div>
        {addingRelated && (
          <RecipePicker
            recipes={recipes} excludeId={recipe.id} allowFreeText
            placeholder="Search a recipe, or type a technique…"
            onPick={(item) => setRelated([...related, item])}
            onClose={() => setAddingRelated(false)}
          />
        )}
        {related.length > 0 ? (
          <ul className="RF-related">
            {related.map((it, i) => (
              <li key={i}>
                {it.id
                  ? <button className="RF-link" onClick={() => onOpenRecipe(it.id)}>📄 {it.label}</button>
                  : <span className="RF-technique">🔧 {it.label}</span>}
                <button className="RF-remove" title="Remove" onClick={() => setRelated(related.filter((_, j) => j !== i))}>×</button>
              </li>
            ))}
          </ul>
        ) : (
          !addingRelated && <div className="RF-note-empty">Nothing linked yet.</div>
        )}
      </div>

      <div className="RF-block">
        <div className="RF-note-h">
          Next in the day&apos;s workflow
          {!pickingNext && (
            <button className="RF-edit" onClick={() => setPickingNext(true)}>{next ? 'change' : '+ set'}</button>
          )}
        </div>
        {pickingNext && (
          <RecipePicker
            recipes={recipes} excludeId={recipe.id}
            placeholder="Which recipe comes next?"
            onPick={(item) => onUpdate({ ...recipe, next_recipe_id: item.id })}
            onClose={() => setPickingNext(false)}
          />
        )}
        {next ? (
          <div className="RF-next-row">
            <button className="RF-next" onClick={() => onOpenRecipe(next.id)}>
              <span className="RF-next-label">Next up</span>
              <span className="RF-next-title">{next.title} →</span>
            </button>
            <button className="RF-remove" title="Clear" onClick={() => onUpdate({ ...recipe, next_recipe_id: null })}>×</button>
          </div>
        ) : (
          !pickingNext && <div className="RF-note-empty">No follow-on recipe set.</div>
        )}
      </div>

      <div className="RF-status">
        <span className="RF-status-label">Recipe status</span>
        <StatusPicker recipe={recipe} onChange={onUpdate} />
      </div>
    </div>
  )
}
