import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ListChecks, Pause, Play, Timer as TimerIcon, Volume2, VolumeX, X } from 'lucide-react'
import {
  addTime, fmtClock, pauseTimer, remaining, resumeTimer, speak, startTimer, stopRinging, stopSpeaking, useTimers, voiceLang,
} from '../lib/timers.js'
import { cleanName, ingredientKey, mentionedIngredients } from '../lib/timerNames.js'
import { fmtQty, lineGrams, parseIng, splitIngLine, stripRef } from '../lib/recipeCalc.js'
import { fracLabel, portionIn, shares } from '../lib/portions.js'
import { hasFlourWord } from '../lib/constants.js'

// Words the guide says, in the recipe's language (the step text is read in it too).
const PHRASES = {
  es: { step: 'Paso', next: 'Siguiente paso', done: 'Receta terminada', need: 'Necesitas', some: "un poco de", rest: 'el resto de', about: 'unos' },
  it: { step: 'Passo', next: 'Passo successivo', done: 'Ricetta finita', need: 'Ti servono', some: "un po' di", rest: 'il resto di', about: 'circa' },
  en: { step: 'Step', next: 'Next step', done: 'Recipe finished', need: 'You need', some: "a little", rest: 'the rest of the', about: 'about' },
  fr: { step: 'Étape', next: 'Étape suivante', done: 'Recette terminée', need: 'Il vous faut', some: "un peu de", rest: 'le reste de', about: 'environ' },
  de: { step: 'Schritt', next: 'Nächster Schritt', done: 'Rezept fertig', need: 'Du brauchst', some: "etwas", rest: 'den Rest', about: 'etwa' },
}
const VOICE_KEY = 'qdplus_chef_voice'
// The step each recipe was left on, so chef mode reopens there: { [recipeId]: { i, t, at } }
// (i = the step's line, t = the start of its text, to find it again after an edit).
const POS_KEY = 'qdplus_chef_pos'
const readAllPos = () => { try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {} } catch (_) { return {} } }
function savedStep(recipeId, steps) {
  const p = readAllPos()[recipeId]
  if (!p) return -1
  const same = steps.findIndex((s) => s.i === p.i && s.text.slice(0, 40) === p.t)
  if (same >= 0) return same
  const byText = p.t ? steps.findIndex((s) => s.text.slice(0, 40) === p.t) : -1
  return byText >= 0 ? byText : steps.findIndex((s) => s.i === p.i)
}
function saveStep(recipeId, step) {
  try {
    const all = readAllPos()
    if (step) all[recipeId] = { i: step.i, t: step.text.slice(0, 40), at: Date.now() }
    else delete all[recipeId]
    // The 40 most recent recipes are plenty.
    const keep = Object.entries(all).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 40)
    localStorage.setItem(POS_KEY, JSON.stringify(Object.fromEntries(keep)))
  } catch (_) { /* storage unavailable */ }
}
// The whole ingredient list: beside the step on wide screens (open unless closed), below it on
// phones (closed unless opened) — each remembered separately.
const INGS_KEY = () => (wide() ? 'qdplus_chef_ings' : 'qdplus_chef_ings_phone')
const wide = () => window.matchMedia('(min-width: 900px)').matches
// A timer belongs to a step if its key is the step's, or the step's plus a duration.
const ofStep = (key, tkey) => key === tkey || String(key || '').startsWith(`${tkey}:`)
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
// Lines kept for the end ("icing sugar, to finish"), and steps that do the finishing.
const FINISH_LINE = /\b(to finish|for finishing|to serve|for dusting|to dust|to garnish|to decorate|para decorar|para terminar|al servir|para servir|per finire|per decorare|per servire|pour finir|pour décorer|pour servir|zum bestreuen|zum garnieren|zum servieren)\b/i
const FINISH_STEP = /\b(top|tops|topping|finish|dust|sprinkle|decorate|garnish|serve|espolvorear|espolvorea|decorar|decora|terminar|servir|spolverare|spolverizzare|decorare|guarnire|cospargere|saupoudrer|décorer|garnir|servir|bestreuen|garnieren|verzieren)\b/i
// "flour" in a step means the flour of that part, whatever its name ("Caputo Manitoba Oro").
const FLOUR_WORD = /\b(flours?|farina|farine|harinas?|mehl|semola|semolina)\b/

// The amount a step needs of one ingredient line, from its share of the line (see portions.js):
// { qty, note, vague } — "100 g" with "½ of 200 g", "the rest" with "of 200 g" when unknown.
function amountOf(u, share) {
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
function planAmount(l, it) {
  const n = l.p.qty
  if (n == null || it.share >= 0.999) return { qty: l.d.qty, note: '' }
  const unit = String(l.d.qty || '').replace(/^[\d.,/½¼¾⅓⅔⅛\s]+/, '').trim()
  const q = `${fmtQty(n * it.share)}${unit ? ' ' + unit : ''}`
  return it.approx
    ? { qty: `≈ ${q}`, approx: true, note: `a part of ${l.d.qty}` }
    : { qty: q, note: `${fracLabel(it.share)} of ${l.d.qty}` }
}

// Chef mode: the recipe one step at a time, full screen. Big text, Next / Back (or swipe), the
// step's timer at hand, and — if wanted — the step read aloud. In a session, Next also ticks the
// step as done. Steps: [{ i, n, text, part, src, srcTitle, info: { label, name, durs, tkey } }] —
// a recipe used inside this one (a Pâte brisée in a Flan) brings its steps, marked by `src` (its
// id) and `srcTitle`; `sources` holds each recipe's ingredient parts: { [id]: { sections } }.
// `plans` holds the AI's reading of each recipe's method (lib/cookPlan.js) by recipe id; a recipe
// without one yet is read from the words of its steps.
export default function ChefMode({ title, steps, sections, sources: sourcesProp, plans = {}, planPending = false, lang, timerBase, cook, doneSteps, onTimerOptions, onClose }) {
  // Back where the recipe was left; otherwise the first step (in a session, the first not done).
  const [start] = useState(() => {
    const saved = savedStep(timerBase.recipeId, steps)
    if (saved >= 0) return { pos: saved, resumed: saved > 0 }
    const first = cook ? steps.findIndex((s) => !doneSteps.has(s.i)) : 0
    return { pos: first < 0 ? steps.length : first, resumed: false }
  })
  const [pos, setPos] = useState(start.pos) // steps.length = finished
  const [resumed, setResumed] = useState(start.resumed)
  const [voiceOn, setVoiceOn] = useState(() => { try { return localStorage.getItem(VOICE_KEY) === 'on' } catch (_) { return false } })
  const [showIngs, setShowIngs] = useState(() => {
    try { const v = localStorage.getItem(INGS_KEY()); return v ? v === 'on' : wide() } catch (_) { return wide() }
  })
  const [localTicks, setLocalTicks] = useState(() => new Set()) // mise en place outside a session
  const ingsRef = useRef(null)
  const [nudge, setNudge] = useState(false) // a timer of this step ended: time to move on
  const { timers, now } = useTimers()
  const P = PHRASES[(lang || 'en').slice(0, 2)] || PHRASES.en
  const step = steps[pos] || null
  const finished = pos >= steps.length
  const recipeId = timerBase.recipeId
  const sources = sourcesProp || { [recipeId]: { title: '', sections } }
  const srcId = (s) => (s?.src && sources[s.src] ? s.src : recipeId)
  const sectionsOf = (s) => sources[srcId(s)].sections

  // Every ingredient line of each recipe (a linked recipe's lines are keyed "<its id>:<index>").
  const linesBySrc = useMemo(() => Object.fromEntries(Object.entries(sources).map(([id, so]) => [
    id,
    so.sections.flatMap((sec, si) => sec.items.map((line, ii) => ({
      si, ri: sec.rawIndices[ii], line, raw: id === recipeId ? sec.rawIndices[ii] : `${id}:${sec.rawIndices[ii]}`, part: sec.name || '', d: splitIngLine(line), p: parseIng(stripRef(line)),
    }))),
  ])), [sources, recipeId])
  // The ingredient part a step belongs to: "Lievito madre management" is the "Lievito madre —
  // single refresh (…)" part — compared without the words around them.
  const partKey = (name) => norm(cleanName(name) || name)
  const partIndex = (s) => {
    if (!s?.part) return -1
    const want = partKey(s.part)
    return sectionsOf(s).findIndex((sec) => sec.name && (partKey(sec.name) === want || partKey(sec.name).includes(want) || want.includes(partKey(sec.name))))
  }
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
  const stepIndex = (s) => (typeof s.i === 'number' ? s.i : +String(s.i).split(':').pop())
  function plannedUses(s, items) {
    const lines = linesBySrc[srcId(s)] || []
    const at = (k) => lines.find((l) => l.ri === k)
    const stepNo = (from) => {
      const p = from == null ? -1 : steps.findIndex((x) => srcId(x) === srcId(s) && stepIndex(x) === from)
      return p >= 0 ? p + 1 : null
    }
    return items.flatMap((it, k) => {
      if (it.kind === 'ing') {
        return it.lines.map(at).filter(Boolean).map((l) => ({ ...l, showPart: false, ...planAmount(l, it) }))
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
        raw: `prep:${srcId(s)}:${stepIndex(s)}:${k}`, prep: true, approx: it.approx || partial,
        d: { name: it.name || ls.map((l) => l.d.name).join(' + '), qty: '' },
        qty: grams > 0 ? `${partial ? '≈ ' : ''}${fmtQty(grams)} g` : '',
        note: [partial ? (it.approx ? 'a part of it' : `${fracLabel(it.share)} of it`) : '', from ? `made in step ${from}` : 'made earlier'].filter(Boolean).join(' · '),
        lines: ls.map((l) => l.raw),
      }]
    })
  }
  const usesPerStep = useMemo(() => {
    const per = steps.map((s) => usedBy(s).map((u) => ({ ...u, portion: portionIn(s.text, u.hit) })))
    const sh = shares(per.map((uses) => uses.map((u) => ({ key: u.raw, portion: u.portion }))))
    return steps.map((s, k) => {
      const plan = plans[srcId(s)]
      if (plan) return plannedUses(s, plan[stepIndex(s)] || [])
      return per[k].filter((u) => sh[k].has(u.raw)).map((u) => ({ ...u, ...amountOf(u, sh[k].get(u.raw)) }))
    })
  }, [steps, linesBySrc, plans])

  // What to say on arriving at a step: its number, the part when a new one starts, the text, and
  // how much of each ingredient it uses ("Necesitas: 1 cebolla blanca mediana").
  function sayStep(p, force = false) {
    if (!(voiceOn || force)) return
    const s = steps[p]
    if (!s) { speak(P.done, lang, { interrupt: true }); return }
    const where = (x) => [x?.srcTitle, x?.part].filter(Boolean).join('. ')
    const newPart = where(s) && (p === 0 || where(steps[p - 1]) !== where(s))
    // Every ingredient the step uses — also those "a gusto", which have no quantity — in the
    // amount this step needs ("100 g crema" for half of it, "el resto de crema").
    const uses = (usesPerStep[p] || []).slice(0, 8)
    const say = (u) => {
      if (u.vague) return `${u.vague === 'some' ? P.some : P.rest} ${u.d.name}`
      if (u.prep && !u.approx) return u.d.name // "the cornstarch and cream mix": all of it, no weight to say
      const q = String(u.qty || '').replace(/^≈\s*/, '')
      return [q && u.approx ? `${P.about} ${q}` : q, u.d.name].filter(Boolean).join(' ')
    }
    const need = uses.length ? ` ${P.need}: ${uses.map(say).join(', ')}.` : ''
    const text = /[.!?…:]$/.test(s.text.trim()) ? s.text.trim() : `${s.text.trim()}.` // a pause before "Necesitas"
    speak(`${P.step} ${s.n}. ${newPart ? `${where(s)}. ` : ''}${text}${need}`, lang, { interrupt: true })
  }
  useEffect(() => { sayStep(pos) }, [pos, voiceOn])
  useEffect(() => () => stopSpeaking(), [])

  // Keep the screen on while guiding.
  useEffect(() => {
    let lock = null
    const get = () => navigator.wakeLock?.request('screen').then((l) => { lock = l }).catch(() => {})
    get()
    const onVis = () => { if (document.visibilityState === 'visible') get() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release?.() }
  }, [])

  // A timer of this step ends: after its name (said by the timer), say "next step".
  const ringingKeys = timers.filter((t) => t.ringing).map((t) => t.key || '').join('|')
  const prevRinging = useRef('')
  useEffect(() => {
    const before = prevRinging.current
    prevRinging.current = ringingKeys
    if (!step || !ringingKeys) return
    const mine = ringingKeys.split('|').some((k) => ofStep(k, step.info.tkey) && !before.split('|').includes(k))
    if (mine) {
      setNudge(true)
      // Right after the timer said its name, in the same voice and language: "Lievito madre. Siguiente paso."
      const vl = voiceLang(null)
      if (voiceOn) speak((PHRASES[vl.slice(0, 2)] || PHRASES.en).next, vl)
    }
  }, [ringingKeys])
  useEffect(() => { setNudge(false) }, [pos])
  // Remember the step; a finished recipe starts from the top next time.
  useEffect(() => {
    saveStep(recipeId, pos >= steps.length ? null : steps[pos])
    if (pos !== start.pos) setResumed(false)
  }, [pos])

  function next() {
    if (finished) { onClose(); return }
    if (cook && !doneSteps.has(step.i)) cook.onToggleStep(step.i)
    timers.filter((t) => t.ringing && ofStep(t.key, step.info.tkey)).forEach((t) => stopRinging(t.id))
    setPos((p) => Math.min(p + 1, steps.length))
  }
  const back = () => setPos((p) => Math.max(0, p - 1))

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // Swipe left for the next step, right for the previous one.
  // (Also over the step text, which reads itself aloud on a tap — but not after a swipe.)
  const swipe = useRef(null)
  const swiped = useRef(false)
  const onPointerDown = (e) => { swipe.current = { x: e.clientX, y: e.clientY } }
  const onPointerUp = (e) => {
    const s = swipe.current
    swipe.current = null
    if (!s || e.target.closest('button:not(.Q-chef-text)')) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (Math.abs(dx) > 70 && Math.abs(dy) < 60) {
      swiped.current = true
      setTimeout(() => { swiped.current = false }, 350)
      if (dx < 0) next(); else back()
    }
  }

  const ticked = cook ? new Set(cook.progress?.ing || []) : localTicks
  function toggleTick(raw) {
    if (cook) { cook.onToggleIng(raw); return }
    setLocalTicks((prev) => { const n = new Set(prev); if (n.has(raw)) n.delete(raw); else n.add(raw); return n })
  }
  function toggleIngs() {
    const on = !showIngs
    setShowIngs(on)
    try { localStorage.setItem(INGS_KEY(), on ? 'on' : 'off') } catch (_) { /* ignore */ }
  }

  function toggleVoice() {
    const on = !voiceOn
    setVoiceOn(on)
    try { localStorage.setItem(VOICE_KEY, on ? 'on' : 'off') } catch (_) { /* ignore */ }
    if (!on) stopSpeaking()
  }

  // This recipe's timers that are running, to jump to their step.
  const running = timers.filter((t) => t.recipeId === recipeId && (t.state === 'running' || t.ringing))
  const stepOfTimer = (t) => steps.findIndex((s) => ofStep(t.key, s.info.tkey))
  const stepTimers = step ? timers.filter((t) => ofStep(t.key, step.info.tkey) && t.state !== 'idle') : []

  const uses = usesPerStep[pos] || []
  const usedRaw = new Set(uses.filter((u) => !u.prep).map((u) => u.raw))
  const currentPart = partIndex(step)
  const panelSrc = srcId(step || steps[steps.length - 1])
  const panelSections = sources[panelSrc].sections
  const panelKey = (sec, ii) => (panelSrc === recipeId ? sec.rawIndices[ii] : `${panelSrc}:${sec.rawIndices[ii]}`)
  // The full list follows the step: its ingredients highlighted and scrolled into view.
  // (The part's title goes to the top of the list, so all of the step's ingredients show below it.)
  useEffect(() => {
    const list = ingsRef.current
    if (!showIngs || !list) return
    const first = list.querySelector('li.used')
    const part = first?.closest('.Q-chef-ings-part') || list.querySelector('.Q-chef-ings-part.current')
    const target = part || first
    if (!target) return
    const top = target.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 6
    list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [pos, showIngs])

  const progress = steps.length ? Math.min(100, (pos / steps.length) * 100) : 100
  const host = document.querySelector('.Q') || document.body
  return createPortal(
    <div className="Q-chef" role="dialog" aria-label={`Chef mode: ${title}`} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="Q-chef-top">
        <div className="Q-chef-title">
          <b>{title}</b>
          <span>{finished ? 'All steps done' : `Step ${pos + 1} of ${steps.length}`}</span>
        </div>
        <button className={`Q-icon-btn${voiceOn ? ' on' : ''}`} onClick={toggleVoice} title={voiceOn ? 'Voice on: steps are read aloud' : 'Voice off'} aria-label={voiceOn ? 'Turn the voice off' : 'Read the steps aloud'}>
          {voiceOn ? <Volume2 size={19} /> : <VolumeX size={19} />}
        </button>
        {Object.values(sources).some((so) => so.sections.some((sec) => sec.items.length)) && (
          <button className={`Q-icon-btn${showIngs ? ' on' : ''}`} onClick={toggleIngs} title="All the ingredients" aria-label="All the ingredients" aria-pressed={showIngs}><ListChecks size={19} /></button>
        )}
        <button className="Q-icon-btn" onClick={onClose} aria-label="Close chef mode"><X size={20} /></button>
      </div>
      <div className="Q-chef-bar"><i style={{ width: `${progress}%` }} /></div>
      {resumed && !finished && (
        <div className="Q-chef-resume">
          <span>Back where you left off</span>
          <button type="button" onClick={() => setPos(0)}>Start over</button>
        </div>
      )}

      {running.length > 0 && (
        <div className="Q-chef-timers">
          {running.map((t) => {
            const at = stepOfTimer(t)
            return (
              <button key={t.id} className={`Q-tchip running${t.ringing ? ' ringing' : ''}`} onClick={() => { if (at >= 0) setPos(at); else if (t.ringing) stopRinging(t.id) }} title={t.label}>
                <TimerIcon size={12} />{t.name || t.label} · {t.ringing ? 'Time’s up' : fmtClock(remaining(t, now))}
              </button>
            )
          })}
        </div>
      )}

      <div className={`Q-chef-body${showIngs ? ' with-ings' : ''}`}>
        <div className="Q-chef-main">
        {finished ? (
          <div className="Q-chef-step done">
            <div className="Q-chef-text">All steps done.</div>
          </div>
        ) : (
          <div className="Q-chef-step">
            {(step.srcTitle || step.part) && <div className="Q-chef-part">{step.srcTitle && <span className="Q-chef-src">{step.srcTitle}</span>}{step.srcTitle && step.part ? ' · ' : ''}{step.part}</div>}
            <button type="button" className="Q-chef-text" onClick={() => { if (!swiped.current) sayStep(pos, true) }} title="Read it aloud">{step.text}</button>
            {uses.length > 0 && (
              <ul className="Q-chef-uses" aria-label="Ingredients for this step">
                {uses.map((u) => (
                  <li key={u.raw} className={`${ticked.has(u.raw) ? 'ticked' : ''}${u.prep ? ' prep' : ''}`} onClick={() => { if (!u.prep) toggleTick(u.raw) }}>
                    {u.prep ? <span className="Q-chef-prep-mark" aria-hidden="true">↳</span> : <span className="Q-ing-check" aria-hidden="true" />}
                    {u.qty && <b className={u.vague ? 'vague' : ''}>{u.qty}</b>}
                    <span>
                      {u.d.ref ? '↳ ' : ''}{u.d.name}{u.showPart && u.part && <em> · {u.part}</em>}
                      {u.note && <small className="Q-chef-portion">{u.note}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {planPending && !plans[srcId(step)] && <div className="Q-chef-reading">Reading the method to work out the amounts…</div>}
            <div className="Q-chef-actions">
              {stepTimers.filter((t) => t.state !== 'done').map((t) => (
                <div key={t.id} className={`Q-chef-clock${t.ringing ? ' ringing' : ''}`}>
                  <span className="n">{t.name}</span>
                  <b>{t.ringing ? 'Time’s up' : fmtClock(remaining(t, now))}</b>
                  {t.state === 'running' && <button onClick={() => pauseTimer(t.id)} aria-label="Pause"><Pause size={16} /></button>}
                  {t.state === 'paused' && <button onClick={() => resumeTimer(t.id)} aria-label="Resume"><Play size={16} /></button>}
                  {!t.ringing && <button onClick={() => addTime(t.id, 60000)}>+1 min</button>}
                  {t.ringing && <button onClick={() => stopRinging(t.id)}>Stop</button>}
                </div>
              ))}
              {step.info.durs.filter((d) => !stepTimers.some((t) => t.key === `${step.info.tkey}:${d.ms}` && t.state !== 'done')).map((d) => (
                <button
                  key={d.ms} className="Q-chef-start"
                  onClick={() => startTimer({ key: `${step.info.tkey}:${d.ms}`, label: step.info.label, name: step.info.name, duration: d.ms, ...timerBase })}
                >
                  <TimerIcon size={17} /> Start {d.label}
                </button>
              ))}
              <button className="Q-chef-more" onClick={() => onTimerOptions(step)}><TimerIcon size={15} /> {step.info.durs.length ? 'Other timer' : 'Timer'}</button>
            </div>
          </div>
        )}
        </div>
        {showIngs && (
          <aside className="Q-chef-ings" ref={ingsRef} aria-label="All the ingredients">
            {panelSrc !== recipeId && <div className="Q-chef-ings-src">{sources[panelSrc].title}</div>}
            {panelSections.map((sec, si) => (
              <div key={si} className={`Q-chef-ings-part${si === currentPart ? ' current' : ''}`}>
                {sec.name && <div className="Q-chef-part">{sec.name}</div>}
                <ul>
                  {sec.items.map((line, ii) => {
                    const raw = panelKey(sec, ii)
                    const d = splitIngLine(line)
                    return (
                      <li key={ii} className={`${usedRaw.has(raw) ? 'used' : ''}${ticked.has(raw) ? ' ticked' : ''}`} onClick={() => toggleTick(raw)}>
                        <span className="Q-ing-check" aria-hidden="true" />
                        <b>{d.qty}</b>
                        <span>{d.ref ? '↳ ' : ''}{d.name}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </aside>
        )}
      </div>

      <div className="Q-chef-nav">
        <button className="back" onClick={back} disabled={pos === 0}><ChevronLeft size={22} /> Back</button>
        <button className={`next${nudge ? ' nudge' : ''}`} onClick={next}>
          {finished ? 'Close' : pos === steps.length - 1 ? 'Finish' : 'Next step'} {!finished && <ChevronRight size={22} />}
        </button>
      </div>
    </div>,
    host,
  )
}
