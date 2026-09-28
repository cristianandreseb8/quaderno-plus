// The recipe list as last seen — with favorites and collections — kept on this device so the
// app opens with it at once and then refreshes from the database. Thumbnails are kept apart
// (they are most of the size) and are dropped first if the device's storage is full.
// Removed on sign-out (see auth.js).

const key = (uid) => `qdplus_list_${uid}`
const thumbKey = (uid) => `qdplus_list_${uid}_thumbs`

export function readList(uid) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(uid)) || 'null')
    if (!Array.isArray(saved?.recipes)) return null
    const thumbs = JSON.parse(localStorage.getItem(thumbKey(uid)) || '{}')
    return {
      recipes: saved.recipes.map((r) => ({ ...r, _lite: true, thumbnail: thumbs[r.id] || '' })),
      favorites: new Set(saved.favorites || []),
      collections: saved.collections || [],
    }
  } catch (_) {
    return null
  }
}

const LIST_ONLY = ['source_photos', 'media_library', 'id_data', 'thumbnail', '_lite']

export function writeList(uid, recipes, favorites, collections) {
  const rows = recipes.map((r) => {
    const row = { ...r }
    LIST_ONLY.forEach((k) => { delete row[k] })
    return row
  })
  const thumbs = Object.fromEntries(recipes.filter((r) => r.thumbnail).map((r) => [r.id, r.thumbnail]))
  try {
    localStorage.setItem(key(uid), JSON.stringify({ at: Date.now(), recipes: rows, favorites: [...favorites], collections }))
  } catch (_) {
    return
  }
  try { localStorage.setItem(thumbKey(uid), JSON.stringify(thumbs)) } catch (_) { try { localStorage.removeItem(thumbKey(uid)) } catch (__) { /* ignore */ } }
}
