// A plan for cooking several recipes at once. Each step is some hands-on work (the cook is busy)
// and possibly a wait after it (resting, fermenting, chilling, baking — the cook is free). One cook
// works on one step at a time; waits run in parallel. Whenever the cook is free, the plan goes on with
// the recipe that can least afford to wait: the one whose deadline minus what it still needs comes
// first (a recipe without a deadline counts as due when everything could be done one after another),
// so long waits start early and other work fills them.
import { flattenSteps } from './links.js'
import { findDurations } from './durations.js'
import { typicalMs } from './timing.js'

const MIN = 60000
// Steps whose written time is a wait, not work (several languages).
const WAIT = /\b(rest|resting|ferment|fermentation|proof|proofing|rise|chill|fridge|refrigerat\w*|freez\w*|bake|baking|cool|cooling|simmer|infuse|soak|marinat\w*|autolys\w*|set|overnight|reposar|reposo|repose|fermentar|fermentaci\w*|levar|leudar|enfriar|hornear|horno|refrigerar|congelar|cocer|cocinar|infusionar|remojar|marinar|riposare|riposo|lievitare|lievitazione|raffreddare|cuocere|frigo|forno|reposer|lever|levée|cuire|refroidir|frigo|ruhen|gehen|gare|backen|kühlen|abkühlen|kalt)\b/i
const DEFAULT_ACTIVE = 5 * MIN
const SETUP = 3 * MIN // starting a wait (shaping into the fridge, putting in the oven)

// The wait in a step ("rest 2 h", "ferment overnight 12 h"), in milliseconds — 0 if it is work.
export function waitOf(text) {
  const written = findDurations(text).reduce((m, d) => Math.max(m, d.ms), 0)
  return written >= 15 * MIN && WAIT.test(text) ? written : 0
}

// How a step splits into work and wait, in milliseconds — learned times first.
export function stepCost(step, stats) {
  const learned = typicalMs(stats, step.src.id, step.srcKey, step.text)
  const written = findDurations(step.text).reduce((m, d) => Math.max(m, d.ms), 0)
  const isWait = written >= 15 * MIN && WAIT.test(step.text)
  if (isWait) return { active: Math.min(learned ?? SETUP, 15 * MIN), wait: written, learned: learned != null }
  return { active: learned ?? (written || DEFAULT_ACTIVE), wait: 0, learned: learned != null }
}

// recipes: [{ recipe, factor }]; library: every recipe (for linked ones); stats: lib/timing stats;
// done: { [recipe id]: Set of step keys already done } — those are left out, and the plan starts now.
// due: { [recipe id]: ms from now } — when a recipe should be ready, if it has a time.
// Returns { items: [{ ri, rid, key, tkey, srcId, srcIdx, title, text, n, sub, part, start, workEnd, end, wait, learned }],
//           total, sequential, ends: { [recipe id]: ms }, tips }.
export function planSession(recipes, library, stats, { done = {}, due = {} } = {}) {
  const chains = recipes.map(({ recipe }, ri) => flattenSteps(recipe, library).filter((s) => !done[recipe.id]?.has(s.key)).map((s) => {
    const srcKey = typeof s.key === 'number' ? String(s.key) : String(s.key).split(':').pop()
    const step = { ...s, srcKey }
    const own = typeof s.key === 'number'
    return {
      ri, rid: recipe.id, key: s.key, srcId: s.src.id, srcIdx: srcKey, title: recipe.title, text: s.text, n: s.n, sub: s.src.title, part: s.part,
      tkey: own ? `${recipe.id}:step:${s.key}` : `${recipe.id}:${s.src.id}:step:${srcKey}`,
      ...stepCost(step, stats),
    }
  }))
  const left = chains.map((c) => c.reduce((t, s) => t + s.active + s.wait, 0))
  const horizon = left.reduce((a, b) => a + b, 0)
  const dueOf = chains.map((c, i) => (Number.isFinite(due[recipes[i].recipe.id]) ? due[recipes[i].recipe.id] : horizon))
  const next = chains.map(() => 0)
  const ready = chains.map(() => 0)
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
  const total = items.reduce((m, it) => Math.max(m, it.end), 0)
  const sequential = chains.flat().reduce((t, s) => t + s.active + s.wait, 0)
  const ends = Object.fromEntries(recipes.map(({ recipe }) => [recipe.id, items.filter((it) => it.rid === recipe.id).reduce((m, it) => Math.max(m, it.end), 0)]))
  // The least time each recipe needs on its own (its work and waits in a row): for "start by".
  const alone = Object.fromEntries(recipes.map(({ recipe }, ri) => [recipe.id, chains[ri].reduce((t, s) => t + s.active + s.wait, 0)]))
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
