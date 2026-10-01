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
// "Knead 10 minutes and rest 30 minutes": the shorter times of a step that also waits are work
// when the step names work — but not "folds every 30 minutes", moments inside the wait.
const EVERY = /\b(every|cada|ogni|toutes les|alle|jede[nrs]?)\s+\d+(?:[.,]\d+)?\s*\S+/gi
export function stepCost(text) {
  const t = String(text || '')
  const written = writtenMs(t)
  const isWait = written >= 15 * MIN && !CONSTANT.test(t) && (WAIT.test(t) || !HANDS_ON.test(t))
  if (isWait) {
    const work = HANDS_ON.test(t) ? findDurations(t.replace(EVERY, '')).filter((d) => d.ms < written).reduce((a, d) => a + d.ms, 0) : 0
    return { active: Math.max(SETUP, Math.min(work, HOUR)), wait: written }
  }
  return { active: written || DEFAULT_ACTIVE, wait: 0 }
}
// The wait in a step ("rest 2 h", "ferment overnight"), in milliseconds — 0 if it is work.
export const waitOf = (text) => stepCost(text).wait

// ── Your hours ───────────────────────────────────────────────────────────────
// hours: { shifts: [{ from: '06:00', to: '14:00' }], sleep: { from: '23:00', to: '07:00' } } —
// every day; a range may cross midnight. Hands-on work happens only on shift (any time, without
// shifts) and never asleep; waits (rising, fermenting, baking) run whenever.
const DAY = 24 * HOUR
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim()); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null }
const validRange = (r) => r && toMin(r.from) != null && toMin(r.to) != null && toMin(r.from) !== toMin(r.to)
function daily(r, nowAt, days) {
  const a = toMin(r.from), b = toMin(r.to)
  const out = []
  for (let d = -1; d <= days; d++) {
    const base = new Date(nowAt); base.setHours(0, 0, 0, 0); base.setDate(base.getDate() + d)
    out.push([base.getTime() + a * MIN, base.getTime() + (b > a ? b : b + 1440) * MIN])
  }
  return out
}
function merge(xs) {
  const out = []
  for (const [s, e] of [...xs].sort((p, q) => p[0] - q[0])) {
    if (out.length && s <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e)
    else out.push([s, e])
  }
  return out
}
function subtract(on, off) {
  let cur = on
  for (const [os, oe] of off) cur = cur.flatMap(([s, e]) => (oe <= s || os >= e ? [[s, e]] : [[s, os], [oe, e]].filter(([x, y]) => y > x)))
  return cur
}
export const hasHours = (hours) => !!((hours?.shifts || []).some(validRange) || validRange(hours?.sleep))
// When the cook can work, as [start, end) in ms from now — null when any time will do. Also the
// bands to shade on a timeline: { sleep: [[s, e]], off: [[s, e]] } (off shift but awake).
export function workWindows(hours, nowAt = Date.now(), days = 14) {
  if (!hasHours(hours)) return { windows: null, bands: { sleep: [], off: [] } }
  const shifts = (hours.shifts || []).filter(validRange)
  const span = [nowAt - DAY, nowAt + (days + 1) * DAY]
  const sleep = validRange(hours.sleep) ? merge(daily(hours.sleep, nowAt, days)) : []
  const onShift = shifts.length ? merge(shifts.flatMap((r) => daily(r, nowAt, days))) : [span]
  const rel = (xs) => xs.map(([s, e]) => [Math.max(0, s - nowAt), e - nowAt]).filter(([s, e]) => e > s && e > 0)
  return {
    windows: rel(subtract(onShift, sleep)),
    bands: { sleep: rel(sleep), off: rel(subtract(subtract([span], onShift), sleep)) },
  }
}
// The first moment from t at which `dur` of work fits in a window (work longer than any window
// starts at the start of one).
function fit(windows, t, dur) {
  if (!windows) return t
  for (const [s, e] of windows) {
    if (e <= t) continue
    const st = Math.max(t, s)
    if (st + dur <= e || (e - s < dur && st === s)) return st
  }
  return t
}

// recipes: [{ recipe, factor }]; library: every recipe (for linked ones).
// done: { [recipe id]: Set of step keys already done } — left out; the plan starts now.
// due: { [recipe id]: ms from now } — when a recipe should be ready, if it has a time.
// started: { [recipe id]: { keys: Set of step keys (as strings) with a timer on, until: ms from now } }
//   — a step on a timer is under way: it and the steps before it are behind the cook, and the
//   recipe goes on when the timer ends.
// hours, nowAt: your shifts and sleep (above), and the clock time the plan starts at.
// Returns { items: [{ ri, rid, key, tkey, srcId, srcIdx, title, text, n, sub, part, start, workEnd, end, wait, sat }],
//           total, sequential, ends, alone, delays, tips, bands } — `sat` is how long the food waited
//           for the cook before that step, `delays` when each recipe is best started.
export function planSession(recipes, library, { done = {}, due = {}, started = {}, hours = null, nowAt = Date.now() } = {}) {
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
  const { windows, bands } = workWindows(hours, nowAt)
  const base = recipes.map(({ recipe }) => Math.max(0, started[recipe.id]?.until || 0))
  // A recipe already under way has food on the bench: making it wait counts from now.
  const begun = recipes.map(({ recipe }) => !!started[recipe.id] || (done[recipe.id]?.size || 0) > 0)
  const need = chains.map((c) => c.reduce((t, s) => t + s.active + s.wait, 0))
  const horizon = need.reduce((a, b) => a + b, 0) + Math.max(0, ...base)
  const dueOf = recipes.map(({ recipe }) => (Number.isFinite(due[recipe.id]) ? due[recipe.id] : null))

  // One cook through every chain, each recipe not before its delay. Scored on how long food waits
  // for the cook (a levain past its peak, a dough over-proofed), lateness, and how long it all takes.
  const run = (delay) => {
    const n = chains.length
    const next = chains.map(() => 0)
    const ready = base.map((b, i) => Math.max(b, delay[i]))
    const since = base.map((b, i) => (begun[i] ? b : null)) // since when the food has been waiting
    const left = [...need]
    let free = 0, sat = 0
    const items = []
    while (true) {
      const open = []
      for (let i = 0; i < n; i++) if (next[i] < chains[i].length) open.push(i)
      if (!open.length) break
      const when = Math.max(free, Math.min(...open.map((i) => ready[i])))
      const can = open.filter((i) => ready[i] <= when)
      // The one that must start soonest (deadline minus what it still needs), then the one whose
      // food has waited longest, then the one with most left.
      const key = (i) => (dueOf[i] != null ? dueOf[i] : horizon) - left[i]
      const i = can.sort((a, b) => key(a) - key(b) || (since[a] ?? Infinity) - (since[b] ?? Infinity) || left[b] - left[a])[0]
      const s = chains[i][next[i]]
      const start = fit(windows, Math.max(free, ready[i]), s.active)
      const waited = since[i] == null ? 0 : Math.max(0, start - since[i])
      sat += waited
      const workEnd = start + s.active
      const end = workEnd + s.wait
      items.push({ ...s, start, workEnd, end, sat: waited })
      free = workEnd
      ready[i] = end
      since[i] = end
      left[i] -= s.active + s.wait
      next[i] += 1
    }
    const ends = base.map((b, i) => Math.max(b, ...items.filter((it) => it.ri === i).map((it) => it.end)))
    const late = ends.reduce((t, e, i) => t + (dueOf[i] != null ? Math.max(0, e - dueOf[i]) : 0), 0)
    const total = Math.max(0, ...ends)
    return { items, ends, total, score: sat + 4 * late + 0.1 * total + 0.02 * ends.reduce((a, b) => a + b, 0) }
  }

  // Smarter starts: try each recipe a little or a lot later (two rounds), keep what scores better —
  // so long waits fall while you sleep or are busy elsewhere, and nothing waits on you.
  const STEPS = [0, 15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1080, 1260, 1440].map((m) => m * MIN)
  let delay = chains.map(() => 0)
  let best = run(delay)
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < chains.length; i++) {
      if (!chains[i].length) continue
      for (const d of STEPS) {
        if (d === delay[i]) continue
        const trial = delay.map((x, k) => (k === i ? d : x))
        const r = run(trial)
        if (r.score < best.score - MIN) { best = r; delay = trial }
      }
    }
  }

  const { items, total } = best
  const ends = Object.fromEntries(recipes.map(({ recipe }, i) => [recipe.id, best.ends[i]]))
  // The least time each recipe needs on its own (its work and waits in a row): for "start by".
  const alone = Object.fromEntries(recipes.map(({ recipe }, i) => [recipe.id, base[i] + need[i]]))
  const sequential = need.reduce((a, b) => a + b, 0)
  const delays = Object.fromEntries(recipes.map(({ recipe }, i) => [recipe.id, delay[i]]))
  const inBand = (t, xs) => xs.some(([s, e]) => t >= s && t < e)
  const why = (t) => (inBand(t, bands.sleep) ? 'you’re asleep' : inBand(t, bands.off) ? 'you’re off shift' : 'you’re busy with another recipe')
  return { items, total, sequential, ends, alone, delays, bands, tips: tipsFor(items, chains, delay, begun, !!windows, why) }
}

// What to start when, in words: the first step, recipes better started later, what fits inside
// each long wait, and where food would wait for the cook.
function tipsFor(items, chains, delay, begun, timed, why) {
  const tips = []
  if (items.length) tips.push({ at: items[0].start, text: `Start with ${items[0].title}: ${short(items[0].text)}`, kind: 'start' })
  chains.forEach((c, i) => {
    const first = items.find((it) => it.ri === i)
    if (!first || begun[i] || delay[i] < 30 * MIN) return
    tips.push({ at: first.start, text: `Start ${first.title} — not earlier: ${timed ? 'that way its waits fit your hours' : 'that way it doesn’t clash with the others'}.` })
  })
  for (const w of items.filter((it) => it.wait >= 20 * MIN)) {
    const inside = items.filter((it) => it.ri !== w.ri && it.start >= w.workEnd && it.start < w.end)
    if (!inside.length) continue
    const names = [...new Set(inside.map((it) => it.title))]
    tips.push({ at: w.workEnd, text: `While ${w.title} waits (${short(w.text)}), work on ${names.join(' and ')} — ${inside.length} step${inside.length === 1 ? '' : 's'}.` })
  }
  for (const it of items.filter((x) => x.sat >= 30 * MIN)) {
    tips.push({ at: it.start - it.sat, text: `${it.title} will wait ${span(it.sat)} for you before “${short(it.text, 40)}” — ${why(it.start - it.sat)}.`, kind: 'warn' })
  }
  return tips.sort((a, b) => a.at - b.at).slice(0, 8)
}
const span = (ms) => { const m = Math.round(ms / MIN); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` }
const short = (t, n = 60) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 2).trimEnd()}…` : s }
