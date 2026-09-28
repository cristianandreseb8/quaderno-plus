import { useSyncExternalStore } from 'react'

// Kitchen timers, shared by the whole app: one general timer or many at once — per recipe
// (each preparation in a session), per part of a method, per step. They live on this device
// (localStorage), keep counting through a reload, and ring when they reach zero: a sound, a
// vibration, and a notification when the app is in the background. While one runs, the
// screen is kept awake.
//
// A timer: { id, key, name, label, lang, recipeId, recipeTitle, duration, state: 'idle'|'running'|'paused'|'done',
//            endsAt (running), left (paused), doneAt, ringing }
// `name` is what it is about ("Lievito madre", "Cebolla") — shown large and said out loud when
// it ends, in the recipe's language (`lang`); `label` is the fuller context.
// `key` ties a timer to its place (a step, a part) so the same place never gets two.

const KEY = 'qdplus_timers'
const RING_FOR = 60000 // an unanswered alarm stops by itself after a minute
const LATE = 60000 // a timer that ended longer ago than this (app closed) does not ring any more
const SAY_EVERY = 12000 // while an alarm rings, its name is said again this often
const VOICE_KEY = 'qdplus_timer_voice'
const VOICE_CFG_KEY = 'qdplus_timer_voice_cfg' // { lang: 'device' | 'recipe' | 'es-ES'…, voiceURI }

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]').filter((t) => t && t.id) } catch (_) { return [] }
}

let timers = load()
let dockOpen = false
let big = false
let voiceOn = (() => { try { return localStorage.getItem(VOICE_KEY) !== 'off' } catch (_) { return true } })()
let voiceCfg = (() => { try { return { lang: 'device', voiceURI: '', ...JSON.parse(localStorage.getItem(VOICE_CFG_KEY) || '{}') } } catch (_) { return { lang: 'device', voiceURI: '' } } })()
let voicesVersion = 0 // bumps when the device's voice list arrives (it loads late in some browsers)
let now = Date.now()
let snapshot = { timers, now, dockOpen, big, voiceOn, voiceCfg, voicesVersion }
const listeners = new Set()
let ticker = null
let lastBeep = 0
let lastSaid = 0

function emit() {
  snapshot = { timers, now, dockOpen, big, voiceOn, voiceCfg, voicesVersion }
  listeners.forEach((l) => l())
}
function commit(next) {
  timers = next
  try { localStorage.setItem(KEY, JSON.stringify(timers)) } catch (_) { /* storage unavailable */ }
  now = Date.now()
  ensureTicker()
  syncWakeLock()
  emit()
}
const active = () => timers.some((t) => t.state === 'running' || t.ringing)

// ── Clock ──
function tick() {
  now = Date.now()
  let changed = false
  const next = timers.map((t) => {
    if (t.state === 'running' && t.endsAt <= now) {
      changed = true
      const ring = now - t.endsAt < LATE
      if (ring) { announce(t); say(t); lastSaid = now }
      return { ...t, state: 'done', doneAt: t.endsAt, ringing: ring }
    }
    if (t.ringing && now - (t.doneAt || now) > RING_FOR) { changed = true; return { ...t, ringing: false } }
    return t
  })
  if (changed) {
    timers = next
    try { localStorage.setItem(KEY, JSON.stringify(timers)) } catch (_) { /* ignore */ }
    if (timers.some((t) => t.ringing)) dockOpen = true
    syncWakeLock()
  }
  const ringing = timers.filter((t) => t.ringing)
  if (ringing.length && now - lastBeep > 1400) { lastBeep = now; beep() }
  if (ringing.length && now - lastSaid > SAY_EVERY) { lastSaid = now; ringing.forEach(say) }
  if (!active()) { clearInterval(ticker); ticker = null }
  emit()
}
function ensureTicker() {
  if (!ticker && active()) ticker = setInterval(tick, 250)
}
if (typeof window !== 'undefined') {
  ensureTicker()
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices()
    window.speechSynthesis.addEventListener?.('voiceschanged', () => { voicesVersion += 1; emit() })
  }
  // Another tab changed the timers.
  window.addEventListener('storage', (e) => { if (e.key === KEY) { timers = load(); ensureTicker(); emit() } })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); syncWakeLock() } })
}

// ── Sound, vibration, notification ──
let audio = null
function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)()
    if (audio.state === 'suspended') audio.resume()
  } catch (_) { audio = null }
}
function beep() {
  if (!audio) return
  const t0 = audio.currentTime
  ;[0, 0.22].forEach((offset) => {
    const osc = audio.createOscillator(), gain = audio.createGain()
    osc.type = 'sine'; osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, t0 + offset)
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.16)
    osc.connect(gain).connect(audio.destination)
    osc.start(t0 + offset); osc.stop(t0 + offset + 0.18)
  })
  navigator.vibrate?.([220, 120, 220])
}
// ── Voice: the timer says what it is ("Lievito madre") ──
const spoken = (t) => t.name || t.label || 'Timer'

// Devices ship joke voices (Albert, Bad News, Zarvox…) and old robotic ones next to good ones.
// Never pick those by ourselves; prefer the natural ones (Premium, Enhanced, Siri, Google…).
// Joke and robotic voices, by name in the languages a Mac or iPhone can be set to (their names
// are translated with the system: "Bad News" is "Malas noticias" on a Mac in Spanish).
const NOVELTY = new RegExp('^(' + [
  'albert', 'bahh', 'boing', 'bubbles', 'bells', 'cellos', 'good news', 'bad news', 'jester', 'junior', 'organ', 'pipe organ', 'ralph',
  'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox', 'fred', 'kathy', 'princess', 'deranged', 'hysterical',
  'buenas noticias', 'malas noticias', 'bufon', 'burbujas', 'campanas', 'organo', 'superestrella', 'susurro', 'violonchelos',
  'buone notizie', 'cattive notizie', 'giullare', 'bolle', 'campane', 'sussurro', 'violoncelli',
  'bonnes nouvelles', 'mauvaises nouvelles', 'bouffon', 'bulles', 'cloches', 'orgue', 'chuchotement', 'violoncelles',
  'gute nachrichten', 'schlechte nachrichten', 'narr', 'blasen', 'glocken', 'orgel', 'flustern', 'celli',
  'eddy', 'flo', 'grandma', 'grandpa', 'reed', 'rocko', 'sandy', 'shelley',
].join('|') + ')\\b', 'i')
const NICE = /\b(premium|enhanced|mejorada|neural|natural|siri|google|online)\b/i
const KNOWN_GOOD = /^(m[oó]nica|paulina|jorge|marisol|juan|diego|isabela|francisca|montse|alice|federica|luca|paola|samantha|ava|allison|evan|zoe|nathan|susan|tom|daniel|karen|moira|tessa|rishi|amelie|am[eé]lie|thomas|jacques|anna|petra|markus|helena|luciana|joana)\b/i
const plain = (name) => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
export function voiceQuality(v) {
  const n = plain(v.name)
  if (NOVELTY.test(n)) return 'novelty'
  if (NICE.test(n)) return 'premium'
  if (KNOWN_GOOD.test(v.name) || KNOWN_GOOD.test(n)) return 'good'
  return 'basic'
}
const RANK = { premium: 3, good: 2, basic: 1, novelty: 0 }
export function voicesFor(lang) {
  const base = (lang || '').slice(0, 2).toLowerCase()
  return (window.speechSynthesis?.getVoices?.() || [])
    .filter((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(base))
    .map((v) => ({ v, q: voiceQuality(v) }))
    .sort((a, b) => RANK[b.q] - RANK[a.q] || (b.v.lang === lang) - (a.v.lang === lang) || (b.v.localService === false) - (a.v.localService === false))
}
// The language the timers speak: the device's own by default (a Spanish-speaking cook hears
// "lievito madre" said the Spanish way), or the recipe's, or one chosen.
export function voiceLang(t) {
  if (voiceCfg.lang === 'recipe' && t?.lang) return t.lang
  if (voiceCfg.lang && voiceCfg.lang !== 'device' && voiceCfg.lang !== 'recipe') return voiceCfg.lang
  return navigator.language || 'en-US'
}
function pickVoice(lang) {
  const all = window.speechSynthesis?.getVoices?.() || []
  const chosen = voiceCfg.voiceURI && all.find((v) => v.voiceURI === voiceCfg.voiceURI)
  if (chosen && chosen.lang.slice(0, 2).toLowerCase() === lang.slice(0, 2).toLowerCase()) return chosen
  const best = voicesFor(lang).find((x) => x.q !== 'novelty')
  return best ? best.v : null
}
function speakText(text, lang) {
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    const v = pickVoice(lang)
    if (v) u.voice = v
    u.rate = 1
    window.speechSynthesis.speak(u)
  } catch (_) { /* no voice on this device */ }
}
function say(t) {
  if (voiceOn) speakText(spoken(t), voiceLang(t))
}
// iPhone and iPad only let a page speak after it has spoken during a tap: do that, silently.
function unlockVoice() {
  try {
    if (!window.speechSynthesis) return
    window.speechSynthesis.getVoices() // starts loading the voices, which some browsers do lazily
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    window.speechSynthesis.speak(u)
  } catch (_) { /* ignore */ }
}

function announce(t) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
  const title = `${spoken(t)} — time's up`
  const opts = { body: [t.recipeTitle, t.label !== spoken(t) && t.label].filter(Boolean).join(' · ') || 'Quaderno+ timer', tag: t.id, renotify: true, icon: '/icon-192.png' }
  navigator.serviceWorker?.getRegistration()
    .then((reg) => (reg ? reg.showNotification(title, opts) : new Notification(title, opts)))
    .catch(() => { try { new Notification(title, opts) } catch (_) { /* ignore */ } })
}
function askForNotifications() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
}

// ── Keep the screen on while a timer runs (kitchen phones and tablets) ──
let wakeLock = null
async function syncWakeLock() {
  const want = timers.some((t) => t.state === 'running') && document.visibilityState === 'visible'
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener?.('release', () => { wakeLock = null })
    } else if (!want && wakeLock) {
      await wakeLock.release(); wakeLock = null
    }
  } catch (_) { wakeLock = null }
}

// ── Actions ──
const uid = () => Math.random().toString(36).slice(2, 10)
const edit = (id, fn) => commit(timers.map((t) => (t.id === id ? fn(t) : t)))

export function startTimer({ label, name = '', lang = '', duration, recipeId = null, recipeTitle = '', key = null }) {
  if (!duration || duration < 1000) return null
  unlockAudio(); unlockVoice(); askForNotifications()
  const t = Date.now()
  const existing = key && timers.find((x) => x.key === key)
  const timer = { id: existing?.id || uid(), key, name: name || existing?.name || '', label: label || name || 'Timer', lang, recipeId, recipeTitle, duration, state: 'running', endsAt: t + duration, left: null, doneAt: null, ringing: false }
  commit(existing ? timers.map((x) => (x.id === existing.id ? timer : x)) : [...timers, timer])
  return timer.id
}
export const pauseTimer = (id) => edit(id, (t) => (t.state === 'running' ? { ...t, state: 'paused', left: Math.max(0, t.endsAt - Date.now()) } : t))
export function resumeTimer(id) {
  unlockAudio(); unlockVoice()
  edit(id, (t) => (t.state === 'paused' ? { ...t, state: 'running', endsAt: Date.now() + t.left, left: null } : t))
}
export function restartTimer(id) {
  unlockAudio(); unlockVoice()
  edit(id, (t) => ({ ...t, state: 'running', endsAt: Date.now() + t.duration, left: null, doneAt: null, ringing: false }))
}
export const resetTimer = (id) => edit(id, (t) => ({ ...t, state: 'idle', endsAt: null, left: null, doneAt: null, ringing: false }))
export function addTime(id, ms) {
  edit(id, (t) => {
    if (t.state === 'running') return { ...t, endsAt: t.endsAt + ms, duration: t.duration + ms }
    if (t.state === 'paused') return { ...t, left: t.left + ms, duration: t.duration + ms }
    if (t.state === 'done') return { ...t, state: 'running', endsAt: Date.now() + ms, duration: ms, doneAt: null, ringing: false }
    return { ...t, duration: t.duration + ms }
  })
}
export function stopRinging(id) {
  window.speechSynthesis?.cancel?.()
  edit(id, (t) => ({ ...t, ringing: false }))
}
export const renameTimer = (id, name) => edit(id, (t) => ({ ...t, name: String(name || '').trim() }))
export function sayName(id) {
  const t = timers.find((x) => x.id === id)
  if (t) { window.speechSynthesis?.cancel?.(); speakText(spoken(t), voiceLang(t)) }
}
export function setVoiceCfg(patch) {
  voiceCfg = { ...voiceCfg, ...patch }
  try { localStorage.setItem(VOICE_CFG_KEY, JSON.stringify(voiceCfg)) } catch (_) { /* ignore */ }
  emit()
}
export function testVoice(text = 'Lievito madre') {
  window.speechSynthesis?.cancel?.()
  speakText(text, voiceLang(null))
}
export function setVoiceOn(on) {
  voiceOn = on
  try { localStorage.setItem(VOICE_KEY, on ? 'on' : 'off') } catch (_) { /* ignore */ }
  if (!on) window.speechSynthesis?.cancel?.()
  emit()
}
export const removeTimer = (id) => commit(timers.filter((t) => t.id !== id))
export const clearFinished = () => commit(timers.filter((t) => t.state !== 'done'))
export function setDockOpen(open) { dockOpen = open; if (!open) big = false; emit() }
export function setBig(on) { big = on; if (on) dockOpen = true; emit() }

// ── Reading ──
export function remaining(t, at = now) {
  if (t.state === 'running') return Math.max(0, t.endsAt - at)
  if (t.state === 'paused') return t.left
  if (t.state === 'done') return 0
  return t.duration
}
// 1:05:09 · 4:07 · 0:09 (rounded up, so it reads 0:00 only when it rings)
export function fmtClock(ms) {
  const s = Math.ceil(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

function subscribe(l) { listeners.add(l); return () => listeners.delete(l) }
export function useTimers() {
  return useSyncExternalStore(subscribe, () => snapshot)
}
