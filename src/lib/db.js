import { supabase } from './supabase.js'

function toDb(r) {
  return {
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
    source_photos: r.source_photos || [],
    id_data: r.id_data || '',
    media_library: r.media_library || '',
    fixed_lang: r.fixed_lang || null,
    copied_from: r.copied_from || null,
    is_favorite: r.is_favorite || false,
    tags: r.tags || [],
    folder: r.folder || '',
    status: r.status || '',
  }
}

function fromDb(r) {
  return {
    ...r,
    time: r.time_estimate,
    notes_pad: r.notes_pad || '',
    thumbnail: r.thumbnail || '',
    source_photos: r.source_photos || [],
    id_data: r.id_data || '',
    media_library: r.media_library || '',
    fixed_lang: r.fixed_lang || null,
    copied_from: r.copied_from || null,
    is_favorite: r.is_favorite || false,
    tags: r.tags || [],
    folder: r.folder || '',
    status: r.status || '',
  }
}

export async function dbLoad() {
  const { data, error } = await supabase.from('recipes').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(fromDb)
}

export async function dbInsert(r) {
  const p = { ...toDb(r) }
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

// Bulk re-file: every id gets the same folder. Used when moving/renaming a folder, where
// a whole subtree changes path at once — one request per destination instead of per recipe.
export async function dbSetFolder(ids, folder) {
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('recipes')
    .update({ folder, updated_at: new Date().toISOString() })
    .in('id', ids)
    .select()
  if (error) throw error
  return (data || []).map(fromDb)
}

export async function dbDelete(id) {
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw error
}
