import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ListChecks, Pause, Play, Timer as TimerIcon, Volume2, VolumeX, X } from 'lucide-react'
import {
  addTime, fmtClock, pauseTimer, remaining, resumeTimer, speak, startTimer, stopRinging, stopSpeaking, useTimers, voiceLang,
} from '../lib/timers.js'
import { cleanName, ingredientKey, mentionedIngredients } from '../lib/timerNames.js'
import { splitIngLine } from '../lib/recipeCalc.js'
import { hasFlourWord } from '../lib/constants.js'

// Words the guide says, in the recipe's language (the step text is read in it too).
const PHRASES = {
  es: { step: 'Paso', next: 'Siguiente paso', done: 'Receta terminada', need: 'Necesitas' },
  it: { step: 'Passo', next: 'Passo successivo', done: 'Ricetta finita', need: 'Ti servono' },
  en: { step: 'Step', next: 'Next step', done: 'Recipe finished', need: 'You need' },
  fr: { step: 'Étape', next: 'Étape suivante', done: 'Recette terminée', need: 'Il vous faut' },
  de: { step: 'Schritt', next: 'Nächster Schritt', done: 'Rezept fertig', need: 'Du brauchst' },
}
const VOICE_KEY = 'qdplus_chef_voice'
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

// Chef mode: the recipe one step at a time, full screen. Big text, Next / Back (or swipe), the
// step's timer at hand, and — if wanted — the step read aloud. In a session, Next also ticks the
// step as done. Steps: [{ i, n, text, part, info: { label, name, durs, tkey } }].
export default function ChefMode({ title, steps, sections, lang, timerBase, cook, doneSteps, onTimerOptions, onClose }) {
  const first = cook ? steps.findIndex((s) => !doneSteps.has(s.i)) : 0
  const [pos, setPos] = useState(first < 0 ? steps.length : first) // steps.length = finished
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

  // Every ingredient line of the recipe, and the part a step belongs to.
  const lines = sections.flatMap((sec, si) => sec.items.map((line, ii) => ({ si, raw: sec.rawIndices[ii], part: sec.name || '', d: splitIngLine(line) })))
  // The ingredient part a step belongs to: "Lievito madre management" is the "Lievito madre —
  // single refresh (…)" part — compared without the words around them.
  const partKey = (name) => norm(cleanName(name) || name)
  const partIndex = (s) => {
    if (!s?.part) return -1
    const want = partKey(s.part)
    return sections.findIndex((sec) => sec.name && (partKey(sec.name) === want || partKey(sec.name).includes(want) || want.includes(partKey(sec.name))))
  }
  // The ingredients a step uses, with their (scaled) quantities: from its own part when that part
  // has them ("flour" in "First dough" is the first dough's flour), otherwise the line named exactly
  // that ("flour", not "almond flour"), otherwise every candidate with its part's name.
  function usedBy(s) {
    if (!s) return []
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
      if (mine.length) return mine.map((l) => ({ ...l, showPart: false }))
      const exact = g.filter((l) => ingredientKey(l.d.name) === hit)
      const pick = exact.length ? exact : g
      return pick.map((l) => ({ ...l, showPart: pick.length > 1 }))
    }).sort((a, b) => a.raw - b.raw)
  }

  // What to say on arriving at a step: its number, the part when a new one starts, the text, and
  // how much of each ingredient it uses ("Necesitas: 1 cebolla blanca mediana").
  function sayStep(p, force = false) {
    if (!(voiceOn || force)) return
    const s = steps[p]
    if (!s) { speak(P.done, lang, { interrupt: true }); return }
    const newPart = s.part && (p === 0 || steps[p - 1]?.part !== s.part)
    // Every ingredient the step uses — also those "a gusto", which have no quantity.
    const uses = usedBy(s).slice(0, 8)
    const need = uses.length ? ` ${P.need}: ${uses.map((u) => [u.d.qty, u.d.name].filter(Boolean).join(' ')).join(', ')}.` : ''
    speak(`${P.step} ${s.n}. ${newPart ? `${s.part}. ` : ''}${s.text}${need}`, lang, { interrupt: true })
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
  const stepOfTimer = (t) => {
    const m = String(t.key || '').match(/:step:(\d+)/)
    return m ? steps.findIndex((s) => s.i === +m[1]) : -1
  }
  const stepTimers = step ? timers.filter((t) => ofStep(t.key, step.info.tkey) && t.state !== 'idle') : []

  const uses = usedBy(step)
  const usedRaw = new Set(uses.map((u) => u.raw))
  const currentPart = partIndex(step)
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
          <span>{finished ? 'All steps done' : `Step ${step.n} of ${steps[steps.length - 1]?.n || steps.length}`}</span>
        </div>
        <button className={`Q-icon-btn${voiceOn ? ' on' : ''}`} onClick={toggleVoice} title={voiceOn ? 'Voice on: steps are read aloud' : 'Voice off'} aria-label={voiceOn ? 'Turn the voice off' : 'Read the steps aloud'}>
          {voiceOn ? <Volume2 size={19} /> : <VolumeX size={19} />}
        </button>
        {sections.length > 0 && (
          <button className={`Q-icon-btn${showIngs ? ' on' : ''}`} onClick={toggleIngs} title="All the ingredients" aria-label="All the ingredients" aria-pressed={showIngs}><ListChecks size={19} /></button>
        )}
        <button className="Q-icon-btn" onClick={onClose} aria-label="Close chef mode"><X size={20} /></button>
      </div>
      <div className="Q-chef-bar"><i style={{ width: `${progress}%` }} /></div>

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
            {step.part && <div className="Q-chef-part">{step.part}</div>}
            <button type="button" className="Q-chef-text" onClick={() => { if (!swiped.current) sayStep(pos, true) }} title="Read it aloud">{step.text}</button>
            {uses.length > 0 && (
              <ul className="Q-chef-uses" aria-label="Ingredients for this step">
                {uses.map((u) => (
                  <li key={u.raw} className={ticked.has(u.raw) ? 'ticked' : ''} onClick={() => toggleTick(u.raw)}>
                    <span className="Q-ing-check" aria-hidden="true" />
                    {u.d.qty && <b>{u.d.qty}</b>}
                    <span>{u.d.ref ? '↳ ' : ''}{u.d.name}{u.showPart && u.part && <em> · {u.part}</em>}</span>
                  </li>
                ))}
              </ul>
            )}
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
              <button className="Q-chef-more" onClick={() => onTimerOptions(step.i)}><TimerIcon size={15} /> {step.info.durs.length ? 'Other timer' : 'Timer'}</button>
            </div>
          </div>
        )}
        </div>
        {showIngs && (
          <aside className="Q-chef-ings" ref={ingsRef} aria-label="All the ingredients">
            {sections.map((sec, si) => (
              <div key={si} className={`Q-chef-ings-part${si === currentPart ? ' current' : ''}`}>
                {sec.name && <div className="Q-chef-part">{sec.name}</div>}
                <ul>
                  {sec.items.map((line, ii) => {
                    const raw = sec.rawIndices[ii]
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
