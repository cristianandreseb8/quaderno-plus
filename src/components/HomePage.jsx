import { useEffect, useMemo, useRef, useState } from 'react'
import { FOLDER_SEP, ancestorPaths } from '../lib/vault.js'
import { resolveMedia } from '../lib/settings.js'
import { StatusBadge } from './StatusBadge.jsx'

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
  onMoveFolder, onRenameFolder, onDeleteFolder, onMoveRecipe, onRequestMove, tr = (x) => x,
}) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(null)   // folder path being renamed
  const [renameVal, setRenameVal] = useState('')
  const [sel, setSel] = useState(() => new Set())  // "folder:<path>" / "recipe:<id>"
  const [drag, setDrag] = useState(null)           // {kind:'folder'|'recipe', id}
  const [dropTarget, setDropTarget] = useState(null)
  const surfaceRef = useRef(null)
  const [marquee, setMarquee] = useState(null)   // rubber-band rect, in surface coordinates
  const marqueeState = useRef(null)

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

  const selKey = (kind, id) => `${kind}:${id}`
  const isSel = (kind, id) => sel.has(selKey(kind, id))
  function toggleSel(kind, id) {
    setSel((prev) => {
      const next = new Set(prev)
      const k = selKey(kind, id)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }
  function selectAllHere() {
    setSel(new Set([...childFolders.map((f) => selKey('folder', f.path)), ...ownRecipes.map((r) => selKey('recipe', r.id))]))
  }
  const selectedItems = [...sel].map((k) => {
    const i = k.indexOf(':')
    return { kind: k.slice(0, i), id: k.slice(i + 1) }
  })
  // Dropping a selection moves the whole selection; dropping an unselected card moves just it.
  function moveSelectionTo(destPath) {
    for (const it of selectedItems) {
      if (it.kind === 'recipe') onMoveRecipe(it.id, destPath)
      else if (it.id !== destPath && !destPath.startsWith(it.id + FOLDER_SEP)) onMoveFolder(it.id, destPath)
    }
    setSel(new Set())
  }

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

  // --- macOS-style rubber-band selection ---------------------------------------------
  // Press on empty space and drag: everything the rectangle touches gets selected, then
  // dragging any selected card moves the whole selection. Mouse only — on a touch screen
  // the same gesture is a scroll, so there the checkboxes are the way in.
  //
  // Coordinates are kept relative to the surface's content box rather than the viewport,
  // so the rectangle stays anchored correctly if the pane scrolls mid-drag.
  function surfacePoint(e) {
    const r = surfaceRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function onSurfacePointerDown(e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    // Only start on empty space: cards and controls keep their own behaviour.
    if (e.target.closest('.H-folder, .H-card, button, input, textarea, a, .H-cover, .H-selbar')) return
    const start = surfacePoint(e)
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    marqueeState.current = { start, additive, base: additive ? new Set(sel) : new Set(), moved: false }
    setMarquee({ x: start.x, y: start.y, w: 0, h: 0 })

    const onMove = (ev) => {
      const st = marqueeState.current
      if (!st) return
      const p = surfacePoint(ev)
      const box = {
        x: Math.min(st.start.x, p.x), y: Math.min(st.start.y, p.y),
        w: Math.abs(p.x - st.start.x), h: Math.abs(p.y - st.start.y),
      }
      if (box.w > 3 || box.h > 3) st.moved = true
      setMarquee(box)

      // Anything the rectangle overlaps is selected.
      const sr = surfaceRef.current.getBoundingClientRect()
      const next = new Set(st.base)
      for (const el of surfaceRef.current.querySelectorAll('[data-selkey]')) {
        const r = el.getBoundingClientRect()
        const a = { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height }
        const hit = a.x < box.x + box.w && a.x + a.w > box.x && a.y < box.y + box.h && a.y + a.h > box.y
        if (hit) next.add(el.getAttribute('data-selkey'))
      }
      setSel(next)
    }

    const onUp = () => {
      const st = marqueeState.current
      // A plain click on empty space clears the selection, as in Finder.
      if (st && !st.moved && !st.additive) setSel(new Set())
      marqueeState.current = null
      setMarquee(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Select-all / clear, matching the platform shortcuts.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyA') {
        const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
        if (inField) return
        e.preventDefault(); selectAllHere()
      } else if (e.key === 'Escape' && sel.size) setSel(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // --- drag & drop (desktop; the ⋯ → Move picker covers touch) ---
  function dropOn(destPath) {
    if (!drag) return
    if (isSel(drag.kind, drag.id) && sel.size > 1) moveSelectionTo(destPath)
    else if (drag.kind === 'recipe') onMoveRecipe(drag.id, destPath)
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
            >{tr(c.split(FOLDER_SEP).pop())}</button>
          </span>
        ))}
      </div>

      <div className="H-surface" ref={surfaceRef} onPointerDown={onSurfacePointerDown}>
      {marquee && <div className="H-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}

      {sel.size > 0 && (
        <div className="H-selbar">
          <span className="H-selcount">{sel.size} selected</span>
          <button className="H-btn primary" onClick={() => onRequestMove({ kind: 'bulk', items: selectedItems, name: `${sel.size} items`, currentPath: path })}>
            Move to…
          </button>
          <button className="H-btn" onClick={selectAllHere}>Select all here</button>
          <button className="H-btn" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

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
                key={f.path} data-selkey={`folder:${f.path}`}
                className={`H-folder${isSel('folder', f.path) ? ' selected' : ''}`} role="button" tabIndex={0}
                draggable
                onDragStart={(e) => {
                  if (!isSel('folder', f.path) && sel.size) setSel(new Set())
                  setDrag({ kind: 'folder', id: f.path }); e.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => { setDrag(null); setDropTarget(null) }}
                {...dropProps(f.path)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) { toggleSel('folder', f.path); return }
                  if (sel.size) { setSel(new Set()); return }
                  setPath(f.path)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') setPath(f.path) }}
              >
                <input
                  type="checkbox" className="H-select" checked={isSel('folder', f.path)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSel('folder', f.path)}
                />
                <span className="H-folder-icon">🗂</span>
                <CardMenu items={[
                  { label: 'Move to…', run: () => onRequestMove({ kind: 'folder', id: f.path, name: f.name, currentPath: parentOf(f.path) }) },
                  { label: 'Rename', run: () => { setRenameVal(f.name); setRenaming(f.path) } },
                  { label: 'Delete folder', danger: true, run: () => onDeleteFolder(f.path) },
                ]} />
                <span className="H-folder-name">{tr(f.name)}</span>
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
                key={r.id} data-selkey={`recipe:${r.id}`}
                className={`H-card${isSel('recipe', r.id) ? ' selected' : ''}`} role="button" tabIndex={0}
                draggable
                onDragStart={(e) => {
                  if (!isSel('recipe', r.id) && sel.size) setSel(new Set())
                  setDrag({ kind: 'recipe', id: r.id }); e.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => { setDrag(null); setDropTarget(null) }}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) { toggleSel('recipe', r.id); return }
                  if (sel.size) { setSel(new Set()); return }
                  onOpenRecipe(r.id)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpenRecipe(r.id) }}
              >
                {r.thumbnail
                  ? <img src={r.thumbnail} alt="" className="H-card-img" />
                  : <div className="H-card-img placeholder">🍞</div>}
                <input
                  type="checkbox" className="H-select" checked={isSel('recipe', r.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSel('recipe', r.id)}
                />
                <CardMenu items={[
                  { label: 'Move to…', run: () => onRequestMove({ kind: 'recipe', id: r.id, name: r.title, currentPath: String(r.folder || '') }) },
                ]} />
                <span className="H-card-title">{r.title || 'Untitled'}</span>
                <span className="H-card-status"><StatusBadge recipe={r} /></span>
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

      </div>

      {drag && <div className="H-drag-hint">{sel.size > 1 && isSel(drag.kind, drag.id) ? `Moving ${sel.size} items — ` : ''}Drop on a folder to move it there, or on a breadcrumb to move it up.</div>}
    </div>
  )
}
