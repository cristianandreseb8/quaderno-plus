// A plan for cooking several recipes at once. Each step is some hands-on work (the cook is busy)
// and possibly a wait after it (resting, fermenting, chilling, baking — the cook is free). One cook
// works on one step at a time; waits run in parallel, so the moment a step leaves the cook waiting
// the plan goes on with another recipe. Whenever the cook is free, it goes on with the recipe that
// can least afford to wait: the one whose deadline minus what it still needs comes first (a recipe
// without a deadline counts as due when everything could be done one after another).
// Times come from what the steps say; the times you took are not used yet.
import { flattenSteps } from './links.js'
import { findDurations } from './durations.js'

const MIN = 60000
const HOUR = 60 * MIN
// Steps whose written time is a wait, not work (several languages).
const WAIT = /\b(rest|resting|ferment|fermentation|proof|proofing|rise|chill|fridge|refrigerat\w*|freez\w*|bake|baking|cool|cooling|simmer|infuse|soak|marinat\w*|autolys\w*|set|overnight|reposar|reposo|repose|fermentar|fermentaci\w*|levar|leudar|enfriar|hornear|horno|refrigerar|congelar|cocer|cocinar|infusionar|remojar|marinar|refresc\w*|riposare|riposo|lievitare|lievitazione|raffreddare|cuocere|frigo|forno|cella|rinfresc\w*|reposer|lever|levée|cuire|refroidir|ruhen|gehen|gare|backen|kühlen|abkühlen|kalt)\b/i
// Work that keeps the cook at the bench however long it takes.
const CONSTANT = /(constantly|continuously|without stopping|sin parar|sin dejar de|constantemente|continuamente|senza smettere|di continuo|ständig|ununterbrochen|sans cesse|sans arrêt)/i
const HANDS_ON = /\b(knead\w*|amasa\w*|impasta\w*|knet\w*|pétri\w*|petri\w*|mix|mixing|mezcla\w*|mescola\w*|mischen|mélange\w*|stir\w*|remove\w*|rühr\w*|whisk\w*|bate\w*|frusta\w*|fold|shap\w*|forma\w*|laminat\w*|roll\w*|estira\w*|stend\w*|chop\w*|cut\w*|corta\w*|taglia\w*|peel\w*|pela\w*|fry\w*|freír|friggere|sear\w*|saut\w*)\b/i
const DAYS = /(\d+(?:[.,]\d+)?)\s*(?:days?|d[ií]as?|giorn[oi]|tagen?|tage|jours?)(?![a-z])/gi
const NIGHT = /(overnight|una noche|toda la noche|una notte|tutta la notte|über nacht|uber nacht|toute la nuit)/i
const DEFAULT_ACTIVE = 5 * MIN
const SETUP = 3 * MIN // starting a wait (into the fridge, into the oven)

// The longest time a step names, in milliseconds — also days and "overnight".
export function writtenMs(text) {
  const t = String(text || '')
  let ms = findDurations(t).reduce((m, d) => Math.max(m, d.ms), 0)
  for (const m of t.matchAll(DAYS)) ms = Math.max(ms, parseFloat(m[1].replace(',', '.')) * 24 * HOUR)
  if (NIGHT.test(t)) ms = Math.max(ms, 10 * HOUR)
  return ms
}

// How a step splits into work and wait. A written time of 15 minutes or more is a wait — the cook
// can get on with something else — unless the step is plainly work (kneading, stirring constantly).
export function stepCost(text) {
  const t = String(text || '')
  const written = writtenMs(t)
  const isWait = written >= 15 * MIN && !CONSTANT.test(t) && (WAIT.test(t) || !HANDS_ON.test(t))
  if (isWait) return { active: SETUP, wait: written }
  return { active: written || DEFAULT_ACTIVE, wait: 0 }
}
// The wait in a step ("rest 2 h", "ferment overnight"), in milliseconds — 0 if it is work.
export const waitOf = (text) => stepCost(text).wait

// recipes: [{ recipe, factor }]; library: every recipe (for linked ones).
// done: { [recipe id]: Set of step keys already done } — left out; the plan starts now.
// due: { [recipe id]: ms from now } — when a recipe should be ready, if it has a time.
// started: { [recipe id]: { keys: Set of step keys (as strings) with a timer on, until: ms from now } }
//   — a step on a timer is under way: it and the steps before it are behind the cook, and the
//   recipe goes on when the timer ends.
// Returns { items: [{ ri, rid, key, tkey, srcId, srcIdx, title, text, n, sub, part, start, workEnd, end, wait }],
//           total, sequential, ends: { [recipe id]: ms }, alone: { [recipe id]: ms }, tips }.
export function planSession(recipes, library, { done = {}, due = {}, started = {} } = {}) {
  const chains = recipes.map(({ recipe }, ri) => {
    const all = flattenSteps(recipe, library)
    const st = started[recipe.id]
    const from = st ? all.reduce((m, s, k) => (st.keys.has(String(s.key)) ? k + 1 : m), 0) : 0
    return all.slice(from).filter((s) => !done[recipe.id]?.has(s.key)).map((s) => {
      const own = typeof s.key === 'number'
      const srcKey = own ? String(s.key) : String(s.key).split(':').pop()
      return {
        ri, rid: recipe.id, key: s.key, srcId: s.src.id, srcIdx: srcKey, title: recipe.title, text: s.text, n: s.n, sub: s.src.title, part: s.part,
        tkey: own ? `${recipe.id}:step:${s.key}` : `${recipe.id}:${s.src.id}:step:${srcKey}`,
        ...stepCost(s.text),
      }
    })
  })
  const left = chains.map((c) => c.reduce((t, s) => t + s.active + s.wait, 0))
  const ready = recipes.map(({ recipe }) => Math.max(0, started[recipe.id]?.until || 0))
  const alone = Object.fromEntries(recipes.map(({ recipe }, i) => [recipe.id, ready[i] + left[i]]))
  const horizon = left.reduce((a, b) => a + b, 0) + Math.max(0, ...ready)
  const dueOf = recipes.map(({ recipe }) => (Number.isFinite(due[recipe.id]) ? due[recipe.id] : horizon))
  const next = chains.map(() => 0)
  let free = 0
  const items = []
  while (chains.some((c, i) => next[i] < c.length)) {
    const open = chains.map((c, i) => i).filter((i) => next[i] < chains[i].length)
    const when = Math.max(free, Math.min(...open.map((i) => ready[i])))
    // Of the recipes that can go on now, the one that must start soonest (then the one with most left).
    const can = open.filter((i) => ready[i] <= when)
    const i = can.sort((a, b) => (dueOf[a] - left[a]) - (dueOf[b] - left[b]) || left[b] - left[a])[0]
    const s = chains[i][next[i]]
    const start = Math.max(free, ready[i])
    const workEnd = start + s.active
    const end = workEnd + s.wait
    items.push({ ...s, start, workEnd, end })
    free = workEnd
    ready[i] = end
    left[i] -= s.active + s.wait
    next[i] += 1
  }
  const ends = Object.fromEntries(recipes.map(({ recipe }, i) => [recipe.id, ready[i]]))
  const total = Math.max(0, ...Object.values(ends))
  const sequential = chains.flat().reduce((t, s) => t + s.active + s.wait, 0)
  return { items, total, sequential, ends, alone, tips: tipsFor(items) }
}

// What to start when, in words: the first step, and what fits inside each long wait.
function tipsFor(items) {
  const tips = []
  if (items.length) tips.push({ at: 0, text: `Start with ${items[0].title}: ${short(items[0].text)}` })
  for (const w of items.filter((it) => it.wait >= 20 * MIN)) {
    const inside = items.filter((it) => it.ri !== w.ri && it.start >= w.workEnd && it.start < w.end)
    if (!inside.length) continue
    const names = [...new Set(inside.map((it) => it.title))]
    tips.push({ at: w.workEnd, text: `While ${w.title} waits (${short(w.text)}), work on ${names.join(' and ')} — ${inside.length} step${inside.length === 1 ? '' : 's'}.` })
  }
  return tips.slice(0, 6)
}
const short = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > 60 ? `${s.slice(0, 58).trimEnd()}…` : s }
