// Which ingredient lines each step of a method uses, and how much of each — for chef mode and the
// "Jan" template (ingredients beside their steps). With the AI's reading of a method (plans, see
// lib/cookPlan.js) it is what the method really takes; without, it is read from the step's words.
import { cleanName, ingredientKey, mentionedIngredients } from './timerNames.js'
import { fmtQty, lineGrams, parseIng, splitIngLine, stripRef } from './recipeCalc.js'
import { fracLabel, portionIn, shares } from './portions.js'
import { hasFlourWord } from './constants.js'

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
// Lines kept for the end ("icing sugar, to finish"), and steps that do the finishing.
const FINISH_LINE = /\b(to finish|for finishing|to serve|for dusting|to dust|to garnish|to decorate|para decorar|para terminar|al servir|para servir|per finire|per decorare|per servire|pour finir|pour décorer|pour servir|zum bestreuen|zum garnieren|zum servieren)\b/i
const FINISH_STEP = /\b(top|tops|topping|finish|dust|sprinkle|decorate|garnish|serve|espolvorear|espolvorea|decorar|decora|terminar|servir|spolverare|spolverizzare|decorare|guarnire|cospargere|saupoudrer|décorer|garnir|servir|bestreuen|garnieren|verzieren)\b/i
// "flour" in a step means the flour of that part, whatever its name ("Caputo Manitoba Oro").
const FLOUR_WORD = /\b(flours?|farina|farine|harinas?|mehl|semola|semolina)\b/

// The amount a step needs of one ingredient line, from its share of the line (see portions.js):
// { qty, note, vague } — "100 g" with "½ of 200 g", "the rest" with "of 200 g" when unknown.
export function amountOf(u, share) {
  const qty = u.d.qty
  const n = u.p.qty
  const unit = String(qty || '').replace(/^[\d.,/½¼¾⅓⅔⅛\s]+/, '').trim()
  const fmt = (q) => `${fmtQty(q)}${unit ? ' ' + unit : ''}`
  const parts = (q) => (share?.parts && n != null ? `${share.parts} × ${fmt(q / share.parts)}` : '')
  if (!share || n == null || share.kind === 'all' || (share.f != null && share.f < 0.001)) return { qty, note: parts(n) }
  if (share.f == null) return { qty: share.kind === 'some' ? 'a little' : 'the rest', note: `of ${qty}`, vague: share.kind }
  const q = n * share.f
  const note = `${share.kind === 'rest' ? 'the rest' : fracLabel(share.f)} of ${qty}${share.parts ? ` · ${parts(q)}` : ''}`
  return { qty: fmt(q), note }
}

// The amount of one line a step takes according to the plan: all of it, or a share of it —
// "≈ 170 g" with "a part of 860 g" when the method is vague about it.
export function planAmount(l, it) {
  const n = l.p.qty
  if (n == null || it.share >= 0.999) return { qty: l.d.qty, note: '' }
  const unit = String(l.d.qty || '').replace(/^[\d.,/½¼¾⅓⅔⅛\s]+/, '').trim()
  const q = `${fmtQty(n * it.share)}${unit ? ' ' + unit : ''}`
  return it.approx
    ? { qty: `≈ ${q}`, approx: true, note: `a part of ${l.d.qty}` }
    : { qty: q, note: `${fracLabel(it.share)} of ${l.d.qty}` }
}


// Every ingredient line of each recipe (a linked recipe's lines are keyed "<its id>:<index>").
// sources: { [recipe id]: { sections } } — recipeId is the main recipe.
export function buildLines(sources, recipeId) {
  return Object.fromEntries(Object.entries(sources).map(([id, so]) => [
    id,
    so.sections.flatMap((sec, si) => sec.items.map((line, ii) => ({
      si, ri: sec.rawIndices[ii], line, raw: id === recipeId ? sec.rawIndices[ii] : `${id}:${sec.rawIndices[ii]}`, part: sec.name || '', d: splitIngLine(line), p: parseIng(stripRef(line)),
    }))),
  ]))
}

export const stepIndex = (s) => (typeof s.i === 'number' ? s.i : +String(s.i).split(':').pop())

// The ingredient part a step belongs to: "Lievito madre management" is the "Lievito madre —
// single refresh (…)" part — compared without the words around them.
const partKey = (name) => norm(cleanName(name) || name)
export function partIndexOf(s, sections) {
  if (!s?.part) return -1
  const want = partKey(s.part)
  return sections.findIndex((sec) => sec.name && (partKey(sec.name) === want || partKey(sec.name).includes(want) || want.includes(partKey(sec.name))))
}

// Per step (steps: [{ i, text, part, src }]), the lines it uses with the amount it needs:
// [{ raw, d, p, qty, note, vague, approx, made, prep, … }].
export function computeStepUses({ steps, sources, recipeId, plans = {}, linesBySrc = buildLines(sources, recipeId) }) {
  const srcId = (s) => (s?.src && sources[s.src] ? s.src : recipeId)
  const partIndex = (s) => partIndexOf(s, sources[srcId(s)].sections)
  // The ingredients a step uses, with their (scaled) quantities: from its own part when that part
  // has them ("flour" in "First dough" is the first dough's flour), otherwise the line named exactly
  // that ("flour", not "almond flour"), otherwise every candidate with its part's name.
  function usedBy(s) {
    if (!s) return []
    const lines = linesBySrc[srcId(s)] || []
    const groups = new Map()
    const add = (hit, line, full) => {
      if (!groups.has(hit)) groups.set(hit, [])
      const g = groups.get(hit)
      const had = g.find((x) => x.line === line)
      if (had) had.full = had.full || full; else g.push({ line, full })
    }
    mentionedIngredients(s.text, lines.map((l) => l.d.name)).forEach(({ i, hit, full }) => add(hit, lines[i], full))
    const flour = norm(s.text).match(FLOUR_WORD)
    if (flour) {
      const key = [...groups.keys()].find((k) => FLOUR_WORD.test(k)) || flour[1]
      lines.filter((l) => hasFlourWord(l.d.name) && !/\b(almond|hazelnut|pistachio|coconut|rice|corn|chickpea|mandorl|nocciol|almendra|avellana|mandel|hasel)/i.test(l.d.name)).forEach((l) => add(key, l, true))
    }
    const own = partIndex(s)
    const finishing = FINISH_STEP.test(s.text)
    return [...groups.entries()].flatMap(([hit, entries]) => {
      // The whole name beats one of its words; a finishing step takes the lines kept for the end
      // ("icing sugar, to finish"), any other step the ones with a quantity ("60 g icing sugar").
      let g = entries.some((e) => e.full) ? entries.filter((e) => e.full) : entries
      g = g.map((e) => e.line)
      const forEnd = g.filter((l) => FINISH_LINE.test(l.d.name))
      if (finishing && forEnd.length) g = forEnd
      else if (g.some((l) => l.d.qty)) g = g.filter((l) => l.d.qty)
      const mine = g.filter((l) => l.si === own)
      if (mine.length) return mine.map((l) => ({ ...l, hit, showPart: false }))
      const exact = g.filter((l) => ingredientKey(l.d.name) === hit)
      const pick = exact.length ? exact : g
      return pick.map((l) => ({ ...l, hit, showPart: pick.length > 1 }))
    }).sort((a, b) => lines.indexOf(a) - lines.indexOf(b))
  }

  // How much of each ingredient each step uses: "half the cream" is half its grams, "the rest"
  // what earlier steps left — worked out over the whole recipe, in order.
  // With the AI's reading of the method (plans), each step lists what it really takes: lines with
  // their share, and preparations made earlier ("≈ 170 g milk infusion · made in step 2").
  function plannedUses(s, items) {
    const lines = linesBySrc[srcId(s)] || []
    const at = (k) => lines.find((l) => l.ri === k)
    const stepNo = (from) => {
      const p = from == null ? -1 : steps.findIndex((x) => srcId(x) === srcId(s) && stepIndex(x) === from)
      return p >= 0 ? p + 1 : null
    }
    return items.flatMap((it, k) => {
      if (it.kind === 'ing') {
        return it.lines.map(at).filter(Boolean).map((l) => ({ ...l, showPart: false, made: !!(l.d.link || l.d.ref), ...planAmount(l, it) }))
      }
      const ls = it.lines.map(at).filter(Boolean)
      // What went into the preparation: of each line, the share the step that made it took
      // (half the sugar went into the infusion, the other half into the cornstarch mix).
      const plan = plans[srcId(s)] || {}
      const shareIn = (k) => {
        for (let i = it.from ?? -1; i >= 0; i--) {
          const x = (plan[i] || []).find((y) => y.kind === 'ing' && y.lines.includes(k))
          if (x) return x.share || 1
        }
        return 1
      }
      const whole = ls.reduce((g, l) => g + lineGrams(l.line) * shareIn(l.ri), 0)
      const grams = whole * it.share
      const partial = it.share < 0.999
      const from = stepNo(it.from)
      return [{
        raw: `prep:${srcId(s)}:${stepIndex(s)}:${k}`, prep: true, made: true, approx: it.approx || partial,
        d: { name: it.name || ls.map((l) => l.d.name).join(' + '), qty: '' },
        qty: grams > 0 ? `${partial ? '≈ ' : ''}${fmtQty(grams)} g` : '',
        note: [partial ? (it.approx ? 'a part of it' : `${fracLabel(it.share)} of it`) : '', from ? `made in step ${from}` : 'made earlier'].filter(Boolean).join(' · '),
        lines: ls.map((l) => l.raw),
      }]
    })
  }
  const per = steps.map((s) => usedBy(s).map((u) => ({ ...u, portion: portionIn(s.text, u.hit) })))
    const sh = shares(per.map((uses) => uses.map((u) => ({ key: u.raw, portion: u.portion }))))
    return steps.map((s, k) => {
      const plan = plans[srcId(s)]
      if (plan) return plannedUses(s, plan[stepIndex(s)] || [])
      return per[k].filter((u) => sh[k].has(u.raw)).map((u) => ({ ...u, made: !!(u.d.link || u.d.ref), ...amountOf(u, sh[k].get(u.raw)) }))
    })
}
