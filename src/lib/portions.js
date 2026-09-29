// How much of an ingredient a step uses, from its words: "add half the cream", "un cuarto del
// azúcar", "il resto della panna", "20 % of the milk", "a little cream", "the sugar in 3
// additions". Chef mode turns that into grams: half of 200 g is 100 g, and "the rest" is what
// earlier steps left.
import { isDescriptor } from './timerNames.js'

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const FRAC_CHARS = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' }

// Words, numbers ("1/4", "2,5"), "%" and punctuation (which ends a phrase).
export function tokenize(text) {
  const t = norm(String(text || '').replace(/[½¼¾⅓⅔⅛]/g, (c) => ` ${FRAC_CHARS[c]} `)).replace(/(\d)\s*\/\s*(\d)/g, '$1/$2')
  return t.match(/\d+(?:[.,]\d+)?(?:\/\d+)?|[a-z]+|%|[.,;:!?()]/g) || []
}

// Little words between the portion and the ingredient ("la mitad DE LA crema").
const FILL = new Set([
  'the', 'of', 'a', 'an', 'your', 'la', 'el', 'lo', 'los', 'las', 'de', 'del', 'su', 'di', 'della', 'dello', 'delle', 'dei', 'degli', 'il', 'le', 'l',
  'du', 'des', 'd', 'der', 'die', 'das', 'den', 'dem', 'vom', 'von',
])
const HALF = new Set(['half', 'mitad', 'meta', 'moitie', 'halfte'])
const REST = new Set(['rest', 'resto', 'reste', 'remaining', 'remainder', 'restante', 'restantes', 'rimanente', 'rimanenti', 'restant', 'restants', 'restliche', 'restlichen', 'restlicher', 'ubrige', 'ubrigen', 'sobrante', 'sobrantes'])
const REST_AFTER = new Set(['restante', 'restantes', 'rimanente', 'rimanenti', 'restant', 'restants', 'remaining', 'sobrante', 'sobrantes'])
const SOME = new Set(['little', 'bit', 'some', 'poco', 'poca', 'algo', 'po', 'peu', 'etwas', 'wenig', 'parte', 'part', 'partie', 'teil'])
const THIRD = new Set(['third', 'thirds', 'tercio', 'tercios', 'terzo', 'terzi', 'tiers', 'drittel'])
const QUARTER = new Set(['quarter', 'quarters', 'cuarto', 'cuartos', 'quarto', 'quarti', 'quart', 'quarts', 'viertel'])
const NUM = {
  a: 1, an: 1, one: 1, un: 1, una: 1, uno: 1, une: 1, ein: 1, eine: 1, einen: 1, einem: 1,
  two: 2, dos: 2, due: 2, deux: 2, zwei: 2, three: 3, tres: 3, tre: 3, trois: 3, drei: 3,
  four: 4, cuatro: 4, quattro: 4, quatre: 4, vier: 4, five: 5, cinco: 5, cinque: 5, cinq: 5, funf: 5, six: 6, seis: 6, sei: 6, sechs: 6,
}
// "in 3 additions", "en tres veces", "in due volte", "en 3 fois", "in 3 Portionen"
const PARTS = new Set(['additions', 'addition', 'parts', 'batches', 'times', 'stages', 'goes', 'lots', 'veces', 'partes', 'tandas', 'volte', 'riprese', 'parti', 'fois', 'portionen', 'teilen', 'mal', 'etappen'])
const num = (t) => (/^\d+(?:[.,]\d+)?$/.test(t) ? parseFloat(t.replace(',', '.')) : NUM[t])

// Where the ingredient's words (`hit`, as the step matcher found them) sit in the step.
function findAll(tokens, hit) {
  const words = String(hit || '').split(' ').filter(Boolean)
  const same = (t, w) => t === w || t === `${w}s` || t === `${w}es` || w === `${t}s` || w === `${t}es`
  const at = []
  for (let i = 0; i + words.length <= tokens.length; i++) {
    if (words.every((w, k) => same(tokens[i + k], w))) at.push(i)
  }
  return { at, len: words.length }
}

// What the words right before (and after) one mention say about the amount.
function portionAt(tokens, i, len) {
  let j = i - 1
  let skipped = 0
  while (j >= 0 && (FILL.has(tokens[j]) || isDescriptor(tokens[j])) && skipped < 4) { j--; skipped++ }
  const w = tokens[j], before = tokens[j - 1]
  let portion = null
  if (w != null) {
    const frac = /^(\d+)\/(\d+)$/.exec(w)
    if (HALF.has(w) && !['in', 'into', 'por'].includes(before)) portion = { kind: 'frac', f: 0.5 }
    else if (REST.has(w)) portion = { kind: 'rest' }
    else if (SOME.has(w)) portion = { kind: 'some' }
    else if (THIRD.has(w)) portion = { kind: 'frac', f: (num(before) || 1) / 3 }
    else if (QUARTER.has(w) && !/^(cup|taza|tazas|tz)$/.test(tokens[j + 1] || '')) portion = { kind: 'frac', f: (num(before) || 1) / 4 }
    else if (frac && +frac[2] > 0 && +frac[1] < +frac[2]) portion = { kind: 'frac', f: +frac[1] / +frac[2] }
    else if (w === '%' && num(before) > 0 && num(before) < 100) portion = { kind: 'frac', f: num(before) / 100 }
  }
  // After it: "la crema restante", "the sugar in 3 additions".
  let k = i + len
  let parts = null
  for (let n = 0; k < tokens.length && n < 7; k++, n++) {
    const t = tokens[k]
    if (/^[.,;:!?()]$/.test(t)) break
    if (!portion && n <= 2 && REST_AFTER.has(t)) portion = { kind: 'rest' }
    if (['in', 'en', 'a', 'au'].includes(t) && num(tokens[k + 1]) >= 2 && num(tokens[k + 1]) <= 8 && PARTS.has(tokens[k + 2])) { parts = num(tokens[k + 1]); break }
  }
  if (!portion && !parts) return null
  return { ...(portion || { kind: 'all' }), ...(parts ? { parts } : {}) }
}

// The portion a step asks for of one ingredient (by the words it was found with), or null.
export function portionIn(stepText, hit) {
  const tokens = tokenize(stepText)
  const { at, len } = findAll(tokens, hit)
  for (const i of at) {
    const p = portionAt(tokens, i, len)
    if (p) return p
  }
  return null
}

const FRAC_LABEL = [[1 / 2, '½'], [1 / 4, '¼'], [3 / 4, '¾'], [1 / 3, '⅓'], [2 / 3, '⅔'], [1 / 8, '⅛']]
export function fracLabel(f) {
  const hit = FRAC_LABEL.find(([v]) => Math.abs(v - f) < 0.005)
  return hit ? hit[1] : `${Math.round(f * 100)}%`
}

// Every step's share of every ingredient, in order, so "the rest" knows what came before.
// uses: per step, [{ key, qty, unit, portion }] → per step, Map key → { f, kind, parts } where
// f is the share of the line (null when it cannot be known: "a little").
export function shares(usesPerStep) {
  const used = new Map() // key → share already used (NaN: unknown)
  return usesPerStep.map((uses) => {
    const out = new Map()
    for (const u of uses) {
      const before = used.has(u.key) ? used.get(u.key) : 0
      const p = u.portion
      let f, kind
      if (p?.kind === 'frac') { f = p.f; kind = 'frac' }
      else if (p?.kind === 'some') { f = null; kind = 'some' }
      else if (p?.kind === 'rest' || (before > 0 && before < 0.999)) {
        // "The rest", or the ingredient again after part of it went in earlier.
        kind = before > 0 || Number.isNaN(before) ? 'rest' : 'all'
        f = Number.isNaN(before) ? null : Math.max(0, 1 - before)
      } else { f = 1; kind = 'all' }
      out.set(u.key, { f, kind, parts: p?.parts || null })
      if (!(before >= 0.999 && kind === 'all')) {
        used.set(u.key, f == null ? NaN : (Number.isNaN(before) ? NaN : before + f))
      }
    }
    return out
  })
}
