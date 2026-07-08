import { supabase } from './supabase.js'
import { isSectionHeader } from './recipeCalc.js'

const UNICODE_FRACTION_CHARS = '½¼¾⅓⅔⅛⅜⅝⅞'

// Internal nutrition-calc classifier — single value, matched against NUTRIENT_DB in macros.js.
// Not the user-facing browsing taxonomy; see `categories` below for that.
export const INGREDIENT_TYPES = [
  'flour', 'butter', 'egg', 'egg_yolk', 'sugar', 'milk', 'cream', 'salt', 'yeast', 'sourdough',
  'honey', 'oil', 'water', 'chocolate', 'fruit', 'nut', 'spice', 'other',
]

// User-facing browsing categories: broader and freely extensible — an ingredient can belong to
// several at once (e.g. Reblochon → dairy, cheese, fermented). This list just seeds the picker;
// typing a new one in the UI creates it on the spot, no schema change needed (stored as text[]).
export const DEFAULT_CATEGORIES = [
  'dairy', 'cheese', 'fermented', 'grain', 'sweetener', 'fat', 'leavening', 'spice', 'herb',
  'fruit', 'vegetable', 'nut', 'seed', 'protein', 'liquid', 'chocolate', 'egg', 'alcohol',
  'preservative', 'seasoning', 'baking aid', 'other',
]

// A starting category when an ingredient is first AI-analyzed, derived from its nutrition type —
// the user can add more (or remove this) freely afterwards.
const TYPE_TO_DEFAULT_CATEGORY = {
  flour: 'grain', butter: 'dairy', egg: 'egg', egg_yolk: 'egg', sugar: 'sweetener',
  milk: 'dairy', cream: 'dairy', salt: 'seasoning', yeast: 'leavening', sourdough: 'leavening',
  honey: 'sweetener', oil: 'fat', water: 'liquid', chocolate: 'chocolate',
  fruit: 'fruit', nut: 'nut', spice: 'spice', other: null,
}

export function defaultCategoryForType(type) {
  return TYPE_TO_DEFAULT_CATEGORY[type] || null
}

// Union of the seed list and whatever custom categories the library already uses, so the picker
// always offers everything that's actually in play.
export function getAllCategories(items) {
  const set = new Set(DEFAULT_CATEGORIES)
  for (const it of items || []) {
    for (const c of it.categories || []) set.add(c.toLowerCase())
  }
  return [...set].sort()
}

// Cross-language groups for the ~40 ingredients recipes reach for most often (EN/ES/DE/FR/IT),
// so searching "pimienta" also surfaces "pfeffer"/"pepper" and "cinnamon" surfaces "canela"/"zimt".
const SYNONYM_GROUPS = [
  ['salt', 'sal', 'sale', 'sel', 'salz'],
  ['pepper', 'pimienta', 'pepe', 'poivre', 'pfeffer'],
  ['cinnamon', 'canela', 'cannella', 'cannelle', 'zimt'],
  ['sugar', 'azucar', 'azúcar', 'zucchero', 'sucre', 'zucker'],
  ['flour', 'harina', 'farina', 'farine', 'mehl'],
  ['butter', 'mantequilla', 'burro', 'beurre', 'butter'],
  ['egg', 'huevo', 'uovo', 'oeuf', 'œuf', 'ei', 'eier'],
  ['milk', 'leche', 'latte', 'lait', 'milch'],
  ['water', 'agua', 'acqua', 'eau', 'wasser'],
  ['honey', 'miel', 'miele', 'honig'],
  ['yeast', 'levadura', 'lievito', 'levure', 'hefe'],
  ['vanilla', 'vainilla', 'vaniglia', 'vanille'],
  ['chocolate', 'cioccolato', 'chocolat', 'schokolade'],
  ['cream', 'crema', 'nata', 'panna', 'creme', 'crème', 'sahne'],
  ['oil', 'aceite', 'olio', 'huile', 'öl', 'ol'],
  ['lemon', 'limon', 'limón', 'limone', 'citron', 'zitrone'],
  ['orange', 'naranja', 'arancia', 'orange'],
  ['almond', 'almendra', 'mandorla', 'amande', 'mandel'],
  ['walnut', 'nuez', 'noce', 'noix', 'walnuss'],
  ['hazelnut', 'avellana', 'nocciola', 'noisette', 'haselnuss'],
  ['baking powder', 'polvo de hornear', 'levito', 'levure chimique', 'backpulver'],
  ['baking soda', 'bicarbonato', 'bicarbonate', 'natron'],
  ['starch', 'fecula', 'fécula', 'amido', 'fecule', 'stärke', 'maisstärke'],
  ['raisin', 'pasa', 'uvetta', 'raisin sec', 'rosine'],
  ['ginger', 'jengibre', 'zenzero', 'gingembre', 'ingwer'],
  ['nutmeg', 'nuez moscada', 'noce moscata', 'muscade', 'muskat'],
  ['clove', 'clavo', 'chiodo di garofano', 'clou de girofle', 'nelke'],
  ['apple', 'manzana', 'mela', 'pomme', 'apfel'],
  ['potato', 'patata', 'papa', 'patate', 'kartoffel'],
  ['onion', 'cebolla', 'cipolla', 'oignon', 'zwiebel'],
  ['garlic', 'ajo', 'aglio', 'ail', 'knoblauch'],
]

// Expands a query into its whole synonym group (if it matches one), so filtering can search
// across languages instead of only the literal typed term.
export function expandSearchQuery(q) {
  const query = q.toLowerCase().trim()
  if (!query) return []
  const group = SYNONYM_GROUPS.find((g) => g.some((term) => term.includes(query) || query.includes(term)))
  return group ? [query, ...group] : [query]
}

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

// A leading number, optionally a mixed-number fraction ("1 1/2"), and/or a range
// ("2-3", "4–5", "500 à 560" French-style) — stripped unconditionally since it's never part
// of the ingredient's name.
const NUM = `[\\d.,${UNICODE_FRACTION_CHARS}]+(?:/[\\d.,]+)?`
const LEADING_QTY_RE = new RegExp(
  `^${NUM}(?:\\s+${NUM})?` +
  `(?:\\s*(?:-|–|à|to)\\s*${NUM})?` +
  `\\s+`,
)

// Unit words across EN/ES/DE/FR/IT — only these get dropped as a "unit" after the quantity;
// anything else (e.g. "marraquetas" in "2 marraquetas") is treated as the start of the name,
// since a plain qty+word regex can't otherwise tell a unit apart from a count noun.
const KNOWN_UNITS = new Set([
  'g', 'gr', 'gramo', 'gramos', 'gram', 'grams', 'kg', 'kilo', 'kilos', 'kilogram', 'kilograms', 'mg',
  'ml', 'l', 'lt', 'litro', 'litros', 'liter', 'liters', 'litre', 'litres', 'cl', 'dl',
  'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'pint', 'pints', 'quart', 'quarts',
  'cup', 'cups', 'taza', 'tazas', 'tasse', 'tassen',
  'tsp', 'tbsp', 'teaspoon', 'teaspoons', 'tablespoon', 'tablespoons',
  'cda', 'cdas', 'cdta', 'cdtas', 'cucharada', 'cucharadas', 'cucharadita', 'cucharaditas',
  'el', 'tl', 'essl', 'teel',
  'unidad', 'unidades', 'ud', 'uds', 'stück', 'stk', 'pizca', 'prise',
  'gousse', 'gousses', 'tranche', 'tranches', 'feuille', 'feuilles',
  'clove', 'cloves', 'slice', 'slices', 'can', 'cans', 'stick', 'sticks',
  'pieza', 'piezas', 'hoja', 'hojas', 'rama', 'ramas', 'diente', 'dientes',
  'bund', 'bunch', 'bunches', 'handvoll', 'handful', 'sprig', 'sprigs', 'leaf', 'leaves',
  'packet', 'pinch', 'dash', 'splash', 'knob', 'pat',
])

// Collapses a raw recipe ingredient line down to a bare, general ingredient name suitable for the
// library: "1/2 tsp cinnamon" → "cinnamon", "a pinch of salt" → "salt", "2 marraquetas (o hallullas
// grandes)" → "marraquetas", "500 à 560 g jaunes d'œufs" → "jaunes d'œufs".
export function normalizeIngredientName(rawLine) {
  let line = String(rawLine || '').trim()
  for (const rx of QUALIFIER_PREFIXES) {
    const m = line.match(rx)
    if (m) { line = line.slice(m[0].length); break }
  }
  const withoutQty = line.replace(LEADING_QTY_RE, '')
  line = withoutQty !== line ? withoutQty : line
  const unitMatch = line.match(/^([a-zA-Zà-öø-ÿÀ-ÖØ-ß%]+)\s+(.+)$/)
  if (unitMatch && KNOWN_UNITS.has(unitMatch[1].toLowerCase())) line = unitMatch[2]
  // Drop a leftover alternate-unit clause from "425 g / 15 oz potatoes" dual-unit lines — this
  // only surfaces after the first unit ("g") has already been stripped above.
  line = line.replace(new RegExp(`^/\\s*${NUM}\\s*[a-zA-Z]*\\s+`), '')
  // Drop "or substitute" alternatives and parentheticals: "brown sugar, or piloncillo" / "X — or Y" / "(optional)".
  const name = line.replace(/\([^)]*\)/g, '').split(',')[0].split(/\s[—–]\s/)[0].trim().replace(/\s{2,}/g, ' ')
  return name || line.trim() || rawLine.trim()
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
