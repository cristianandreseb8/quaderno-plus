// Chef mode's reading of a recipe's method, done once by the AI the way a chef reads it: for every
// step, the ingredient lines that go in and what share of each, and the preparations made earlier
// that it uses ("a part of the milk infusion", "the cornstarch and cream mix"). Kept on the device
// per recipe version; shares are fractions, so they hold at any batch size.
import { useEffect, useState } from 'react'
import { cookPlan } from './ai.js'
import { isLinkStep, isSectionHeader, stripLinks } from './recipeCalc.js'

const KEY = (id) => `qdplus_plan_${id}`
const INDEX = 'qdplus_plan_index'
const KEEP = 60

// Changes whenever the title, ingredients or method change.
export function planHash(recipe) {
  const s = JSON.stringify([recipe.title || '', recipe.ingredients || [], recipe.steps || []])
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return `${h.toString(36)}.${s.length}`
}

// What the AI reads: lines and steps with ids ("i4", "s7" — their index in the recipe) and parts.
export function planPayload(recipe) {
  const ingredients = []
  const steps = []
  let part = ''
  ;(recipe.ingredients || []).forEach((line, i) => {
    if (isSectionHeader(line)) { part = String(line).replace(/^##?\s*/, ''); return }
    if (String(line).trim()) ingredients.push({ id: `i${i}`, part, text: stripLinks(line).trim() })
  })
  part = ''
  ;(recipe.steps || []).forEach((line, i) => {
    if (isSectionHeader(line)) { part = stripLinks(String(line).replace(/^##?\s*/, '')); return }
    if (String(line).trim() && !isLinkStep(line)) steps.push({ id: `s${i}`, part, text: stripLinks(line).trim() })
  })
  return { title: recipe.title || '', ingredients, steps }
}

// { [step index]: [{ kind: 'ing' | 'prep', lines: [line index], share, approx, name, from }] }
function normalize(out, recipe) {
  const ings = recipe.ingredients || []
  const line = (id) => {
    const m = /^i(\d+)$/.exec(String(id || ''))
    const k = m ? +m[1] : -1
    return k >= 0 && k < ings.length && !isSectionHeader(ings[k]) ? k : null
  }
  const step = (id) => { const m = /^s(\d+)$/.exec(String(id || '')); return m ? +m[1] : null }
  const plan = {}
  for (const st of out?.steps || []) {
    const i = step(st.id)
    if (i == null) continue
    plan[i] = (st.items || []).map((it) => ({
      kind: it.kind === 'preparation' ? 'prep' : 'ing',
      lines: [...new Set((it.lines || []).map(line).filter((k) => k != null))],
      share: Math.max(0, Math.min(1, Number(it.share) || 0)),
      approx: !!it.approx,
      name: String(it.name || '').trim(),
      from: step(it.from),
    })).filter((it) => (it.kind === 'ing' ? it.lines.length > 0 : it.lines.length > 0 || it.name))
  }
  return plan
}

export function cachedPlan(recipe) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(recipe.id)) || 'null')
    return v && v.hash === planHash(recipe) ? v.plan : null
  } catch (_) {
    return null
  }
}

function store(recipe, plan) {
  try {
    localStorage.setItem(KEY(recipe.id), JSON.stringify({ hash: planHash(recipe), plan }))
    const ids = [recipe.id, ...JSON.parse(localStorage.getItem(INDEX) || '[]').filter((x) => x !== recipe.id)]
    ids.slice(KEEP).forEach((x) => localStorage.removeItem(KEY(x)))
    localStorage.setItem(INDEX, JSON.stringify(ids.slice(0, KEEP)))
  } catch (_) { /* storage full or unavailable: read again next time */ }
}

const inflight = new Map()
const failed = new Set() // not retried until the page reloads
export function loadPlan(recipe) {
  const hit = cachedPlan(recipe)
  if (hit) return Promise.resolve(hit)
  const k = `${recipe.id}|${planHash(recipe)}`
  if (failed.has(k)) return Promise.reject(new Error('failed'))
  if (!inflight.has(k)) {
    inflight.set(k, cookPlan(planPayload(recipe))
      .then((out) => { const plan = normalize(out, recipe); store(recipe, plan); return plan })
      .catch((e) => { failed.add(k); throw e })
      .finally(() => inflight.delete(k)))
  }
  return inflight.get(k)
}

// The plans of these recipes by id — cached ones at once, the others once the AI has read them.
// `pending` while any is being read.
export function useCookPlans(recipes, enabled) {
  const sig = recipes.map((r) => `${r.id}|${planHash(r)}`).join(',')
  const [state, setState] = useState({ plans: {}, pending: false })
  useEffect(() => {
    if (!enabled) { setState({ plans: {}, pending: false }); return undefined }
    let live = true
    const plans = {}
    const todo = []
    recipes.forEach((r) => {
      const p = cachedPlan(r)
      if (p) plans[r.id] = p
      else if ((r.steps || []).some((s) => String(s).trim())) todo.push(r)
    })
    setState({ plans, pending: todo.length > 0 })
    if (!todo.length) return undefined
    Promise.allSettled(todo.map((r) => loadPlan(r).then((p) => {
      if (live) setState((prev) => ({ ...prev, plans: { ...prev.plans, [r.id]: p } }))
    }))).then(() => { if (live) setState((prev) => ({ ...prev, pending: false })) })
    return () => { live = false }
  }, [sig, enabled])
  return state
}
