import { supabase } from './supabase.js'
import { isSectionHeader, parseIng } from './recipeCalc.js'

export const INGREDIENT_TYPES = [
  'flour', 'butter', 'egg', 'egg_yolk', 'sugar', 'milk', 'cream', 'salt', 'yeast', 'sourdough',
  'honey', 'oil', 'water', 'chocolate', 'fruit', 'nut', 'spice', 'other',
]

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

// Vague-quantity qualifiers ("a pinch of", "ein bisschen", "una pizca de"...) that precede an
// ingredient name instead of a measurable quantity, across the languages recipes are written in.
const QUALIFIER_PREFIXES = [
  /^an?\s+pinch\s+of\s+/i, /^an?\s+pinch\s+/i, /^pinch\s+of\s+/i,
  /^an?\s+bit\s+of\s+/i, /^an?\s+splash\s+of\s+/i, /^an?\s+dash\s+of\s+/i,
  /^an?\s+handful\s+of\s+/i, /^handful\s+of\s+/i, /^some\s+/i,
  /^ein\s+bisschen\s+/i, /^etwas\s+/i, /^eine\s+prise\s+/i, /^prise\s+/i,
  /^un\s+poco\s+de\s+/i, /^una\s+pizca\s+de\s+/i, /^pizca\s+de\s+/i, /^una?\s+pisca\s+de\s+/i,
  /^une\s+pincée\s+de\s+/i, /^un\s+peu\s+de\s+/i,
  /^un\s+pizzico\s+di\s+/i, /^un\s+po[''’]?\s+di\s+/i,
]

// Collapses a raw recipe ingredient line down to a bare, general ingredient name suitable for the
// library: "1/2 tsp cinnamon" → "cinnamon", "a pinch of salt" → "salt", "butter, softened" → "butter".
export function normalizeIngredientName(rawLine) {
  let line = String(rawLine || '').trim()
  for (const rx of QUALIFIER_PREFIXES) {
    const m = line.match(rx)
    if (m) { line = line.slice(m[0].length); break }
  }
  let name = parseIng(line).name || line
  // Drop a leftover alternate-unit clause from "425 g / 15 oz potatoes" style dual-unit lines.
  name = name.replace(/^\/\s*[\d.,½¼¾⅓⅔]+\s*[a-zA-Z]*\s+/, '')
  // Drop "or substitute" alternatives after a comma or dash: "brown sugar, or piloncillo" / "X — or Y".
  name = name.replace(/\([^)]*\)/g, '').split(',')[0].split(/\s[—–]\s/)[0].trim().replace(/\s{2,}/g, ' ')
  return name || line.trim()
}

// Every distinct ingredient name used across all recipes, normalized and deduplicated case-insensitively.
export function collectAllIngredientNames(recipes) {
  const seen = new Map()
  for (const r of recipes || []) {
    for (const ing of r.ingredients || []) {
      if (isSectionHeader(ing)) continue
      const name = normalizeIngredientName(ing)
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
      return libItemMatchesName(libItem, normalizeIngredientName(ing))
    })
    if (hit) matches.push({ id: r.id, title: r.title })
  }
  return matches
}
