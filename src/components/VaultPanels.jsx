import { useMemo, useState } from 'react'
import { extractLinks, normalizeKey, recipeText, segmentWikilinks, tagsOf } from '../lib/vault.js'
import { isSectionHeader } from '../lib/recipeCalc.js'

/** Renders text with [[wikilinks]] turned into clickable links; unresolved ones show muted. */
export function LinkedText({ text, resolve, onOpen, onCreate }) {
  const segs = useMemo(() => segmentWikilinks(text), [text])
  if (segs.length === 1 && segs[0].type === 'text') return <>{segs[0].value}</>
  return (
    <>
      {segs.map((s, i) => {
        if (s.type === 'text') return <span key={i}>{s.value}</span>
        const hit = resolve(s.target)
        return hit ? (
          <a key={i} className="V-link" onClick={(e) => { e.stopPropagation(); onOpen(hit.id) }}>{s.label}</a>
        ) : (
          <a key={i} className="V-link unresolved" title="Not created yet — click to create"
            onClick={(e) => { e.stopPropagation(); onCreate && onCreate(s.target) }}>{s.label}</a>
        )
      })}
    </>
  )
}

/** Folder path + tags for the open recipe, editable inline (Obsidian's "properties"). */
export function RecipeProperties({ recipe, allFolders, allTags, onChange }) {
  const [tagInput, setTagInput] = useState('')
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderDraft, setFolderDraft] = useState(recipe.folder || '')

  function openFolderEditor() {
    setFolderDraft(recipe.folder || '')
    setFolderOpen((v) => !v)
  }
  function commitFolder() {
    onChange({ ...recipe, folder: folderDraft.trim() })
    setFolderOpen(false)
  }
  const explicit = (recipe.tags || []).map((t) => String(t).toLowerCase())
  // Inline #tags come from the text and can't be removed here — only the explicit ones are editable.
  const inline = tagsOf(recipe).filter((t) => !explicit.includes(t))

  function addTag(raw) {
    const t = String(raw || '').trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-')
    if (!t || explicit.includes(t)) { setTagInput(''); return }
    onChange({ ...recipe, tags: [...explicit, t] })
    setTagInput('')
  }
  const suggestions = allTags.filter((t) => !explicit.includes(t) && (!tagInput || t.includes(tagInput.toLowerCase()))).slice(0, 6)

  return (
    <div className="V-props">
      <div className="V-prop-row">
        <span className="V-prop-key">Folder</span>
        <div className="V-prop-val">
          <button className="V-folder-btn" onClick={openFolderEditor}>
            {recipe.folder ? <span className="V-folder-path">{recipe.folder}</span> : <span className="V-prop-empty">unfiled</span>}
            <span className="V-caret">▾</span>
          </button>
          {folderOpen && (
            <div className="V-folder-menu">
              <div className="V-folder-entry">
                <input
                  autoFocus placeholder="Folder path, e.g. Panadería/Masa Madre"
                  value={folderDraft}
                  onChange={(e) => setFolderDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { commitFolder() }
                    if (e.key === 'Escape') setFolderOpen(false)
                  }}
                />
                <button className="V-folder-save" onClick={commitFolder}>Save</button>
              </div>
              <div className="V-folder-opts">
                {recipe.folder && (
                  <button onClick={() => { onChange({ ...recipe, folder: '' }); setFolderOpen(false) }}>✕ Remove from folder</button>
                )}
                {allFolders.filter((f) => f !== recipe.folder).slice(0, 10).map((f) => (
                  <button key={f} onClick={() => { onChange({ ...recipe, folder: f }); setFolderOpen(false) }}>🗂 {f}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="V-prop-row">
        <span className="V-prop-key">Tags</span>
        <div className="V-prop-val V-tag-wrap">
          {explicit.map((t) => (
            <span key={t} className="V-tag-chip">
              #{t}
              <button onClick={() => onChange({ ...recipe, tags: explicit.filter((x) => x !== t) })}>×</button>
            </span>
          ))}
          {inline.map((t) => <span key={t} className="V-tag-chip inline" title="Written inline in the recipe text">#{t}</span>)}
          <input
            className="V-tag-input" value={tagInput} placeholder="+ tag"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput) }
              if (e.key === 'Backspace' && !tagInput && explicit.length) onChange({ ...recipe, tags: explicit.slice(0, -1) })
            }}
          />
          {tagInput && suggestions.length > 0 && (
            <div className="V-tag-suggest">
              {suggestions.map((t) => <button key={t} onMouseDown={(e) => { e.preventDefault(); addTag(t) }}>#{t}</button>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Linked mentions (real [[links]]) plus unlinked mentions (title appears but isn't linked). */
export function BacklinksPanel({ recipe, recipes, index, onOpen, onLinkBack }) {
  const [tab, setTab] = useState('linked')
  const linked = index.backlinks.get(recipe.id) || []

  const unlinked = useMemo(() => {
    const title = String(recipe.title || '').trim()
    if (title.length < 4) return []
    const needle = title.toLowerCase()
    const out = []
    for (const r of recipes) {
      if (r.id === recipe.id) continue
      const text = recipeText(r)
      const lower = text.toLowerCase()
      const at = lower.indexOf(needle)
      if (at === -1) continue
      // Skip it if it's already a real link to us.
      const already = extractLinks(text).some((l) => normalizeKey(l.target) === normalizeKey(title))
      if (already) continue
      const from = Math.max(0, at - 40)
      out.push({ id: r.id, title: r.title, context: (from > 0 ? '…' : '') + text.slice(from, at + needle.length + 50).replace(/\s+/g, ' ').trim() + '…' })
    }
    return out
  }, [recipe, recipes])

  return (
    <div className="V-backlinks">
      <div className="V-bl-tabs">
        <button className={tab === 'linked' ? 'active' : ''} onClick={() => setTab('linked')}>
          Linked mentions <span className="V-count">{linked.length}</span>
        </button>
        <button className={tab === 'unlinked' ? 'active' : ''} onClick={() => setTab('unlinked')}>
          Unlinked <span className="V-count">{unlinked.length}</span>
        </button>
      </div>
      {tab === 'linked' && (
        linked.length ? linked.map((b, i) => (
          <div key={i} className="V-bl-item" onClick={() => onOpen(b.fromId)}>
            <div className="V-bl-title">{b.fromTitle}</div>
            <div className="V-bl-ctx">{b.context}</div>
          </div>
        )) : <div className="V-bl-empty">No recipe links here yet. Write <code>[[{recipe.title}]]</code> in another recipe's notes or steps.</div>
      )}
      {tab === 'unlinked' && (
        unlinked.length ? unlinked.map((b) => (
          <div key={b.id} className="V-bl-item">
            <div className="V-bl-title" onClick={() => onOpen(b.id)}>{b.title}</div>
            <div className="V-bl-ctx">{b.context}</div>
            {onLinkBack && <button className="V-bl-link" onClick={() => onLinkBack(b.id, recipe.title)}>Link it</button>}
          </div>
        )) : <div className="V-bl-empty">No unlinked mentions.</div>
      )}
    </div>
  )
}

/** Jump list of the recipe's own structure — its ## dough sections plus its main parts. */
export function OutlinePanel({ recipe, onJump }) {
  const items = useMemo(() => {
    const out = [{ key: 'ingredients', label: 'Ingredients', level: 0 }]
    for (const ing of recipe.ingredients || []) {
      if (isSectionHeader(ing)) out.push({ key: 'sec:' + ing, label: ing.replace(/^##?\s*/, ''), level: 1 })
    }
    if ((recipe.steps || []).length) out.push({ key: 'method', label: 'Method', level: 0 })
    if (recipe.notes) out.push({ key: 'notes', label: 'Notes', level: 0 })
    return out
  }, [recipe])

  if (items.length <= 1) return null
  return (
    <div className="V-outline">
      <div className="V-outline-h">Outline</div>
      {items.map((it) => (
        <button key={it.key} className="V-outline-item" style={{ paddingLeft: 10 + it.level * 12 }}
          onClick={() => onJump(it.key)}>
          {it.level === 1 ? '– ' : ''}{it.label}
        </button>
      ))}
    </div>
  )
}
