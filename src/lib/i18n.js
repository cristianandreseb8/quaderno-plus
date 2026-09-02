import { supabase } from './supabase.js'
import { translateStrings } from './ai.js'

// App-wide translation with a permanent cache.
//
// The expensive part — asking a model to translate a phrase — happens once per
// (phrase, language) pair and the result is written to the `translations` table. Every
// later render of that phrase in that language is a cache read, so switching language
// repeatedly costs nothing after the first pass.

export const DEFAULT_LANGUAGES = [
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
  { code: 'de', flag: '🇩🇪', label: 'Deutsch' },
]

// Full names for the model; the picker only ever shows flags + labels.
export const LANG_NAMES = {
  en: 'English', es: 'Spanish', de: 'German', fr: 'French', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ja: 'Japanese', zh: 'Chinese',
  ca: 'Catalan', eu: 'Basque', gl: 'Galician', pl: 'Polish', sv: 'Swedish',
  da: 'Danish', no: 'Norwegian', fi: 'Finnish', tr: 'Turkish', el: 'Greek',
  ar: 'Arabic', he: 'Hebrew', ko: 'Korean', uk: 'Ukrainian', cs: 'Czech',
  hu: 'Hungarian', ro: 'Romanian', th: 'Thai', vi: 'Vietnamese', hi: 'Hindi',
}

export const FLAG_CHOICES = [
  ['en', '🇬🇧'], ['en', '🇺🇸'], ['es', '🇪🇸'], ['es', '🇲🇽'], ['es', '🇦🇷'], ['es', '🇨🇱'],
  ['de', '🇩🇪'], ['de', '🇦🇹'], ['de', '🇨🇭'], ['fr', '🇫🇷'], ['it', '🇮🇹'], ['pt', '🇵🇹'],
  ['pt', '🇧🇷'], ['nl', '🇳🇱'], ['pl', '🇵🇱'], ['ru', '🇷🇺'], ['uk', '🇺🇦'], ['tr', '🇹🇷'],
  ['sv', '🇸🇪'], ['da', '🇩🇰'], ['no', '🇳🇴'], ['fi', '🇫🇮'], ['el', '🇬🇷'], ['cs', '🇨🇿'],
  ['hu', '🇭🇺'], ['ro', '🇷🇴'], ['ja', '🇯🇵'], ['ko', '🇰🇷'], ['zh', '🇨🇳'], ['ar', '🇸🇦'],
  ['he', '🇮🇱'], ['th', '🇹🇭'], ['vi', '🇻🇳'], ['hi', '🇮🇳'],
]

// Small, stable, dependency-free hash. Only needs to avoid collisions within one language.
export function hashText(s) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const str = String(s)
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 20)
}

const memory = new Map() // `${lang}:${hash}` -> translated, avoids re-querying within a session

function memKey(lang, hash) { return `${lang}:${hash}` }

/** Reads whatever of `texts` is already cached, in memory or in the table. */
export async function readCache(texts, lang) {
  const out = new Map()
  const missingHashes = []
  for (const t of texts) {
    const h = hashText(t)
    const m = memory.get(memKey(lang, h))
    if (m != null) out.set(t, m)
    else missingHashes.push({ text: t, hash: h })
  }
  if (!missingHashes.length) return { hits: out, misses: [] }

  try {
    // Chunked so the query string can't blow past URL limits on a big first pass.
    for (let i = 0; i < missingHashes.length; i += 200) {
      const slice = missingHashes.slice(i, i + 200)
      const { data, error } = await supabase
        .from('translations').select('src_hash, dst')
        .eq('lang', lang)
        .in('src_hash', slice.map((m) => m.hash))
      if (error) throw error
      const byHash = new Map((data || []).map((r) => [r.src_hash, r.dst]))
      for (const m of slice) {
        const hit = byHash.get(m.hash)
        if (hit != null) { out.set(m.text, hit); memory.set(memKey(lang, m.hash), hit) }
      }
    }
  } catch (e) {
    console.error('translation cache read:', e)
  }
  return { hits: out, misses: missingHashes.filter((m) => !out.has(m.text)).map((m) => m.text) }
}

async function writeCache(pairs, lang) {
  if (!pairs.length) return
  const rows = pairs.map(([src, dst]) => ({ lang, src_hash: hashText(src), src, dst }))
  for (const [src, dst] of pairs) memory.set(memKey(lang, hashText(src)), dst)
  try {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('translations').upsert(rows.slice(i, i + 200), { onConflict: 'lang,src_hash' })
      if (error) throw error
    }
  } catch (e) {
    console.error('translation cache write:', e)
  }
}

/**
 * Translates a list of strings into `lang`, paying only for the ones not already cached.
 * Returns a Map of source -> translation. English source is returned untouched.
 */
export async function translateMany(texts, lang, { onProgress } = {}) {
  const unique = [...new Set(texts.filter((t) => String(t || '').trim()))]
  if (!unique.length || lang === 'en') return new Map(unique.map((t) => [t, t]))

  const { hits, misses } = await readCache(unique, lang)
  if (!misses.length) return hits

  const langName = LANG_NAMES[lang] || lang
  const BATCH = 40
  for (let i = 0; i < misses.length; i += BATCH) {
    const chunk = misses.slice(i, i + BATCH)
    try {
      const res = await translateStrings(chunk, langName)
      const arr = Array.isArray(res?.items) ? res.items : []
      const pairs = []
      chunk.forEach((src, j) => {
        const dst = typeof arr[j] === 'string' && arr[j].trim() ? arr[j] : src
        hits.set(src, dst)
        pairs.push([src, dst])
      })
      await writeCache(pairs, lang)
    } catch (e) {
      console.error('translateMany batch failed:', e)
      for (const src of chunk) hits.set(src, src) // fall back to the original text
    }
    onProgress?.(Math.min(misses.length, i + BATCH), misses.length)
  }
  return hits
}

/** Every translatable string on a recipe, in a stable order. */
export function recipeStrings(r) {
  return [
    r.title || '',
    r.category || '',
    r.time || '',
    r.servings || '',
    r.notes || '',
    r.storage_note || '',
    r.watch_out || '',
    ...(r.ingredients || []),
    ...(r.steps || []),
  ].filter((t) => String(t || '').trim())
}

/** Rebuilds a recipe with each string swapped for its translation (missing ones pass through). */
export function applyRecipeTranslation(r, map) {
  const t = (v) => (v && map.get(v)) || v
  return {
    ...r,
    title: t(r.title),
    category: t(r.category),
    time: t(r.time),
    servings: t(r.servings),
    notes: t(r.notes),
    storage_note: t(r.storage_note),
    watch_out: t(r.watch_out),
    ingredients: (r.ingredients || []).map(t),
    steps: (r.steps || []).map(t),
  }
}
