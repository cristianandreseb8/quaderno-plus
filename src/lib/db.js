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

export async function dbDelete(id) {
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw error
}
