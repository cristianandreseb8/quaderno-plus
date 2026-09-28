import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ListChecks, Pause, Play, Timer as TimerIcon, Volume2, VolumeX, X } from 'lucide-react'
import {
  addTime, fmtClock, pauseTimer, remaining, resumeTimer, speak, startTimer, stopRinging, stopSpeaking, useTimers, voiceLang,
} from '../lib/timers.js'

// Words the guide says, in the recipe's language (the step text is read in it too).
const PHRASES = {
  es: { step: 'Paso', next: 'Siguiente paso', done: 'Receta terminada' },
  it: { step: 'Passo', next: 'Passo successivo', done: 'Ricetta finita' },
  en: { step: 'Step', next: 'Next step', done: 'Recipe finished' },
  fr: { step: 'Étape', next: 'Étape suivante', done: 'Recette terminée' },
  de: { step: 'Schritt', next: 'Nächster Schritt', done: 'Rezept fertig' },
}
const VOICE_KEY = 'qdplus_chef_voice'
// A timer belongs to a step if its key is the step's, or the step's plus a duration.
const ofStep = (key, tkey) => key === tkey || String(key || '').startsWith(`${tkey}:`)
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

// Chef mode: the recipe one step at a time, full screen. Big text, Next / Back (or swipe), the
// step's timer at hand, and — if wanted — the step read aloud. In a session, Next also ticks the
// step as done. Steps: [{ i, n, text, part, info: { label, name, durs, tkey } }].
export default function ChefMode({ title, steps, sections, lang, timerBase, cook, doneSteps, onTimerOptions, onClose }) {
  const first = cook ? steps.findIndex((s) => !doneSteps.has(s.i)) : 0
  const [pos, setPos] = useState(first < 0 ? steps.length : first) // steps.length = finished
  const [voiceOn, setVoiceOn] = useState(() => { try { return localStorage.getItem(VOICE_KEY) === 'on' } catch (_) { return false } })
  const [showIngs, setShowIngs] = useState(false)
  const [nudge, setNudge] = useState(false) // a timer of this step ended: time to move on
  const { timers, now } = useTimers()
  const P = PHRASES[(lang || 'en').slice(0, 2)] || PHRASES.en
  const step = steps[pos] || null
  const finished = pos >= steps.length
  const recipeId = timerBase.recipeId

  // What to say on arriving at a step: its number, the part when a new one starts, the text.
  function sayStep(p, force = false) {
    if (!(voiceOn || force)) return
    const s = steps[p]
    if (!s) { speak(P.done, lang, { interrupt: true }); return }
    const newPart = s.part && (p === 0 || steps[p - 1]?.part !== s.part)
    speak(`${P.step} ${s.n}. ${newPart ? `${s.part}. ` : ''}${s.text}`, lang, { interrupt: true })
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

  // The ingredients of the part this step belongs to (all of them if no part matches).
  const partSection = step && sections.find((sec) => sec.name && step.part && (norm(sec.name).includes(norm(step.part)) || norm(step.part).includes(norm(sec.name))))
  const shownSections = partSection ? [partSection] : sections

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
          <button className={`Q-icon-btn${showIngs ? ' on' : ''}`} onClick={() => setShowIngs(!showIngs)} title="Ingredients" aria-label="Ingredients"><ListChecks size={19} /></button>
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

      <div className="Q-chef-body">
        {showIngs && (
          <div className="Q-chef-ings">
            {shownSections.map((sec, si) => (
              <div key={si}>
                {sec.name && <div className="Q-chef-part">{sec.name}</div>}
                <ul>{sec.items.map((line, li) => <li key={li}>{String(line).replace(/^\s*(→|->)\s*/, '↳ ')}</li>)}</ul>
              </div>
            ))}
          </div>
        )}
        {finished ? (
          <div className="Q-chef-step done">
            <div className="Q-chef-text">All steps done.</div>
          </div>
        ) : (
          <div className="Q-chef-step">
            {step.part && <div className="Q-chef-part">{step.part}</div>}
            <button type="button" className="Q-chef-text" onClick={() => { if (!swiped.current) sayStep(pos, true) }} title="Read it aloud">{step.text}</button>
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
