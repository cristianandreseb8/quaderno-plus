// Short names a timer can say out loud: "Lievito madre", "Cebolla", "Primo impasto" — what the
// timer is about, not the whole step. Plus a guess at the recipe's language, so the voice
// pronounces those names in it.

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Words that describe what is done, not what it is done to.
const GENERIC = new Set([
  'management', 'handling', 'preparation', 'prep', 'refresh', 'refreshment', 'refreshing', 'feeding', 'feed', 'build', 'building',
  'single', 'double', 'triple', 'final', 'step', 'stage', 'phase', 'part', 'process', 'method', 'maintenance',
  'manejo', 'gestion', 'preparacion', 'refresco', 'alimentacion', 'fase', 'paso', 'etapa', 'mantenimiento',
  'gestione', 'preparazione', 'rinfresco', 'rinfreschi', 'mantenimento',
  'preparation', 'rafraichi', 'rafraichissement', 'entretien', 'etape',
  'zubereitung', 'pflege', 'auffrischung', 'fütterung', 'futterung', 'schritt',
])
// Little words left at the ends once the generic ones are gone ("manejo de lievito madre").
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'di', 'del', 'della', 'dello', 'il', 'lo', 'le', 'the', 'of', 'for', 'a', 'an', 'du', 'des', 'et', 'y', 'e', 'and', 'der', 'die', 'das', 'und', 'von', '&'])

// Too general to name a timer by themselves ("the dough relaxes"); fine inside a full name ("first dough").
const WEAK = new Set(['dough', 'doughs', 'impasto', 'impasti', 'masa', 'masas', 'pasta', 'teig', 'pate', 'mix', 'mixture', 'batter', 'mezcla', 'composto', 'appareil', 'all', 'first', 'second', 'third', 'primo', 'secondo', 'primera', 'segunda', 'premiere', 'seconde'])

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// "Lievito madre — single refresh (1 : 3 : 43 % water)" → "Lievito madre"
// "Manejo de lievito madre" → "Lievito madre" · "Rest, dividing & shaping" → "Rest"
export function cleanName(text) {
  let s = String(text || '').replace(/\([^)]*\)/g, ' ').split(/\s[—–-]\s|[:;,]/)[0]
  const words = s.split(/\s+/).filter(Boolean).filter((w) => !GENERIC.has(norm(w).replace(/[^a-z]/g, '')))
  while (words.length && STOP.has(norm(words[0]))) words.shift()
  while (words.length && STOP.has(norm(words[words.length - 1]))) words.pop()
  s = words.join(' ').replace(/\s+/g, ' ').trim()
  return cap(s)
}

// Measures and descriptions are not what an ingredient is: "un chorrito vino blanco" is wine, not a
// "chorrito" (so "un chorrito de crema" is not wine), "cebolla picada" is onion, not "picada".
const MEASURE = new Set([
  'un', 'una', 'unos', 'unas', 'uno', 'poco', 'poca', 'algo', 'opcional', 'optional', 'facoltativo', 'facultatif', 'gusto', 'taste', 'needed', 'necesario',
  'chorrito', 'chorritos', 'pizca', 'pizcas', 'punado', 'punados', 'cucharada', 'cucharadas', 'cucharadita', 'cucharaditas', 'cda', 'cdas', 'cdta', 'cdtas',
  'taza', 'tazas', 'tz', 'vaso', 'vasos', 'copa', 'gota', 'gotas', 'trozo', 'trozos', 'rodaja', 'rodajas', 'lamina', 'laminas', 'loncha', 'lonchas',
  'rebanada', 'rebanadas', 'hoja', 'hojas', 'ramita', 'ramitas', 'rama', 'ramas', 'manojo', 'atado', 'diente', 'dientes', 'unidad', 'unidades', 'ud', 'uds',
  'lata', 'latas', 'sobre', 'sobres', 'paquete', 'bolsa', 'pieza', 'piezas', 'cubo', 'cubos', 'juliana',
  'splash', 'dash', 'drizzle', 'pinch', 'handful', 'bunch', 'sprig', 'sprigs', 'clove', 'cloves', 'slice', 'slices', 'piece', 'pieces', 'can', 'cans',
  'jar', 'packet', 'stick', 'sticks', 'knob', 'leaf', 'leaves', 'glass', 'cup', 'cups', 'tsp', 'tbsp', 'spoon', 'spoons', 'some', 'little',
  'pizzico', 'cucchiaio', 'cucchiai', 'cucchiaino', 'cucchiaini', 'bicchiere', 'spruzzo', 'filo', 'noce', 'manciata', 'mazzetto', 'rametto',
  'spicchio', 'spicchi', 'foglia', 'foglie', 'pezzo', 'pezzi', 'fetta', 'fette',
  'pincee', 'cuillere', 'cuilleres', 'trait', 'filet', 'poignee', 'brin', 'brins', 'gousse', 'gousses', 'feuille', 'feuilles', 'verre', 'tranche', 'tranches',
  'prise', 'schuss', 'spritzer', 'handvoll', 'bund', 'zweig', 'zehe', 'zehen', 'blatt', 'blatter', 'glas', 'becher', 'dose', 'packchen', 'scheibe', 'scheiben',
])
const DESCRIPTOR = new Set([
  'picada', 'picado', 'picadas', 'picados', 'molida', 'molido', 'fresca', 'fresco', 'frescas', 'frescos', 'blanca', 'blanco', 'blancas', 'blancos',
  'roja', 'rojo', 'verde', 'verdes', 'amarilla', 'amarillo', 'negra', 'negro', 'grande', 'grandes', 'pequena', 'pequeno', 'pequenas', 'pequenos',
  'mediana', 'mediano', 'caliente', 'fria', 'frio', 'entero', 'entera', 'enteros', 'enteras', 'rallado', 'rallada', 'cortado', 'cortada', 'finamente',
  'fino', 'fina', 'sellada', 'derretida', 'derretido', 'madura', 'maduro', 'seca', 'seco', 'dulce', 'picante', 'ahumado', 'ahumada', 'natural',
  'chopped', 'minced', 'diced', 'sliced', 'grated', 'fresh', 'dried', 'ground', 'large', 'small', 'medium', 'whole', 'red', 'green', 'black',
  'hot', 'cold', 'warm', 'softened', 'melted', 'fine', 'finely', 'roughly', 'ripe', 'raw', 'cooked', 'toasted', 'unsalted', 'salted',
  'tritato', 'tritata', 'bianco', 'bianca', 'grosso', 'piccolo', 'piccola', 'intero', 'intera', 'caldo', 'calda', 'freddo', 'fredda', 'fuso',
  'hache', 'hachee', 'frais', 'fraiche', 'blanc', 'grand', 'grande', 'petit', 'petite', 'entier', 'entiere', 'chaud', 'froid', 'fondu',
  'gehackt', 'frisch', 'frische', 'weiss', 'gross', 'klein', 'ganz', 'warm', 'kalt', 'geschmolzen',
])
// A describing word ("melted", "picada"): skipped when looking for what a step says about an ingredient.
export const isDescriptor = (w) => DESCRIPTOR.has(w)
const SKIP = (w) => w.length < 3 || STOP.has(w) || WEAK.has(w) || MEASURE.has(w) || DESCRIPTOR.has(w) || /^\d/.test(w)
// What an ingredient line names, without quantities, notes and leading measures:
// "opcional 50 ml crema blanca" → "crema blanca", "a 3 dientes de ajos" → "ajos".
export function ingredientKey(raw) {
  const words = norm(String(raw).replace(/\([^)]*\)/g, ' ').split(/[,;—]/)[0]).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  while (words.length && (SKIP(words[0]) && !WEAK.has(words[0]))) words.shift()
  return words.join(' ')
}
// A word, or its singular / plural, in the step: "ajos" / "ajo", "salsa" / "salsas".
function wordIn(text, w) {
  const forms = [w, w.replace(/es$/, ''), w.replace(/s$/, ''), `${w}s`, `${w}es`].filter((f) => f.length >= 3)
  return forms.find((f) => text.includes(` ${f} `)) ? w : null
}

// Does a step mention this ingredient? The whole name ("lievito madre", "crema blanca"), else its
// first real word the step uses ("cebolla" for "cebolla blanca mediana", "ajo" for "dientes de ajo")
// — never a measure, a description or a word too general to mean it. Returns what matched, or null.
function matchIngredient(text, raw) {
  const key = ingredientKey(raw)
  if (!key) return null
  const phrase = key.split(' ').slice(0, 3).join(' ')
  if (text.includes(` ${phrase} `)) return phrase
  return key.split(' ').find((w) => !SKIP(w) && wordIn(text, w)) || null
}
const asWords = (s) => ` ${norm(s).replace(/[^a-z0-9]+/g, ' ')} `

// The ingredient a step is about: "Sofreír la cebolla 10 minutos" → "Cebolla". A step that
// works with several ingredients is about the dough or part it belongs to, so none is returned.
export function stepSubject(stepText, ingredientNames) {
  const text = asWords(stepText)
  const found = []
  for (const raw of ingredientNames) {
    const hit = matchIngredient(text, raw)
    if (hit && !found.some((f) => f === hit || f.includes(hit) || hit.includes(f))) found.push(hit)
  }
  return found.length === 1 ? cap(found[0]) : ''
}

// Every ingredient a step mentions: [{ i, hit, full }] — i indexes `ingredientNames`; lines naming the
// same thing share their `hit` (so the caller can pick the one from the right part); `full` when the
// whole name is in the step. Longer names are found first and their words set aside, so "icing
// sugar" and "pearl sugar" are two things and neither is plain "sugar"; then single words
// ("cebolla" for "cebolla blanca mediana") among what is left.
export function mentionedIngredients(stepText, ingredientNames) {
  let text = asWords(stepText)
  const items = ingredientNames.map((raw, i) => { const key = ingredientKey(raw); return { i, key, phrase: key.split(' ').slice(0, 3).join(' ') } }).filter((x) => x.phrase)
  const out = []
  const byLength = [...new Set(items.map((x) => x.phrase))].sort((a, b) => b.length - a.length)
  for (const phrase of byLength) {
    if (!text.includes(` ${phrase} `)) continue
    items.filter((x) => x.phrase === phrase).forEach((x) => out.push({ i: x.i, hit: phrase, full: true }))
    text = text.split(` ${phrase} `).join(' | ')
  }
  for (const x of items) {
    if (out.some((o) => o.i === x.i)) continue
    const word = x.key.split(' ').find((w) => !SKIP(w) && wordIn(text, w))
    if (word) out.push({ i: x.i, hit: word, full: false })
  }
  return out.sort((a, b) => a.i - b.i)
}

// "BROWN THE RABBIT" → "Brown the rabbit" (only titles written in capitals change).
const sentence = (t) => (t && t === t.toUpperCase() ? cap(t.toLowerCase()) : t)

// The name for a step's timer. A step that opens with its own title ("BROWN THE RABBIT: …",
// "HIGH HEAT PHASE (8–10 min): …") is named from it; otherwise by its ingredient; otherwise by
// the part it belongs to (`fallback`).
export function stepName(stepText, ingredientNames, fallback) {
  const m = String(stepText || '').match(/^([^:]{3,70}):\s/)
  const title = m && m[1].replace(/\([^)]*\)/g, ' ').trim()
  if (title && !/\d/.test(title) && title.split(/\s+/).length <= 6) {
    return stepSubject(title, ingredientNames) || sentence(cleanName(title)) || fallback
  }
  return stepSubject(stepText, ingredientNames) || fallback
}

// en-US, es-ES, it-IT, fr-FR or de-DE, from the words the recipe uses most.
const LANG_WORDS = {
  'es-ES': ['el', 'la', 'los', 'las', 'de', 'y', 'con', 'para', 'hasta', 'minutos', 'horas', 'agregar', 'mezclar', 'hornear'],
  'it-IT': ['il', 'lo', 'gli', 'di', 'e', 'con', 'per', 'fino', 'minuti', 'ore', 'della', 'impastare', 'aggiungere'],
  'en-US': ['the', 'and', 'with', 'for', 'until', 'minutes', 'hours', 'add', 'mix', 'bake', 'into'],
  'fr-FR': ['le', 'les', 'et', 'avec', 'pour', 'jusqu', 'minutes', 'heures', 'ajouter', 'cuire', 'dans'],
  'de-DE': ['der', 'die', 'das', 'und', 'mit', 'fur', 'minuten', 'stunden', 'zugeben', 'backen', 'den'],
}
export function guessLang(text) {
  const words = norm(text).split(/[^a-z]+/).filter(Boolean)
  const count = new Map(words.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map()))
  let best = 'en-US', score = 0
  Object.entries(LANG_WORDS).forEach(([lang, list]) => {
    const n = list.reduce((sum, w) => sum + (count.get(w) || 0), 0)
    if (n > score) { best = lang; score = n }
  })
  return best
}
