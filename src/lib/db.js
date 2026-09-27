import { supabase } from './supabase.js'

// The list only needs light columns. The heavy ones — original source photos and the media
// library (audio/video/images as data URLs) — are ~14 MB across the library and made the
// full select brush against the statement timeout, so they load per recipe on open.
const HEAVY = ['source_photos', 'media_library']
const LITE_COLUMNS = [
  'id', 'created_at', 'updated_at', 'title', 'category', 'time_estimate', 'servings', 'notes', 'source',
  'ingredients', 'steps', 'notes_pad', 'thumbnail', 'id_data', 'fixed_lang', 'copied_from', 'is_favorite', 'videos',
  'owner_id', 'visibility',
].join(',')
// Display name of whoever owns the recipe (shown on shared and public recipes).
const OWNER = 'owner:profiles!recipes_owner_profile_fk(display_name)'

function toDb(r) {
  const row = {
    id: r.id,
    title: r.title,
    category: r.category,
    time_estimate: r.time,
    servings: r.servings,
    notes: r.notes,
    source: r.source,
    ingredients: r.ingredients || [],
    steps: r.steps || [],
    notes_pad: r.notes_pad || '',
    thumbnail: r.thumbnail || '',
    id_data: r.id_data || '',
    fixed_lang: r.fixed_lang || null,
    copied_from: r.copied_from || null,
    is_favorite: r.is_favorite || false,
    videos: Array.isArray(r.videos) ? r.videos : [],
  }
  // Never write heavy columns for a list-only ("lite") row: their value was never loaded,
  // and writing the default would wipe the saved photos and media.
  if (!r._lite) {
    row.source_photos = r.source_photos || []
    row.media_library = r.media_library || ''
  }
  return row
}

function fromDb(r, lite = false) {
  const rec = {
    ...r,
    time: r.time_estimate,
    notes_pad: r.notes_pad || '',
    thumbnail: r.thumbnail || '',
    id_data: r.id_data || '',
    fixed_lang: r.fixed_lang || null,
    copied_from: r.copied_from || null,
    is_favorite: r.is_favorite || false,
    videos: Array.isArray(r.videos) ? r.videos : [],
  }
  if (lite) {
    rec._lite = true
    HEAVY.forEach((k) => { delete rec[k] })
  } else {
    rec.source_photos = r.source_photos || []
    rec.media_library = r.media_library || ''
  }
  return rec
}

async function withRetry(fn) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await fn()
    if (!error) return data
    lastErr = error
    await new Promise((res) => { setTimeout(res, 700 * (attempt + 1)) })
  }
  throw lastErr
}

export async function dbLoad() {
  const data = await withRetry(() => supabase.from('recipes').select(`${LITE_COLUMNS},${OWNER}`).order('created_at', { ascending: false }))
  return (data || []).map((r) => fromDb(r, true))
}

export async function dbLoadOne(id) {
  const data = await withRetry(() => supabase.from('recipes').select(`*,${OWNER}`).eq('id', id).single())
  return fromDb(data)
}

export async function dbInsert(r) {
  const p = { ...toDb({ ...r, _lite: false }) }
  delete p.id
  const { data, error } = await supabase.from('recipes').insert([p]).select().single()
  if (error) throw error
  return fromDb(data)
}

export async function dbUpdate(r) {
  const { data, error } = await supabase.from('recipes').update(toDb(r)).eq('id', r.id).select().single()
  if (error) throw error
  return fromDb(data)
}

export async function dbDelete(id) {
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw error
}
