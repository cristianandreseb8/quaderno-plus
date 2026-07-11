import { FLOUR_WORDS } from './constants.js'

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36)

export const ts = () =>
  new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function isSectionHeader(line) {
  return /^##?\s+/.test(line)
}

const UNICODE_FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 }
const UNICODE_FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('')

export function parseIng(text) {
  const t = String(text || '').trim()
  const m = t.match(new RegExp(`^(?:(\\d+)\\s+)?([\\d.,]+(?:/[\\d.,]+)?|[${UNICODE_FRACTION_CHARS}])\\s*([a-zA-Z%]*)\\s{1,}(.+)$`))
  if (!m) return { qty: null, unit: '', name: t }
  const whole = m[1] ? parseFloat(m[1]) : 0
  const frac = UNICODE_FRACTIONS[m[2]] !== undefined
    ? UNICODE_FRACTIONS[m[2]]
    : (m[2].includes('/') ? m[2].split('/').reduce((a, b) => parseFloat(a) / parseFloat(b)) : parseFloat(m[2].replace(',', '.')))
  return { qty: whole + frac, unit: m[3].toLowerCase(), name: m[4].trim() }
}

export function toGrams(qty, unit) {
  if (!qty || isNaN(qty)) return 0
  const u = unit || ''
  if (u === 'kg') return qty * 1000
  if (u === 'l') return qty * 1000
  if (u === 'ml') return qty
  if (u === '%') return 0
  return qty
}

export function isFlour(name) {
  const s = (name || '').toLowerCase()
  return FLOUR_WORDS.some((k) => s.includes(k))
}

export function fmtQty(q) {
  if (q >= 100) return String(Math.round(q))
  if (q >= 10) return (Math.round(q * 10) / 10).toFixed(1)
  return (Math.round(q * 100) / 100).toFixed(q < 1 ? 2 : 1)
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
  const parsed = items.map((i) => {
    const p = parseIng(i)
    return { ...p, grams: toGrams(p.qty, p.unit) }
  })
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

export function getTotalGrams(ingredients) {
  return (ingredients || []).reduce((s, ing) => {
    if (isSectionHeader(ing)) return s
    const p = parseIng(ing)
    return s + toGrams(p.qty, p.unit)
  }, 0)
}

export function scaleRecipe(recipe, factor) {
  return {
    ...recipe,
    ingredients: (recipe.ingredients || []).map((ing) => {
      if (isSectionHeader(ing)) return ing
      const p = parseIng(ing)
      if (p.qty === null) return ing
      return `${fmtQty(p.qty * factor)}${p.unit ? ' ' + p.unit : ''}  ${p.name}`
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
