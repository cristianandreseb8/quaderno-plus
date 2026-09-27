import { hasFlourWord } from './constants.js'
import { estimateGrams, isUnitWord, scaleInlineWeights } from './grams.js'

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36)

export const ts = () =>
  new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function isSectionHeader(line) {
  return /^##?\s+/.test(line)
}

// "→ 117 g  lievito madre (refreshed)" — a preparation made earlier in the same recipe and
// added to a later part. It is shown and scaled, but never counted in totals or bought.
const REF_RX = /^\s*(?:→|->)\s*/
export const isRefLine = (line) => REF_RX.test(String(line || ''))
export const stripRef = (line) => String(line || '').replace(REF_RX, '')

// Split an ingredient line for display: quantity column, name, and whether it is a reference.
// Only a real unit goes in the quantity column — "2 large eggs" is 2 + "large eggs".
export function splitIngLine(line) {
  const ref = isRefLine(line)
  const t = (ref ? stripRef(line) : String(line || '')).trim()
  const m = t.match(ING_RX)
  if (!m) return { ref, qty: '', name: t }
  const amount = (m[1] ? m[1] + ' ' : '') + m[2]
  if (m[3] && (isUnitWord(m[3]) || m[3] === '%')) return { ref, qty: `${amount} ${m[3]}`, name: m[4].trim() }
  return { ref, qty: amount, name: [m[3], m[4].trim()].filter(Boolean).join(' ') }
}

// Numbering skips "## Part" header lines inside the method.
export function numberSteps(steps) {
  let n = 0
  return (steps || []).map((s) => {
    if (isSectionHeader(s)) return { header: true, text: String(s).replace(/^##?\s*/, ''), n: null }
    if (!String(s).trim()) return { header: false, text: '', n: null }
    n += 1
    return { header: false, text: String(s), n }
  })
}

const UNICODE_FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 }
const UNICODE_FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('')

// qty (with an optional whole number before a fraction: "1 1/2", "1 ½"), unit, name.
const ING_RX = new RegExp(`^(?:(\\d+)\\s+)?([\\d.,]+(?:/[\\d.,]+)?|[${UNICODE_FRACTION_CHARS}])\\s*([a-zA-Z%]*)\\s{1,}(.+)$`)

export function parseIng(text) {
  const t = String(text || '').trim()
  const m = t.match(ING_RX)
  if (!m) return { qty: null, unit: '', name: t }
  const whole = m[1] ? parseFloat(m[1]) : 0
  const frac = UNICODE_FRACTIONS[m[2]] !== undefined
    ? UNICODE_FRACTIONS[m[2]]
    : (m[2].includes('/') ? m[2].split('/').reduce((a, b) => parseFloat(a) / parseFloat(b)) : parseFloat(m[2].replace(',', '.')))
  return { qty: whole + frac, unit: m[3].toLowerCase(), name: m[4].trim() }
}

// Weight of a quantity in a known unit (g, kg, oz, ml…). Prefer lineGrams, which also
// understands "1 egg", "1 tsp salt" and "1 cup flour".
export function toGrams(qty, unit) {
  return estimateGrams({ qty, unit, name: '' }).grams
}

// Weight of one ingredient line, estimated when it is not written in grams.
// approx is true for estimates, so the view can show "≈ 50 g" next to "1 egg".
export function ingGrams(line) {
  if (isSectionHeader(line)) return { grams: 0, approx: false }
  return estimateGrams(parseIng(stripRef(line)))
}
export const lineGrams = (line) => ingGrams(line).grams

export function isFlour(name) {
  return hasFlourWord(name)
}

// 1040, 12.5, 4, 0.25 — no trailing zeros ("4 eggs", not "4.0 eggs").
export function fmtQty(q) {
  if (q >= 100) return String(Math.round(q))
  if (q >= 10) return String(Math.round(q * 10) / 10)
  return String(Math.round(q * 100) / 100)
}

export function parseSections(ingredients) {
  const ings = ingredients || []
  const sections = []
  let cur = { name: null, items: [], rawIndices: [] }
  ings.forEach((ing, i) => {
    if (isSectionHeader(ing)) {
      if (cur.items.length || cur.name !== null) sections.push(cur)
      cur = { name: ing.replace(/^##?\s*/, '').trim(), items: [], rawIndices: [] }
    } else {
      cur.items.push(ing)
      cur.rawIndices.push(i)
    }
  })
  if (cur.items.length || cur.name !== null) sections.push(cur)
  if (!sections.length) return [{ name: null, items: ings, rawIndices: ings.map((_, i) => i) }]
  return sections
}

export function calcPct(items, mode, base, baseGramsOverride = null) {
  const parsed = items.map((i) => ({ ...parseIng(stripRef(i)), grams: lineGrams(i) }))
  let bg = 0
  if (mode === 'baker') bg = parsed.filter((p) => isFlour(p.name)).reduce((s, p) => s + p.grams, 0)
  else if (mode === 'mass') bg = parsed.reduce((s, p) => s + p.grams, 0)
  else if (mode === 'custom' && base) {
    if (baseGramsOverride) bg = baseGramsOverride
    else {
      const b = parsed.find((p) => p.name.toLowerCase().includes(base.toLowerCase()))
      bg = b ? b.grams : 0
    }
  }
  return parsed.map((p) => ({
    ...p,
    pct: bg > 0 && p.grams > 0 ? (p.grams / bg) * 100 : null,
    isBase: mode === 'custom' && base && p.name.toLowerCase().includes(base.toLowerCase()),
  }))
}

// Weight of one part of the recipe, including what comes into it from an earlier part —
// so "First dough" reads 953 g like the book, starter included.
export function sectionGrams(items) {
  return (items || []).reduce((s, ing) => s + lineGrams(ing), 0)
}

const sigWords = (s) => String(s || '').replace(/\([^)]*\)/g, ' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2)
// Does a reference line ("→ first dough (risen)") point at this part ("First dough")?
function refersTo(refName, sectionName) {
  const want = sigWords(refName).slice(0, 2)
  const have = sigWords(sectionName)
  return want.length > 0 && want.every((w) => have.includes(w))
}

// Total weight of what the recipe produces. A part that is fully used in a later part (the
// starter, the first dough) is counted inside that later part, not a second time.
export function getTotalGrams(ingredients) {
  const ings = ingredients || []
  if (!ings.some(isRefLine)) return sectionGrams(ings.filter((l) => !isSectionHeader(l)))
  const sections = parseSections(ings)
  const refs = []
  sections.forEach((sec, si) => sec.items.forEach((it) => { if (isRefLine(it)) refs.push({ name: parseIng(stripRef(it)).name, si }) }))
  return sections.reduce((total, sec, si) => {
    const consumed = sec.name && refs.some((r) => r.si > si && refersTo(r.name, sec.name))
    return consumed ? total : total + sectionGrams(sec.items)
  }, 0)
}

export function scaleRecipe(recipe, factor) {
  return {
    ...recipe,
    ingredients: (recipe.ingredients || []).map((ing) => {
      if (isSectionHeader(ing)) return ing
      const ref = isRefLine(ing)
      const t = (ref ? stripRef(ing) : String(ing)).trim()
      const m = t.match(ING_RX)
      if (!m) return ing
      const p = parseIng(t)
      // Keep the unit as written ("TL", "cdta") and scale weights noted in the name too.
      return `${ref ? '→ ' : ''}${fmtQty(p.qty * factor)}${m[3] ? ' ' + m[3] : ''}  ${scaleInlineWeights(m[4].trim(), factor, fmtQty)}`
    }),
  }
}

export function findStepsForIng(name, steps) {
  const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
  if (!words.length) return new Set()
  const r = new Set()
  ;(steps || []).forEach((s, i) => {
    if (words.some((w) => s.toLowerCase().includes(w))) r.add(i)
  })
  return r
}
