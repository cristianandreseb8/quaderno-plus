import { supabase } from './supabase.js'
import { isSectionHeader, parseIng } from './recipeCalc.js'

export async function libLoad() {
  try {
    const { data, error } = await supabase.from('ingredient_library').select('*').order('name')
    if (error) throw error
    return data || []
  } catch (e) {
    console.error('libLoad:', e)
    return []
  }
}

export async function libUpsert(item) {
  try {
    const now = new Date().toISOString()
    if (item.id) {
      const { error } = await supabase.from('ingredient_library').update({ ...item, updated_at: now }).eq('id', item.id)
      if (error) throw error
    } else {
      const { data, error } = await supabase.from('ingredient_library').insert({ ...item, updated_at: now }).select()
      if (error) throw error
      return data && data[0]
    }
  } catch (e) {
    console.error('libUpsert:', e)
  }
}

export async function libDelete(id) {
  try {
    const { error } = await supabase.from('ingredient_library').delete().eq('id', id)
    if (error) throw error
  } catch (e) {
    console.error('libDelete:', e)
  }
}

function namesMatch(a, b) {
  if (!a || !b) return false
  const x = a.toLowerCase().trim()
  const y = b.toLowerCase().trim()
  if (x === y) return true
  return x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x))
}

function libItemMatchesName(libItem, name) {
  if (namesMatch(name, libItem.canonical_name) || namesMatch(name, libItem.name)) return true
  return (libItem.aliases || []).some((a) => namesMatch(name, a))
}

export function libFindMatch(name, libData) {
  if (!libData || !libData.length) return null
  return libData.find((lib) => libItemMatchesName(lib, name))
}

// Every distinct ingredient name used across all recipes, deduplicated case-insensitively.
export function collectAllIngredientNames(recipes) {
  const seen = new Map()
  for (const r of recipes || []) {
    for (const ing of r.ingredients || []) {
      if (isSectionHeader(ing)) continue
      const name = parseIng(ing).name.trim()
      const key = name.toLowerCase()
      if (key && !seen.has(key)) seen.set(key, name)
    }
  }
  return [...seen.values()]
}

// Which recipes use a given library ingredient (by fuzzy name match against parsed ingredient lines).
export function findRecipesForIngredient(libItem, recipes) {
  const matches = []
  for (const r of recipes || []) {
    const hit = (r.ingredients || []).some((ing) => {
      if (isSectionHeader(ing)) return false
      return libItemMatchesName(libItem, parseIng(ing).name)
    })
    if (hit) matches.push({ id: r.id, title: r.title })
  }
  return matches
}
