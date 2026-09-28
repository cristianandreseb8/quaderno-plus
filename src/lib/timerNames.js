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

// The ingredient a step is about: "Sofreír la cebolla 10 minutos" → "Cebolla". A step that
// works with several ingredients is about the dough or part it belongs to, so none is returned.
export function stepSubject(stepText, ingredientNames) {
  const text = ` ${norm(stepText).replace(/[^a-z0-9]+/g, ' ')} `
  const found = []
  for (const raw of ingredientNames) {
    const core = norm(String(raw).replace(/\([^)]*\)/g, ' ').split(/[,;—]/)[0]).replace(/[^a-z0-9]+/g, ' ').trim()
    if (!core) continue
    const words = core.split(' ')
    // The whole name ("lievito madre"), else its first word the step uses ("cebolla" for
    // "cebolla blanca mediana", "ajo" for "dientes de ajo").
    const phrase = words.slice(0, 3).join(' ')
    const word = words.find((w) => w.length >= 3 && !STOP.has(w) && !WEAK.has(w) && !/^\d/.test(w) && text.includes(` ${w} `))
    const hit = text.includes(` ${phrase} `) ? phrase : word || null
    if (hit && !found.some((f) => f === hit || f.includes(hit) || hit.includes(f))) found.push(hit)
  }
  return found.length === 1 ? cap(found[0]) : ''
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
