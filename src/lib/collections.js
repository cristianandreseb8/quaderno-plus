import { supabase } from './supabase.js'

// Collections are named lists of recipes a person keeps — their own, shared with them, or
// someone's public recipe — without copying them. Favorites are personal stars on any of those.

// The collection the "Like" button fills; it is created the first time something is liked.
export const LIKED_NAME = 'Recipes I like'

const fail = (error) => { if (error) throw new Error(error.message) }

export async function loadCollections() {
  const { data, error } = await supabase.from('collections')
    .select('id, name, created_at, collection_items(recipe_id, added_at)').order('created_at')
  fail(error)
  return (data || []).map((c) => ({
    id: c.id,
    name: c.name,
    // Newest first, so a collection reads like a feed of what was kept.
    items: (c.collection_items || []).slice().sort((a, b) => b.added_at.localeCompare(a.added_at)).map((i) => i.recipe_id),
  }))
}

export async function createCollection(name) {
  const { data, error } = await supabase.from('collections').insert({ name: name.trim() }).select('id, name').single()
  fail(error)
  return { ...data, items: [] }
}

export async function renameCollection(id, name) {
  const { error } = await supabase.from('collections').update({ name: name.trim() }).eq('id', id)
  fail(error)
}

export async function deleteCollection(id) {
  const { error } = await supabase.from('collections').delete().eq('id', id)
  fail(error)
}

export async function addToCollection(collectionId, recipeId) {
  const { error } = await supabase.from('collection_items')
    .upsert({ collection_id: collectionId, recipe_id: recipeId }, { onConflict: 'collection_id,recipe_id', ignoreDuplicates: true })
  fail(error)
}

export async function removeFromCollection(collectionId, recipeId) {
  const { error } = await supabase.from('collection_items').delete().eq('collection_id', collectionId).eq('recipe_id', recipeId)
  fail(error)
}

export async function loadFavorites() {
  const { data, error } = await supabase.from('recipe_favorites').select('recipe_id')
  fail(error)
  return new Set((data || []).map((f) => f.recipe_id))
}

export async function setFavorite(recipeId, on) {
  const { error } = on
    ? await supabase.from('recipe_favorites').upsert({ recipe_id: recipeId }, { onConflict: 'user_id,recipe_id', ignoreDuplicates: true })
    : await supabase.from('recipe_favorites').delete().eq('recipe_id', recipeId)
  fail(error)
}
