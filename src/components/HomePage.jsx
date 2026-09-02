import { useMemo, useState } from 'react'
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
      {media && !editing && (
        <button className="H-cover-edit" onClick={open} title="Change cover">✎</button>
      )}
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

export default function HomePage({
  recipes, folders, path, setPath, onOpenRecipe, onCreateFolder, mediaUrl, onSetMedia, onNewRecipe,
}) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  // Immediate children of the folder we're looking at.
  const childFolders = useMemo(() => {
    const seen = new Map()
    for (const f of folders) {
      if (parentOf(f) !== path) continue
      seen.set(f, f.slice(path ? path.length + 1 : 0))
    }
    return [...seen.entries()]
      .map(([full, name]) => ({
        path: full,
        name,
        // Count everything nested underneath, not just direct children.
        count: recipes.filter((r) => {
          const rf = String(r.folder || '')
          return rf === full || rf.startsWith(full + FOLDER_SEP)
        }).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
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

  return (
    <div className="H-home">
      {!path && <Cover mediaUrl={mediaUrl} onChange={onSetMedia} />}

      <div className="H-crumbs">
        <button className={`H-crumb${path ? '' : ' current'}`} onClick={() => setPath('')}>Home</button>
        {crumbs.map((c, i) => (
          <span key={c}>
            <span className="H-crumb-sep">›</span>
            <button className={`H-crumb${i === crumbs.length - 1 ? ' current' : ''}`} onClick={() => setPath(c)}>
              {c.split(FOLDER_SEP).pop()}
            </button>
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
            <button key={f.path} className="H-folder" onClick={() => setPath(f.path)}>
              <span className="H-folder-icon">🗂</span>
              <span className="H-folder-name">{f.name}</span>
              <span className="H-folder-count">{f.count} {f.count === 1 ? 'recipe' : 'recipes'}</span>
            </button>
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
              <button key={r.id} className="H-card" onClick={() => onOpenRecipe(r.id)}>
                {r.thumbnail
                  ? <img src={r.thumbnail} alt="" className="H-card-img" />
                  : <div className="H-card-img placeholder">🍞</div>}
                <span className="H-card-title">{r.title || 'Untitled'}</span>
                {r.category && <span className="H-card-meta">{r.category}</span>}
              </button>
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
  )
}
