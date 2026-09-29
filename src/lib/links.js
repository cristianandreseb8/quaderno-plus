// Recipes inside recipes: a Flan that uses a Pâte brisée. The link lives in the text of the
// line ("350 g  [[Pâte brisée|<id>]]", see recipeCalc), so copies, variants, translations and
// exports keep it. Here: finding the linked recipe, how much of it is used, and its steps.
import { getTotalGrams, isLinkStep, isSectionHeader, linkOf, numberSteps, parseIng, scaleRecipe, stripRef } from './recipeCalc.js'

const MAX_DEPTH = 3

// The linked recipe: by id, else (a copy, an import) by its title.
export function resolveLink(link, library) {
  if (!link) return null
  const list = Array.isArray(library) ? library : [...(library?.values?.() || [])]
  const byId = list.find((r) => r.id === link.id)
  if (byId) return byId
  const t = link.title.toLowerCase()
  return list.find((r) => String(r.title || '').trim().toLowerCase() === t) || null
}

// How much of the linked recipe a line asks for, as a multiple of the recipe as written:
// "350 g" of a 700 g pâte brisée is ×0.5; "2" (no unit) is two batches; no quantity is one.
const WEIGHT = { g: 1, gr: 1, grs: 1, gram: 1, grams: 1, kg: 1000, mg: 0.001, oz: 28.35, lb: 453.6, lbs: 453.6, ml: 1, cl: 10, dl: 100, l: 1000 }
export function linkFactor(line, sub) {
  const p = parseIng(stripRef(line))
  if (p.qty == null || !(p.qty > 0)) return 1
  const w = WEIGHT[p.unit]
  if (w) {
    const total = getTotalGrams(sub.ingredients || [])
    return total > 0 ? (p.qty * w) / total : 1
  }
  return p.qty
}

// The recipes a recipe uses, once each, in the order they appear: from its ingredients (with
// the amount) and from its method (where their steps go).
export function componentsOf(recipe, library, seen = new Set([recipe.id])) {
  const out = []
  const add = (line, where, i) => {
    const sub = resolveLink(linkOf(line), library)
    if (!sub || seen.has(sub.id)) return
    const had = out.find((c) => c.sub.id === sub.id)
    if (had) { if (where === 'step' && had.stepAt == null) had.stepAt = i; return }
    out.push({ sub, factor: where === 'ing' ? linkFactor(line, sub) : 1, ingAt: where === 'ing' ? i : null, stepAt: where === 'step' ? i : null })
  }
  ;(recipe.ingredients || []).forEach((line, i) => { if (!isSectionHeader(line) && linkOf(line)) add(line, 'ing', i) })
  ;(recipe.steps || []).forEach((line, i) => { if (isLinkStep(line)) add(line, 'step', i) })
  return out
}

// Every step to cook, linked recipes included: their steps go where the method places them
// ("[[Pâte brisée|id]]"), or first — a base is made before what is built on it. Each entry:
// { key, n, text, part, src: { id, title, recipe }, root } — key is the step's index in its own
// recipe for the main one, "<recipe id>:<index>" for a linked one; root is the id of the linked
// recipe (as used by the main one) the step comes from, null for the main recipe's own steps.
export function flattenSteps(recipe, library, depth = 0, seen = new Set([recipe.id]), root = null) {
  const comps = depth < MAX_DEPTH ? componentsOf(recipe, library, seen) : []
  comps.forEach((c) => seen.add(c.sub.id))
  const main = depth === 0
  const src = { id: recipe.id, title: main ? '' : recipe.title, recipe }
  const block = (c) => {
    const scaled = c.factor !== 1 ? scaleRecipe(c.sub, c.factor) : c.sub
    return flattenSteps(scaled, library, depth + 1, seen, root || c.sub.id)
  }
  const own = []
  let part = ''
  numberSteps(recipe.steps).forEach((st, i) => {
    if (st.header) { part = st.text; return }
    if (st.link) {
      const c = comps.find((x) => x.stepAt === i)
      if (c) own.push(...block(c))
      return
    }
    if (!st.n) return
    own.push({ key: main ? i : `${recipe.id}:${i}`, n: st.n, text: st.text, part, src, root })
  })
  const first = comps.filter((c) => c.stepAt == null).flatMap(block)
  return [...first, ...own]
}

// Keys of every step, linked recipes included (for "3 of 12 steps" in a session).
export const allStepKeys = (recipe, library) => flattenSteps(recipe, library).map((s) => s.key)
