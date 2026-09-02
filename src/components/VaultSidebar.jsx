import { useMemo, useState } from 'react'
import { buildFolderTree, buildTagTree, searchRecipes, tagAncestors, tagsOf } from '../lib/vault.js'
import { StatusDot } from './StatusBadge.jsx'

const TABS = [
  { key: 'files', icon: '🗂', label: 'Files' },
  { key: 'search', icon: '🔍', label: 'Search' },
  { key: 'tags', icon: '#', label: 'Tags' },
  { key: 'starred', icon: '★', label: 'Bookmarks' },
]

function RecipeRow({ r, selected, onOpen, indent = 0, dnd }) {
  return (
    <div
      className="Q-list-item V-row" role="button" tabIndex={0} aria-selected={selected}
      style={{ paddingLeft: 13 + indent * 13 }}
      draggable={!!dnd}
      onDragStart={dnd ? (e) => { dnd.start({ kind: 'recipe', id: r.id }); e.dataTransfer.effectAllowed = 'move' } : undefined}
      onDragEnd={dnd ? dnd.end : undefined}
      onClick={() => onOpen(r.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r.id) } }}
    >
      {r.thumbnail ? <img src={r.thumbnail} className="Q-list-thumb" alt="" /> : <div className="Q-list-thumb-ph">🍞</div>}
      <div style={{ minWidth: 0, flex: 1 }}>
        <h4><StatusDot recipe={r} />{r.title || 'Untitled'}</h4>
        <span>{[r.category, r.source].filter(Boolean).join(' · ') || '—'}{r.fixed_lang && ` · 📌${r.fixed_lang}`}</span>
      </div>
      {r.is_favorite && <span style={{ fontSize: 11, flexShrink: 0 }}>⭐</span>}
    </div>
  )
}

// One collapsible folder node; children render recursively so nesting has no depth limit.
function FolderNode({ node, depth, recipesByFolder, collapsed, toggle, selId, onOpen, activeFolder, setActiveFolder, dnd, tr = (x) => x }) {
  const isCollapsed = collapsed.has(node.path)
  const own = recipesByFolder.get(node.path) || []
  const isActive = activeFolder === node.path
  return (
    <div>
      <div
        className={`V-tree-row${isActive ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        draggable={!!dnd}
        onDragStart={dnd ? (e) => { e.stopPropagation(); dnd.start({ kind: 'folder', id: node.path }); e.dataTransfer.effectAllowed = 'move' } : undefined}
        onDragEnd={dnd ? dnd.end : undefined}
        {...(dnd ? dnd.dropProps(node.path) : {})}
        onClick={() => { toggle(node.path); setActiveFolder(isActive ? '' : node.path) }}
      >
        <span className="V-caret">{node.children.length || own.length ? (isCollapsed ? '▸' : '▾') : '·'}</span>
        <span className="V-tree-name">{tr(node.name)}</span>
        <span className="V-count">{node.count}</span>
      </div>
      {!isCollapsed && (
        <>
          {node.children.map((c) => (
            <FolderNode key={c.path} node={c} depth={depth + 1} recipesByFolder={recipesByFolder}
              collapsed={collapsed} toggle={toggle} selId={selId} onOpen={onOpen}
              activeFolder={activeFolder} setActiveFolder={setActiveFolder} dnd={dnd} tr={tr} />
          ))}
          {own.map((r) => <RecipeRow key={r.id} r={r} selected={r.id === selId} onOpen={onOpen} indent={depth + 1} dnd={dnd} />)}
        </>
      )}
    </div>
  )
}

function TagNode({ node, depth, collapsed, toggle, activeTag, setActiveTag }) {
  const isCollapsed = collapsed.has(node.path)
  const isActive = activeTag === node.path
  return (
    <div>
      <div
        className={`V-tree-row${isActive ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => setActiveTag(isActive ? '' : node.path)}
      >
        <span className="V-caret" onClick={(e) => { e.stopPropagation(); toggle(node.path) }}>
          {node.children.length ? (isCollapsed ? '▸' : '▾') : '·'}
        </span>
        <span className="V-tree-name V-tag">#{node.name}</span>
        <span className="V-count">{node.count}</span>
      </div>
      {!isCollapsed && node.children.map((c) => (
        <TagNode key={c.path} node={c} depth={depth + 1} collapsed={collapsed} toggle={toggle}
          activeTag={activeTag} setActiveTag={setActiveTag} />
      ))}
    </div>
  )
}

function highlight(line, q) {
  const i = line.toLowerCase().indexOf(q.toLowerCase())
  if (i === -1 || !q) return line
  const from = Math.max(0, i - 28)
  return (
    <>
      {from > 0 && '…'}{line.slice(from, i)}
      <mark className="V-mark">{line.slice(i, i + q.length)}</mark>
      {line.slice(i + q.length, i + q.length + 46)}{line.length > i + q.length + 46 && '…'}
    </>
  )
}

export default function VaultSidebar({
  recipes, index, selId, onOpen, q, setQ, sortMode, setSortMode,
  onAutoCategorize, categorizingAI, folderFilter, setFolderFilter, tagFilter, setTagFilter,
  loading, onOpenGraph, onCreateFolder, allFolders = [], onMoveFolder, onMoveRecipe, tr = (x) => x,
}) {
  const [tab, setTab] = useState('files')
  const [collapsedFolders, setCollapsedFolders] = useState(new Set())
  const [collapsedTags, setCollapsedTags] = useState(new Set())
  const [addingFolder, setAddingFolder] = useState(false)
  const [newFolder, setNewFolder] = useState('')
  const [drag, setDrag] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)

  // Drag a recipe or folder onto a folder row to re-file it, mirroring the home page.
  const dnd = (onMoveFolder && onMoveRecipe) ? {
    start: setDrag,
    end: () => { setDrag(null); setDropTarget(null) },
    dropProps: (destPath) => ({
      onDragOver: (e) => {
        if (!drag) return
        if (drag.kind === 'folder' && (destPath === drag.id || destPath.startsWith(drag.id + '/'))) return
        e.preventDefault()
        setDropTarget(destPath)
      },
      onDragLeave: () => setDropTarget((t) => (t === destPath ? null : t)),
      onDrop: (e) => {
        e.preventDefault(); e.stopPropagation()
        if (!drag) return
        if (drag.kind === 'recipe') onMoveRecipe(drag.id, destPath)
        else if (drag.id !== destPath) onMoveFolder(drag.id, destPath)
        setDrag(null); setDropTarget(null)
      },
      'data-drop': dropTarget === destPath ? '1' : '0',
    }),
  } : null

  const folderTree = useMemo(() => buildFolderTree(recipes, allFolders), [recipes, allFolders])
  // Counted over the recipes actually shown, so folder/search filters and the tag pane agree.
  const tagTree = useMemo(() => {
    const counts = new Map()
    for (const r of recipes) {
      const seen = new Set()
      for (const t of tagsOf(r)) {
        for (const anc of tagAncestors(t)) {
          if (seen.has(anc)) continue
          seen.add(anc)
          counts.set(anc, (counts.get(anc) || 0) + 1)
        }
      }
    }
    return buildTagTree(counts)
  }, [recipes])

  const recipesByFolder = useMemo(() => {
    const m = new Map()
    for (const r of recipes) {
      const f = String(r.folder || '').trim()
      if (!f) continue
      if (!m.has(f)) m.set(f, [])
      m.get(f).push(r)
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    return m
  }, [recipes])

  const unfiled = useMemo(
    () => recipes.filter((r) => !String(r.folder || '').trim()).sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [recipes],
  )

  const searchResults = useMemo(() => (tab === 'search' ? searchRecipes(q, recipes) : []), [tab, q, recipes])
  const starred = useMemo(() => recipes.filter((r) => r.is_favorite), [recipes])
  const taggedRecipes = useMemo(
    () => (tagFilter ? recipes.filter((r) => tagsOf(r).some((t) => t === tagFilter || t.startsWith(tagFilter + '/'))) : []),
    [recipes, tagFilter],
  )

  function toggleSet(setter) {
    return (path) => setter((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  return (
    <aside className="Q-side">
      <div className="V-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`V-tab${tab === t.key ? ' active' : ''}`} title={t.label}
            onClick={() => setTab(t.key)}>{t.icon}</button>
        ))}
        <button className="V-tab" title="Graph view" onClick={onOpenGraph}>🕸</button>
      </div>

      <div className="Q-search">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={tab === 'search' ? 'Search all content…' : 'Filter recipes…'} />
      </div>

      {tab === 'files' && (
        <>
          <div className="V-bar">
            <span className="V-bar-label">Sort:</span>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="recent">Recent first</option>
              <option value="opened">Last opened</option>
              <option value="az">A → Z</option>
              <option value="za">Z → A</option>
              <option value="category">Category</option>
              <option value="favorites">Favorites</option>
            </select>
          </div>
          <div style={{ padding: '4px 12px 5px', borderBottom: '1px solid var(--rule)' }}>
            <button onClick={onAutoCategorize} disabled={categorizingAI} className="btn ghost xs" style={{ width: '100%', fontSize: 10 }}>
              {categorizingAI ? 'Categorizing…' : 'AI auto-categorize'}
            </button>
          </div>
          <div className="Q-list">
            {loading && <div className="Q-msg">Loading…</div>}
            {!loading && folderTree.length > 0 && (
              <div className="V-section">
                <div className="V-section-h">
                  Folders
                  {onCreateFolder && <button className="V-clear" onClick={() => setAddingFolder(true)}>+ new</button>}
                  {folderFilter && <button className="V-clear" onClick={() => setFolderFilter('')}>clear</button>}
                </div>
                {addingFolder && (
                  <div className="V-newfolder-row">
                    <input
                      autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)}
                      placeholder="Folder name or A/B path"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { onCreateFolder(newFolder); setNewFolder(''); setAddingFolder(false) }
                        if (e.key === 'Escape') { setNewFolder(''); setAddingFolder(false) }
                      }}
                    />
                    <button onClick={() => { onCreateFolder(newFolder); setNewFolder(''); setAddingFolder(false) }}>Add</button>
                  </div>
                )}
                {folderTree.map((n) => (
                  <FolderNode key={n.path} node={n} depth={0} recipesByFolder={recipesByFolder}
                    collapsed={collapsedFolders} toggle={toggleSet(setCollapsedFolders)}
                    selId={selId} onOpen={onOpen}
                    activeFolder={folderFilter} setActiveFolder={setFolderFilter} dnd={dnd} tr={tr} />
                ))}
              </div>
            )}
            {!loading && (
              <div className="V-section">
                <div className="V-section-h">{folderTree.length ? 'Unfiled' : 'All recipes'} <span className="V-count">{unfiled.length}</span></div>
                {unfiled.map((r) => <RecipeRow key={r.id} r={r} selected={r.id === selId} onOpen={onOpen} dnd={dnd} />)}
                {!unfiled.length && <div className="Q-msg" style={{ padding: '10px 14px', fontSize: 11.5 }}>Everything is filed into folders.</div>}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'search' && (
        <div className="Q-list">
          {!q.trim() && <div className="Q-msg">Type to search titles, ingredients, steps, notes and tags.</div>}
          {q.trim() && !searchResults.length && <div className="Q-msg">No matches.</div>}
          {searchResults.map(({ recipe, hits }) => (
            <div key={recipe.id} className="V-result" onClick={() => onOpen(recipe.id)}>
              <div className="V-result-title"><StatusDot recipe={recipe} />{recipe.title || 'Untitled'}</div>
              {hits.map((h, i) => (
                <div key={i} className="V-result-line">
                  <span className="V-field">{h.field}</span>{highlight(h.line, q.trim())}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'tags' && (
        <div className="Q-list">
          {!tagTree.length && <div className="Q-msg">No tags yet. Add <code>#tag</code> in a recipe's notes, or tag it from the recipe header.</div>}
          {tagTree.length > 0 && (
            <div className="V-section">
              <div className="V-section-h">
                Tags
                {tagFilter && <button className="V-clear" onClick={() => setTagFilter('')}>clear</button>}
              </div>
              {tagTree.map((n) => (
                <TagNode key={n.path} node={n} depth={0} collapsed={collapsedTags} toggle={toggleSet(setCollapsedTags)}
                  activeTag={tagFilter} setActiveTag={setTagFilter} />
              ))}
            </div>
          )}
          {tagFilter && (
            <div className="V-section">
              <div className="V-section-h">#{tagFilter} <span className="V-count">{taggedRecipes.length}</span></div>
              {taggedRecipes.map((r) => <RecipeRow key={r.id} r={r} selected={r.id === selId} onOpen={onOpen} />)}
            </div>
          )}
        </div>
      )}

      {tab === 'starred' && (
        <div className="Q-list">
          {!starred.length && <div className="Q-msg">No bookmarks yet. Tap the ☆ on any recipe.</div>}
          {starred.map((r) => <RecipeRow key={r.id} r={r} selected={r.id === selId} onOpen={onOpen} />)}
        </div>
      )}
    </aside>
  )
}
