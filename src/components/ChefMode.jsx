import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ListChecks, ListOrdered, Mic, MicOff, Pause, Play, Timer as TimerIcon, Volume2, VolumeX, X } from 'lucide-react'
import {
  addTime, fmtClock, pauseTimer, remaining, resumeTimer, speak, startTimer, stopRinging, stopSpeaking, useTimers, voiceLang,
} from '../lib/timers.js'
import { splitIngLine } from '../lib/recipeCalc.js'
import { buildLines, computeStepUses, partIndexOf, stepIndex } from '../lib/stepIngredients.js'
import { recordStepTime, typicalMs } from '../lib/timing.js'
import { NextUp, StepClock, StepsRail, highlight } from './ChefPro.jsx'
import { heyChefSupported, setHeyChef, useHeyChef } from '../lib/heychef.js'
import { toast } from './ui/Toaster.jsx'

// Words the guide says, in the recipe's language (the step text is read in it too).
const PHRASES = {
  es: { step: 'Paso', next: 'Siguiente paso', done: 'Receta terminada', need: 'Necesitas', some: "un poco de", rest: 'el resto de', about: 'unos', made: 'Usa lo que preparaste' },
  it: { step: 'Passo', next: 'Passo successivo', done: 'Ricetta finita', need: 'Ti servono', some: "un po' di", rest: 'il resto di', about: 'circa', made: 'Usa quello che hai preparato' },
  en: { step: 'Step', next: 'Next step', done: 'Recipe finished', need: 'You need', some: "a little", rest: 'the rest of the', about: 'about', made: 'Use what you made' },
  fr: { step: 'Étape', next: 'Étape suivante', done: 'Recette terminée', need: 'Il vous faut', some: "un peu de", rest: 'le reste de', about: 'environ', made: 'Utilisez ce que vous avez préparé' },
  de: { step: 'Schritt', next: 'Nächster Schritt', done: 'Rezept fertig', need: 'Du brauchst', some: "etwas", rest: 'den Rest', about: 'etwa', made: 'Nimm, was du vorbereitet hast' },
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
// Chef mode: the recipe one step at a time, full screen. Big text, Next / Back (or swipe), the
// step's timer at hand, and — if wanted — the step read aloud. In a session, Next also ticks the
// step as done. Steps: [{ i, n, text, part, src, srcTitle, info: { label, name, durs, tkey } }] —
// a recipe used inside this one (a Pâte brisée in a Flan) brings its steps, marked by `src` (its
// id) and `srcTitle`; `sources` holds each recipe's ingredient parts: { [id]: { sections } }.
// `plans` holds the AI's reading of each recipe's method (lib/cookPlan.js) by recipe id; a recipe
// without one yet is read from the words of its steps.
// `pro` adds the extras of ChefPro.jsx; `stats` are the learned step times (lib/timing.js) — each
// step's time in chef mode is recorded when it is done (Next), to learn from.
export default function ChefMode({
  title, steps, sections, sources: sourcesProp, plans = {}, planPending = false, lang, timerBase, cook, doneSteps, onTimerOptions, onClose,
  pro = false, stats = null, factor = 1, learn = true, peek = false,
}) {
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
  const linesBySrc = useMemo(() => buildLines(sources, recipeId), [sources, recipeId])
  const partIndex = (s) => partIndexOf(s, sectionsOf(s))
  // How much of each ingredient each step uses (lib/stepIngredients.js).
  const usesPerStep = useMemo(() => computeStepUses({ steps, sources, recipeId, plans, linesBySrc }), [steps, linesBySrc, plans])

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
    // New ingredients are what you need; what earlier steps made (an infusion, a mix, the pâte
    // brisée) is a result to use, not something to fetch.
    const fresh = uses.filter((u) => !u.made), made = uses.filter((u) => u.made)
    const need = `${fresh.length ? ` ${P.need}: ${fresh.map(say).join(', ')}.` : ''}${made.length ? ` ${P.made}: ${made.map(say).join(', ')}.` : ''}`
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
  // When each step was reached, to time it; and when chef mode opened.
  const arrived = useRef({ pos, at: Date.now() })
  const opened = useRef(Date.now())
  useEffect(() => { arrived.current = { pos, at: Date.now() } }, [pos])
  const typicalOf = (s) => (stats ? typicalMs(stats, srcId(s), String(stepIndex(s)), s.text) : null)
  const [rail, setRail] = useState(false)
  // Remember the step; a finished recipe starts from the top next time.
  useEffect(() => {
    saveStep(recipeId, pos >= steps.length ? null : steps[pos])
    if (pos !== start.pos) setResumed(false)
  }, [pos])

  function next() {
    if (finished) { onClose(); return }
    if (learn && arrived.current.pos === pos) {
      recordStepTime({ recipeId: srcId(step), stepKey: stepIndex(step), stepText: step.text, sessionId: cook?.sessionId || null, factor, source: 'chef', startedAt: arrived.current.at, endedAt: Date.now() })
    }
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
      if (pro && (e.key === 'r' || e.key === 'R')) sayStep(pos, true)
      if (pro && (e.key === 's' || e.key === 'S')) setRail((v) => !v)
      if (pro && (e.key === 't' || e.key === 'T')) startStepTimer()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // The step's written time, started from a key or a voice command.
  function startStepTimer() {
    const d = step?.info.durs?.[0]
    if (!d) { onTimerOptions(step); return }
    startTimer({ key: `${step.info.tkey}:${d.ms}`, label: step.info.label, name: step.info.name, duration: d.ms, ...timerBase })
  }
  // Voice: "Hey chef" (components/HeyChef.jsx) sends the step commands here; while chef mode is
  // open they work without "hey chef" too ("next", "back", "repeat", "step 4").
  const hey = useHeyChef()
  const voiceRef = useRef(null)
  voiceRef.current = (d) => {
    if (d.intent === 'chef-next') next()
    else if (d.intent === 'chef-back') back()
    else if (d.intent === 'chef-repeat') sayStep(pos, true)
    else if (d.intent === 'chef-goto') setPos(Math.max(0, Math.min(steps.length - 1, (d.n || 1) - 1)))
    else if (d.intent === 'chef-close') onClose()
    else if (d.intent === 'chef-timer') startStepTimer()
    else if (d.intent === 'chef-open') { /* already open */ } else return
    d.handled = true
  }
  useEffect(() => {
    setHeyChef({ chefOpen: true })
    const on = (e) => voiceRef.current?.(e.detail)
    window.addEventListener('qdplus:voice', on)
    return () => { window.removeEventListener('qdplus:voice', on); setHeyChef({ chefOpen: false }) }
  }, [])

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
        {pro && (
          <button className={`Q-icon-btn${rail ? ' on' : ''}`} onClick={() => setRail((v) => !v)} title="All the steps (S)" aria-label="All the steps" aria-pressed={rail}><ListOrdered size={19} /></button>
        )}
        {pro && heyChefSupported() && (
          <button
            className={`Q-icon-btn${hey.on ? ' on' : ''}${hey.awake ? ' heard' : ''}`} onClick={() => setHeyChef({ on: !hey.on })}
            title={hey.on ? 'Listening: say “next”, “back”, “repeat”, “step 4” — or “Hey chef…” for anything' : 'Hands-free: control it with your voice'} aria-pressed={hey.on}
            aria-label={hey.on ? 'Stop listening' : 'Control with your voice'}
          >
            {hey.on ? <Mic size={19} /> : <MicOff size={19} />}
          </button>
        )}
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

      <div className={`Q-chef-body${showIngs ? ' with-ings' : ''}${pro && rail ? ' with-rail' : ''}`}>
        {pro && rail && (
          <StepsRail steps={steps} pos={pos} done={cook ? doneSteps : new Set()} typicalOf={typicalOf} onClose={() => setRail(false)} onJump={(k) => { setPos(k); if (!wide()) setRail(false) }} />
        )}
        <div className="Q-chef-main">
        {finished ? (
          <div className="Q-chef-step done">
            <div className="Q-chef-text">All steps done.</div>
          </div>
        ) : (
          <div className="Q-chef-step">
            {(step.srcTitle || step.part) && <div className="Q-chef-part">{step.srcTitle && <span className="Q-chef-src">{step.srcTitle}</span>}{step.srcTitle && step.part ? ' · ' : ''}{step.part}</div>}
            <button type="button" className="Q-chef-text" onClick={() => { if (!swiped.current) sayStep(pos, true) }} title="Read it aloud">{pro ? highlight(step.text) : step.text}</button>
            {pro && <StepClock since={arrived.current.pos === pos ? arrived.current.at : Date.now()} typical={typicalOf(step)} total={opened.current} />}
            {[['fresh', uses.filter((u) => !u.made)], ['made', uses.filter((u) => u.made)]].map(([kind, list]) => list.length > 0 && (
              <ul key={kind} className={`Q-chef-uses ${kind}`} aria-label={kind === 'made' ? 'Made in earlier steps' : 'Ingredients for this step'}>
                {kind === 'made' && <li className="Q-chef-uses-label" aria-hidden="true">Made earlier</li>}
                {list.map((u) => (
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
            ))}
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
            {peek && steps.slice(pos + 1, pos + 3).length > 0 && (
              <div className="Q-chef-peek" aria-label="Coming steps">
                {steps.slice(pos + 1, pos + 3).map((s, k) => (
                  <button type="button" key={k} className={`p${k}`} onClick={() => setPos(pos + 1 + k)} title="Go to this step">
                    <span className="n">{pos + 2 + k}</span>{s.srcTitle ? `${s.srcTitle} · ` : ''}{s.text}
                  </button>
                ))}
              </div>
            )}
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

      {pro && !finished && <NextUp steps={steps} pos={pos} typicalOf={typicalOf} />}
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
