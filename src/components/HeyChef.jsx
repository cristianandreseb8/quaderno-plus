import { useEffect, useRef } from 'react'
import { Loader2, Mic, MicOff } from 'lucide-react'
import { afterWake, findRecipe, fmtNumber, heyChefState, heyChefSupported, parseCommand, setHeyChef, useHeyChef } from '../lib/heychef.js'
import { createRecipeAI, voiceAnswer } from '../lib/ai.js'
import { pauseTimer, removeTimer, resumeTimer, speak, startTimer, stopRinging, useTimers } from '../lib/timers.js'
import { fmtSpan, fmtWatch, startWatch, stopWatch, useWatches, watchElapsed, watchFor } from '../lib/timing.js'
import { useSettings } from '../lib/settings.js'
import { toast } from './ui/Toaster.jsx'

// The language Hey chef listens and answers in (Settings → Hey chef).
export const HEY_LANGS = [['auto', 'Device language'], ['en-US', 'English'], ['es-ES', 'Español'], ['de-DE', 'Deutsch'], ['fr-FR', 'Français'], ['it-IT', 'Italiano']]
const LANG_NAME = { en: 'English', es: 'Spanish', de: 'German', fr: 'French', it: 'Italian' }
export const heyLang = (setting) => {
  const l = setting && setting !== 'auto' ? setting : (navigator.language || 'en-US')
  return /^(en|es|de|fr|it)/i.test(l) ? l : 'en-US'
}
const MEASURE = 'voice:measure'

// Chef mode and the recipe page take the commands that are theirs through this event.
export function sendVoice(detail) {
  const d = { ...detail, handled: false }
  window.dispatchEvent(new CustomEvent('qdplus:voice', { detail: d }))
  return d.handled
}

// "Hey chef": listens while on (the microphone button, or Settings → Hey chef), wakes on "hey chef"
// (also "oye chef", "hallo chef"…), and carries out the command — or, after "hey chef" alone, the
// next thing said. Inside chef mode, "next", "back", "repeat" and "step 4" work without it.
export default function HeyChef({ recipes, current, onOpenRecipe, onAddToSession, onAddShopping, onGoShopping, onGoSession, onCreateRecipe }) {
  const { settings } = useSettings()
  const st = useHeyChef()
  const { timers } = useTimers()
  const { now } = useWatches()
  const lang = heyLang(settings.heyChef?.lang)
  const speakOn = settings.heyChef?.speak !== false
  const latest = useRef({})
  latest.current = { recipes, current, timers, onOpenRecipe, onAddToSession, onAddShopping, onGoShopping, onGoSession, onCreateRecipe, lang, speakOn }

  // Starts listening by itself when chosen in Settings.
  useEffect(() => { if (settings.heyChef?.auto && heyChefSupported()) setHeyChef({ on: true }) }, [])

  useEffect(() => {
    if (!st.on || !heyChefSupported()) return undefined
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    let alive = true
    let awakeUntil = 0
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const text = r[0].transcript || ''
        if (!r.isFinal) { if (afterWake(text) != null) setHeyChef({ awake: true, heard: text.trim() }); continue }
        if (window.speechSynthesis?.speaking) continue // the app's own voice
        let cmd = afterWake(text)
        if (cmd == null && Date.now() < awakeUntil) cmd = text
        if (cmd == null && heyChefState().chefOpen) {
          const c = parseCommand(text)
          if (c.intent.startsWith('chef-') || c.intent.startsWith('timer-')) { run(c, text); continue }
        }
        if (cmd == null) continue
        if (!String(cmd).trim()) { awakeUntil = Date.now() + 8000; setHeyChef({ awake: true, heard: 'Hey chef…', reply: '' }); continue }
        awakeUntil = 0
        run(parseCommand(cmd), text)
      }
    }
    rec.onend = () => { if (alive) { try { rec.start() } catch (_) { /* already running */ } } }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        alive = false
        setHeyChef({ on: false, listening: false })
        toast.error('Hey chef needs the microphone: allow it for this site.')
      }
    }
    try { rec.start(); setHeyChef({ listening: true }) } catch (_) { setHeyChef({ listening: false }) }
    return () => { alive = false; rec.onend = null; try { rec.stop() } catch (_) { /* ignore */ } setHeyChef({ listening: false, awake: false }) }
  }, [st.on, lang])

  function reply(text) {
    setHeyChef({ reply: text, awake: false, busy: false })
    if (latest.current.speakOn) speak(text, latest.current.lang, { interrupt: true })
    clearTimeout(reply.t)
    reply.t = setTimeout(() => setHeyChef({ reply: '', heard: '' }), 9000)
  }

  async function run(cmd, heard) {
    const L = latest.current
    setHeyChef({ heard: heard.trim(), awake: false })
    const es = /^es/i.test(L.lang)
    const say = (en, sp) => reply(es && sp ? sp : en)
    const running = () => [...L.timers].filter((t) => t.state === 'running' || t.state === 'paused' || t.ringing).sort((a, b) => (b.endsAt || 0) - (a.endsAt || 0))
    switch (cmd.intent) {
      case 'wake': return
      case 'chef-open': case 'chef-close': case 'chef-next': case 'chef-back': case 'chef-goto': case 'chef-repeat':
        if (!sendVoice(cmd)) say('Open a recipe first.', 'Abre una receta primero.')
        return
      case 'timer-start': {
        startTimer({ key: `voice:${Date.now()}`, label: `Timer ${fmtSpan(cmd.ms)}`, name: fmtSpan(cmd.ms), duration: cmd.ms, recipeId: L.current?.id || null, recipeTitle: L.current?.title || '' })
        return say(`${fmtSpan(cmd.ms)} timer started.`, `Temporizador de ${fmtSpan(cmd.ms)} en marcha.`)
      }
      case 'timer-ask':
        // In chef mode, "start the timer" is the step's own time.
        if (sendVoice({ intent: 'chef-timer' })) return say('Timer started.', 'Temporizador en marcha.')
        return say('How long? Say, for example: 10 minute timer.', '¿Cuánto tiempo? Di por ejemplo: temporizador de 10 minutos.')
      case 'timer-off': {
        const ringing = L.timers.filter((t) => t.ringing)
        if (ringing.length) { ringing.forEach((t) => stopRinging(t.id)); return say('Timer off.', 'Temporizador apagado.') }
        const t = running()[0]
        if (!t) return say('No timer is running.', 'No hay ningún temporizador.')
        removeTimer(t.id)
        return say(`${t.name || 'The timer'} is off.`, `${t.name || 'El temporizador'} apagado.`)
      }
      case 'timer-pause': {
        const t = running().find((x) => x.state === 'running')
        if (!t) return say('No timer is running.', 'No hay ningún temporizador en marcha.')
        pauseTimer(t.id)
        return say('Paused.', 'En pausa.')
      }
      case 'timer-resume': {
        const t = running().find((x) => x.state === 'paused')
        if (!t) return say('No timer is paused.', 'No hay ningún temporizador en pausa.')
        resumeTimer(t.id)
        return say('Going again.', 'Sigue corriendo.')
      }
      case 'measure-start':
        if (watchFor(MEASURE)) return say('I am already timing you.', 'Ya te estoy cronometrando.')
        startWatch({ key: MEASURE, recipeId: L.current?.id || null, stepKey: 'voice', stepText: 'Timed by voice' })
        return say('Timing you now. Say “stop measuring” when you are done.', 'Te cronometro. Di “para de medir” cuando termines.')
      case 'measure-stop': {
        if (!watchFor(MEASURE)) return say('I was not timing anything.', 'No estaba cronometrando nada.')
        const ms = stopWatch(MEASURE)
        return say(`That took ${fmtSpan(ms)}.`, `Has tardado ${fmtSpan(ms)}.`)
      }
      case 'shop-add':
        if (!cmd.item) return say('What should I add?', '¿Qué añado?')
        L.onAddShopping(cmd.item)
        return say(`Added ${cmd.item} to the shopping list.`, `Añadido ${cmd.item} a la lista de la compra.`)
      case 'session-add': {
        const r = findRecipe(cmd.query, L.recipes)
        if (!r) return say(`I can't find a recipe called ${cmd.query}.`, `No encuentro una receta llamada ${cmd.query}.`)
        L.onAddToSession(r.id)
        return say(`${r.title} is in your session.`, `${r.title} está en tu sesión.`)
      }
      case 'open-recipe': {
        const r = findRecipe(cmd.query, L.recipes)
        if (!r) return say(`I can't find a recipe called ${cmd.query}.`, `No encuentro una receta llamada ${cmd.query}.`)
        L.onOpenRecipe(r.id)
        return say(`Opening ${r.title}.`, `Abriendo ${r.title}.`)
      }
      case 'go-shopping': L.onGoShopping(); return say('Your shopping list.', 'Tu lista de la compra.')
      case 'go-session': L.onGoSession(); return say('Your session.', 'Tu sesión.')
      case 'scale': case 'read-ingredients':
        if (!sendVoice(cmd)) say('Open a recipe first.', 'Abre una receta primero.')
        return
      case 'math': {
        const v = fmtNumber(cmd.value)
        if (es) cmd = { ...cmd, expr: cmd.expr.replace(' of ', ' de ') }
        const also = cmd.also ? (es ? ` Y ${cmd.also.expr} es ${fmtNumber(cmd.also.value)}.` : ` And ${cmd.also.expr} is ${fmtNumber(cmd.also.value)}.`) : ''
        return say(`${cmd.expr} is ${v}.${also}`, `${cmd.expr} es ${v}.${also}`)
      }
      case 'create-recipe': {
        setHeyChef({ busy: true, reply: es ? `Creando una receta de ${cmd.request}…` : `Creating a recipe for ${cmd.request}…` })
        try {
          const { recipe } = await createRecipeAI(cmd.request, LANG_NAME[L.lang.slice(0, 2)] || 'English')
          await L.onCreateRecipe(recipe)
          return say(`Done: ${recipe.title} is in your recipes.`, `Listo: ${recipe.title} está en tus recetas.`)
        } catch (e) {
          return say(`I couldn't create it: ${e.message}`, `No pude crearla: ${e.message}`)
        }
      }
      default: {
        setHeyChef({ busy: true, reply: '' })
        try {
          const { text } = await voiceAnswer(cmd.question || heard, L.current || null, LANG_NAME[L.lang.slice(0, 2)] || 'English')
          return reply(text || '…')
        } catch (e) {
          return say(`I couldn't answer that: ${e.message}`, `No pude responder: ${e.message}`)
        }
      }
    }
  }

  // A command as text, the same way as heard (for typing it, and for testing without a microphone).
  useEffect(() => {
    window.qdplusHeyChef = (text) => { const cmd = afterWake(text); return run(parseCommand(cmd ?? text), String(text)) }
    return () => { delete window.qdplusHeyChef }
  })

  if (!st.on) return null
  const measuring = watchFor(MEASURE)
  return (
    <div className={`Q-hey${st.awake ? ' awake' : ''}${st.busy ? ' busy' : ''}`} role="status" aria-live="polite">
      <button type="button" className="Q-hey-mic" onClick={() => setHeyChef({ on: false })} title="Stop listening" aria-label="Stop Hey chef">
        {st.busy ? <Loader2 size={16} className="spin" /> : st.listening ? <Mic size={16} /> : <MicOff size={16} />}
      </button>
      <div className="Q-hey-txt">
        {st.reply ? <span className="reply">{st.reply}</span>
          : st.heard ? <span className="heard">“{st.heard}”</span>
            : <span className="hint">Say “Hey chef…”</span>}
        {measuring && <span className="measure">Timing {fmtWatch(watchElapsed(measuring, now))}</span>}
      </div>
    </div>
  )
}

// The microphone in the header: turns Hey chef on and off.
export function HeyChefButton() {
  const st = useHeyChef()
  if (!heyChefSupported()) return null
  return (
    <button
      type="button" className={`Q-icon-btn Q-hey-btn${st.on ? ' on' : ''}`} onClick={() => setHeyChef({ on: !st.on })}
      title={st.on ? 'Hey chef is listening — click to stop' : 'Hey chef: control the app with your voice'} aria-pressed={st.on} aria-label="Hey chef"
    >
      {st.on ? <Mic size={17} /> : <MicOff size={17} />}
    </button>
  )
}
