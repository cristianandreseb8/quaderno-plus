import { useEffect, useMemo, useRef, useState } from 'react'
import { FOLDER_SEP, ancestorPaths } from '../lib/vault.js'
import { resolveMedia } from '../lib/settings.js'

function parentOf(path) {
  const i = path.lastIndexOf(FOLDER_SEP)
  return i === -1 ? '' : path.slice(0, i)
}

/** Editable cover: an image, a video file, or a YouTube/Vimeo embed. Empty by default. */
function Cover({ mediaUrl, onChange }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(mediaUrl || '')
  const media = resolveMedia(mediaUrl)

  function open() { setDraft(mediaUrl || ''); setEditing(true) }
  function save() { onChange(draft.trim()); setEditing(false) }

  return (
    <div className={`H-cover${media ? '' : ' empty'}`}>
      {media?.kind === 'image' && <img src={media.src} alt="" />}
      {media?.kind === 'video' && <video src={media.src} controls playsInline />}
      {media?.kind === 'embed' && (
        <iframe src={media.src} title="Cover" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      )}
      {!media && !editing && (
        <button className="H-cover-add" onClick={open}>
          <span className="H-cover-add-icon">＋</span>
          <span>Add a cover image or video</span>
        </button>
      )}
      {media && !editing && <button className="H-cover-edit" onClick={open} title="Change cover">✎</button>}
      {editing && (
        <div className="H-cover-editor">
          <input
            autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste an image URL, video URL, or YouTube/Vimeo link"
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          />
          <button className="H-btn primary" onClick={save}>Save</button>
          {mediaUrl && <button className="H-btn" onClick={() => { onChange(''); setEditing(false) }}>Remove</button>}
          <button className="H-btn" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
    </div>
  )
}

/** The ⋯ menu shared by folder and recipe cards. */
function CardMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <span className="H-menu-wrap" ref={ref}>
      <button
        className="H-menu-btn" title="More actions"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
      >⋯</button>
      {open && (
        <span className="H-menu">
          {items.map((it) => (
            <button
              key={it.label} className={it.danger ? 'danger' : ''}
              onClick={(e) => { e.stopPropagation(); setOpen(false); it.run() }}
            >{it.label}</button>
          ))}
        </span>
      )}
    </span>
  )
}

export default function HomePage({
  recipes, folders, path, setPath, onOpenRecipe, onCreateFolder, mediaUrl, onSetMedia, onNewRecipe,
  onMoveFolder, onRenameFolder, onDeleteFolder, onMoveRecipe, onRequestMove,
}) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(null)   // folder path being renamed
  const [renameVal, setRenameVal] = useState('')
  const [drag, setDrag] = useState(null)           // {kind:'folder'|'recipe', id}
  const [dropTarget, setDropTarget] = useState(null)

  const childFolders = useMemo(() => {
    const out = []
    for (const f of folders) {
      if (parentOf(f) !== path) continue
      out.push({
        path: f,
        name: f.slice(path ? path.length + 1 : 0),
        count: recipes.filter((r) => {
          const rf = String(r.folder || '')
          return rf === f || rf.startsWith(f + FOLDER_SEP)
        }).length,
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [folders, path, recipes])

  const ownRecipes = useMemo(
    () => recipes.filter((r) => String(r.folder || '') === path).sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [recipes, path],
  )

  const crumbs = path ? ancestorPaths(path) : []

  function submitFolder() {
    const name = newName.trim().replace(/^\/+|\/+$/g, '')
    if (!name) { setCreating(false); return }
    onCreateFolder(path ? `${path}${FOLDER_SEP}${name}` : name)
    setNewName('')
    setCreating(false)
  }

  function submitRename() {
    if (renaming && renameVal.trim()) onRenameFolder(renaming, renameVal.trim())
    setRenaming(null); setRenameVal('')
  }

  // --- drag & drop (desktop; the ⋯ → Move picker covers touch) ---
  function dropOn(destPath) {
    if (!drag) return
    if (drag.kind === 'recipe') onMoveRecipe(drag.id, destPath)
    else if (drag.kind === 'folder' && drag.id !== destPath) onMoveFolder(drag.id, destPath)
    setDrag(null); setDropTarget(null)
  }
  const dropProps = (destPath) => ({
    onDragOver: (e) => {
      if (!drag) return
      // A folder can't be dropped into itself or its own subtree.
      if (drag.kind === 'folder' && (destPath === drag.id || destPath.startsWith(drag.id + FOLDER_SEP))) return
      e.preventDefault()
      setDropTarget(destPath)
    },
    onDragLeave: () => setDropTarget((t) => (t === destPath ? null : t)),
    onDrop: (e) => { e.preventDefault(); dropOn(destPath) },
    'data-drop': dropTarget === destPath ? '1' : '0',
  })

  return (
    <div className="H-home">
      {!path && <Cover mediaUrl={mediaUrl} onChange={onSetMedia} />}

      <div className="H-crumbs">
        <button className={`H-crumb${path ? '' : ' current'}`} onClick={() => setPath('')} {...dropProps('')}>Home</button>
        {crumbs.map((c, i) => (
          <span key={c}>
            <span className="H-crumb-sep">›</span>
            <button
              className={`H-crumb${i === crumbs.length - 1 ? ' current' : ''}`}
              onClick={() => setPath(c)} {...dropProps(c)}
            >{c.split(FOLDER_SEP).pop()}</button>
          </span>
        ))}
      </div>

      <div className="H-section-head">
        <span className="H-section-title">Folders</span>
        <button className="H-btn" onClick={() => setCreating(true)}>＋ New folder</button>
      </div>

      {creating && (
        <div className="H-newfolder">
          <input
            autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder={path ? `New folder inside ${path}` : 'Folder name'}
            onKeyDown={(e) => { if (e.key === 'Enter') submitFolder(); if (e.key === 'Escape') setCreating(false) }}
          />
          <button className="H-btn primary" onClick={submitFolder}>Create</button>
          <button className="H-btn" onClick={() => setCreating(false)}>Cancel</button>
        </div>
      )}

      {childFolders.length > 0 ? (
        <div className="H-grid">
          {childFolders.map((f) => (
            renaming === f.path ? (
              <div key={f.path} className="H-folder renaming">
                <input
                  autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(null) }}
                />
                <div className="H-rename-actions">
                  <button className="H-btn primary" onClick={submitRename}>Rename</button>
                  <button className="H-btn" onClick={() => setRenaming(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div
                key={f.path} className="H-folder" role="button" tabIndex={0}
                draggable
                onDragStart={(e) => { setDrag({ kind: 'folder', id: f.path }); e.dataTransfer.effectAllowed = 'move' }}
                onDragEnd={() => { setDrag(null); setDropTarget(null) }}
                {...dropProps(f.path)}
                onClick={() => setPath(f.path)}
                onKeyDown={(e) => { if (e.key === 'Enter') setPath(f.path) }}
              >
                <span className="H-folder-icon">🗂</span>
                <CardMenu items={[
                  { label: 'Move to…', run: () => onRequestMove({ kind: 'folder', id: f.path, name: f.name, currentPath: parentOf(f.path) }) },
                  { label: 'Rename', run: () => { setRenameVal(f.name); setRenaming(f.path) } },
                  { label: 'Delete folder', danger: true, run: () => onDeleteFolder(f.path) },
                ]} />
                <span className="H-folder-name">{f.name}</span>
                <span className="H-folder-count">{f.count} {f.count === 1 ? 'recipe' : 'recipes'}</span>
              </div>
            )
          ))}
        </div>
      ) : (
        !creating && <div className="H-empty">No folders here yet.</div>
      )}

      {ownRecipes.length > 0 && (
        <>
          <div className="H-section-head">
            <span className="H-section-title">{path ? 'Recipes in this folder' : 'Unfiled recipes'}</span>
            <span className="H-section-count">{ownRecipes.length}</span>
          </div>
          <div className="H-grid recipes">
            {ownRecipes.map((r) => (
              <div
                key={r.id} className="H-card" role="button" tabIndex={0}
                draggable
                onDragStart={(e) => { setDrag({ kind: 'recipe', id: r.id }); e.dataTransfer.effectAllowed = 'move' }}
                onDragEnd={() => { setDrag(null); setDropTarget(null) }}
                onClick={() => onOpenRecipe(r.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpenRecipe(r.id) }}
              >
                {r.thumbnail
                  ? <img src={r.thumbnail} alt="" className="H-card-img" />
                  : <div className="H-card-img placeholder">🍞</div>}
                <CardMenu items={[
                  { label: 'Move to…', run: () => onRequestMove({ kind: 'recipe', id: r.id, name: r.title, currentPath: String(r.folder || '') }) },
                ]} />
                <span className="H-card-title">{r.title || 'Untitled'}</span>
                {r.category && <span className="H-card-meta">{r.category}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {!childFolders.length && !ownRecipes.length && !creating && (
        <div className="H-blank">
          <p>This folder is empty.</p>
          <button className="H-btn primary" onClick={onNewRecipe}>＋ New recipe</button>
        </div>
      )}

      {drag && <div className="H-drag-hint">Drop on a folder to move it there — or on a breadcrumb to move it up.</div>}
    </div>
  )
}
