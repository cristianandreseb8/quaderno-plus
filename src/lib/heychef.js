// "Hey chef": voice commands anywhere in the app. This file turns what was heard into a command
// ({ intent, …details }); components/HeyChef.jsx listens and carries it out. English and Spanish
// in full, the common words in German, French and Italian. Speech recognition often hears "chef"
// as "jeff", "chief" or "shef", so those wake it too.
import { useSyncExternalStore } from 'react'

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿¡?!.,;:"]/g, ' ').replace(/\s+/g, ' ').trim()

// ── Listening state, shared (the header button, chef mode's microphone, Settings) ──
let state = { on: false, listening: false, awake: false, heard: '', reply: '', busy: false }
const subs = new Set()
export const heyChefState = () => state
export function setHeyChef(patch) { state = { ...state, ...patch }; subs.forEach((f) => f()) }
export const useHeyChef = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => state)
export const heyChefSupported = () => typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

// ── The wake words ──
const WAKE = /\b(?:hey|hi|hello|ok|okay|oye|oe|ey|eh|hola|hallo|salut|ehi|ciao|he)\s+(?:chef|chefs|chief|jeff|shef|sheff|chev|chefe|shift)\b/
// The command after the wake words, '' when only the wake words were said, null without them.
export function afterWake(text) {
  const t = norm(text)
  const m = WAKE.exec(t)
  if (!m) return null
  return t.slice(m.index + m[0].length).trim()
}

// ── Numbers said as words ──
const WORDS = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
  cero: 0, uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50,
  sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100,
  eins: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, zehn: 10, zwanzig: 20, dreissig: 30, deux: 2, trois: 3, quatre: 4, cinq: 5, dix: 10, vingt: 20,
  trente: 30, due: 2, tre: 3, quattro: 4, cinque: 5, dieci: 10, venti: 20, trenta: 30,
}
// "twenty five" → 25, "veinte" → 20; digits stay.
export function wordsToNumbers(t) {
  return norm(t).replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety) (one|two|three|four|five|six|seven|eight|nine)\b/g, (_, a, b) => String(WORDS[a] + WORDS[b]))
    .replace(/\b(veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa) y (uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, (_, a, b) => String(WORDS[a] + WORDS[b]))
    .replace(/\bveinti(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, (_, b) => String(20 + WORDS[b]))
    .replace(/\b(half an hour|media hora|halbe stunde|une demi heure|mezz ora|mezzora)\b/g, '30 minutes')
    .replace(/\b(an hour and a half|una hora y media|hora y media)\b/g, '90 minutes')
    .replace(/\b([a-z]+)\b/g, (w) => (WORDS[w] != null && !['a', 'an', 'un', 'una', 'he'].includes(w) ? String(WORDS[w]) : w))
}
const NUM = String.raw`\d+(?:[.,]\d+)?`

// ── Durations: "10 minute timer", "temporizador de 5 minutos", "an hour" ──
const UNIT_MS = [
  [/^(s|sec|secs|second|seconds|segundo|segundos|sekunde|sekunden|seconde|secondes|secondo|secondi)$/, 1000],
  [/^(m|min|mins|minute|minutes|minuto|minutos|minuten|minuti)$/, 60000],
  [/^(h|hr|hrs|hour|hours|hora|horas|stunde|stunden|heure|heures|ora|ore)$/, 3600000],
]
export function durationIn(t) {
  const s = wordsToNumbers(t).replace(/\b(a|an|un|una|one) (hour|hora|minute|minuto)\b/g, '1 $2')
  let total = 0
  const rx = new RegExp(`(${NUM})\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|segundos?|minutos?|horas?|sekunden?|minuten|stunden?|secondes?|heures?|secondi|secondo|minuti|ore|ora)\\b`, 'g')
  for (const m of s.matchAll(rx)) {
    const u = UNIT_MS.find(([r]) => r.test(m[2]))
    if (u) total += parseFloat(m[1].replace(',', '.')) * u[1]
  }
  return total
}

// ── Arithmetic: "what's 54 plus 100", "divide 2345 into 5450", "20 percent of 340" ──
const OPS = [
  ['+', /\b(plus|mas|und|plus|piu|y sumale|added to)\b|\+/],
  ['-', /\b(minus|menos|weniger|moins|meno)\b|−/],
  ['*', /\b(times|multiplied by|por|multiplicado por|mal|fois|per|x)\b|×|\*/],
  ['/', /\b(divided by|over|dividido (?:por|entre)|entre|geteilt durch|divise par|diviso)\b|÷|\//],
]
export function mathIn(text) {
  const t = wordsToNumbers(text)
  const nums = [...t.matchAll(new RegExp(NUM, 'g'))].map((m) => parseFloat(m[0].replace(',', '.')))
  if (nums.length < 2) {
    const root = /\b(square root of|raiz cuadrada de) (\d+(?:[.,]\d+)?)\b/.exec(t)
    return root ? { expr: `√${root[2]}`, value: Math.sqrt(parseFloat(root[2].replace(',', '.'))) } : null
  }
  const [a, b] = nums
  const pct = new RegExp(`(${NUM})\\s*(?:%|percent|por ?ciento|prozent|pour ?cent|per ?cento) (?:of|de|von|di|del) (${NUM})`).exec(t)
  if (pct) { const p = parseFloat(pct[1].replace(',', '.')), n = parseFloat(pct[2].replace(',', '.')); return { expr: `${p}% of ${n}`, value: (p / 100) * n } }
  // "divide A into B" is B ÷ A in English; "divide A by B", "divide A entre B" is A ÷ B.
  if (/\bdivide\b/.test(t) && /\binto\b/.test(t)) return { expr: `${b} ÷ ${a}`, value: b / a, also: { expr: `${a} ÷ ${b}`, value: a / b } }
  if (/\b(divide|divida|dividir|divide)\b/.test(t)) return { expr: `${a} ÷ ${b}`, value: a / b }
  if (/\b(add|suma|sumar)\b/.test(t)) return { expr: `${a} + ${b}`, value: a + b }
  if (/\b(multiply|multiplica)\b/.test(t)) return { expr: `${a} × ${b}`, value: a * b }
  if (/\b(subtract|resta|restar)\b/.test(t)) return { expr: `${b} − ${a}`, value: b - a }
  const op = OPS.find(([, rx]) => rx.test(t))
  if (!op) return null
  const value = { '+': a + b, '-': a - b, '*': a * b, '/': a / b }[op[0]]
  return { expr: `${a} ${{ '*': '×', '/': '÷', '-': '−', '+': '+' }[op[0]]} ${b}`, value }
}
export const fmtNumber = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100))

// ── A shopping item said aloud: "200 grams of flour" → "200 g flour" ──
export function shoppingItem(t) {
  return wordsToNumbers(t)
    .replace(/\b(grams?|gramos?|gramm|grammes?|grammi)\b/g, 'g').replace(/\b(kilos?|kilograms?|kilogramos?|kilogramm|kg)\b/g, 'kg')
    .replace(/\b(milliliters?|millilitres?|mililitros?|ml)\b/g, 'ml').replace(/\b(liters?|litres?|litros?|liter)\b/g, 'l')
    .replace(/\b(g|kg|ml|l) (of|de|di|von|du|des) /g, '$1 ').replace(/^(some|unos|unas|algo de) /, '').trim()
}

// ── What was said → a command ──
// ctx: { chefOpen } — inside chef mode the step commands work without "hey chef".
export function parseCommand(raw) {
  const t = norm(raw)
  if (!t) return { intent: 'wake' }
  const n = wordsToNumbers(t)
  let m
  // Chef mode and steps
  if (/\b(open|start|abre|abrir|inicia|iniciar|empieza|enciende|activa|starte|ouvre|apri)\b.*\b(chef|cocina guiada)\b/.test(t)) return { intent: 'chef-open' }
  if (/\b(close|exit|leave|cierra|cerrar|sal|salir|schliess|ferme|chiudi)\b.*\b(chef)\b/.test(t)) return { intent: 'chef-close' }
  if ((m = /\b(?:go|jump|skip|ve|ir|vamos|anda|geh|va|vai)?\s*(?:to|al|a la|a|zu|au|alla)?\s*(?:step|paso|schritt|etape|passo)\s+(\d+)\b/.exec(n))) return { intent: 'chef-goto', n: +m[1] }
  if (/^(next|next step|siguiente|siguiente paso|el siguiente|proximo paso|weiter|nachster schritt|suivant|etape suivante|avanti|prossimo passo)$/.test(t) || /\b(next step|siguiente paso|proximo paso|nachster schritt|etape suivante|passo successivo)\b/.test(t)) return { intent: 'chef-next' }
  if (/^(back|go back|previous|previous step|atras|anterior|paso anterior|vuelve|zuruck|precedent|indietro)$/.test(t) || /\b(previous step|paso anterior|step back|vorheriger schritt|etape precedente|passo precedente)\b/.test(t)) return { intent: 'chef-back' }
  if (/^(repeat|again|say it again|repite|repitelo|otra vez|nochmal|wiederholen|repete|ripeti)$/.test(t) || /\b(repeat that|repeat the step|repite el paso|read it again)\b/.test(t)) return { intent: 'chef-repeat' }
  // Timers
  if (/\b(timer|temporizador|alarma|alarm|minuteur|timer|kurzzeitwecker)\b/.test(t)) {
    if (/\b(off|stop|cancel|apaga|apagar|para|parar|cancela|quita|aus|stopp|arrete|ferma|spegni)\b/.test(t)) return { intent: 'timer-off' }
    if (/\b(pause|pausa|pausar|pausiere|anhalten)\b/.test(t)) return { intent: 'timer-pause' }
    if (/\b(continue|resume|reanuda|reanudar|continua|sigue|weiter|fortsetzen|reprends|riprendi)\b/.test(t)) return { intent: 'timer-resume' }
    const ms = durationIn(t)
    if (ms) return { intent: 'timer-start', ms }
    return { intent: 'timer-ask' }
  }
  const ms = durationIn(t)
  if (ms && /^(set |pon |put |start |starte |)?(a |un |una )?\d/.test(n) && n.split(' ').length <= 5) return { intent: 'timer-start', ms }
  // Timing the work
  if (/\b(stop|para|termina|deja de|halt|arrete|ferma)\b.*\b(measur|timing|midiendo|medir|cronometr|messen|chrono|cronometr)/.test(t)) return { intent: 'measure-stop' }
  if (/\b(measure|time|track|mide|medir|cronometra|cronometrar|miss|chronometre|cronometra)\b.*\b(timing|my time|time|tiempo|mi tiempo|zeit|temps|tempo)\b/.test(t)) return { intent: 'measure-start' }
  // Shopping list, session
  if ((m = /^(?:add|put|agrega|agregar|anade|anadir|pon|poner|mete|fuge|ajoute|aggiungi)\s+(.+?)\s+(?:to|on|a|en|in|auf|sur|alla|nella)\s+(?:my |the |mi |la |meine |die |ma |la mia )?(shopping list|shopping|lista de (?:la )?compras?|lista de compra|lista|einkaufsliste|liste de courses|lista della spesa)$/.exec(t))) return { intent: 'shop-add', item: shoppingItem(m[1]) }
  if ((m = /^(?:add|put|agrega|agregar|anade|anadir|pon|poner|mete|fuge|ajoute|aggiungi)\s+(?:the |la |el |die |la ricetta )?(?:recipe |receta |rezept |recette |ricetta )?(?:for |of |de |del |di )?(.+?)\s+(?:recipe |receta )?(?:to|a|en|in|zu|a la|alla)\s+(?:my |the |mi |la |meine |ma |la mia )?(session|sesion|sitzung|seance|sessione)$/.exec(t))) return { intent: 'session-add', query: m[1] }
  if (/\b(open|show|abre|muestra|ver|zeig|ouvre|apri)\b.*\b(shopping list|lista de (la )?compra|einkaufsliste|liste de courses|lista della spesa)\b/.test(t)) return { intent: 'go-shopping' }
  if (/\b(open|show|abre|muestra|ver|zeig|ouvre|apri)\b.*\b(my session|the session|la sesion|mi sesion|sitzung|seance|sessione|plan)\b/.test(t)) return { intent: 'go-session' }
  // Scaling and reading the recipe
  if (/\b(double|duplica|duplicar|doble|verdopple|double la|raddoppia)\b/.test(t)) return { intent: 'scale', factor: 2 }
  if (/\b(triple|triplica|verdreifache)\b/.test(t)) return { intent: 'scale', factor: 3 }
  if (/\b(halve|half the recipe|la mitad de la receta|media receta|halbiere)\b/.test(t)) return { intent: 'scale', factor: 0.5 }
  if ((m = new RegExp(`\\b(?:scale|escala|escalar|skaliere|multiplica)\\b.*?(?:x|por|by|to|a|times|veces|mal)?\\s*(${NUM})`).exec(n))) return { intent: 'scale', factor: parseFloat(m[1].replace(',', '.')) }
  if (/\b(original|back to original|vuelve al original|como estaba|cantidades originales|zuruck zum original)\b/.test(t)) return { intent: 'scale', factor: 1 }
  if (/\b(read|tell me|lee|leeme|dime|lies|lis|leggi)\b.*\b(ingredients|ingredientes|zutaten|ingredients|ingredienti)\b/.test(t) || /\bwhat do i need\b|\bque necesito\b/.test(t)) return { intent: 'read-ingredients' }
  // New recipes and opening one
  if ((m = /^(?:create|make|write|invent|generate|crea|crear|haz|hazme|escribe|inventa|genera|erstelle|schreib|cree|crea)\s+(?:me\s+)?(?:a |an |una |un |ein |eine |une )?(?:new |nueva |nuevo |neues |neue |nouvelle )?(?:recipe|receta|rezept|recette|ricetta)\s+(?:for |of |de |para |fur |pour |per |di )?(.+)$/.exec(t))) return { intent: 'create-recipe', request: m[1] }
  if ((m = /^(?:open|show|show me|go to|abre|abrir|muestra|muestrame|ve a|ir a|offne|zeig|ouvre|montre|apri|mostra)\s+(?:me\s+)?(?:the |la |el |my |mi |die |das |le |la mia )?(?:recipe |receta |rezept |recette |ricetta )?(?:for |of |de |del |fur |pour |di )?(.+?)(?: recipe| receta| rezept)?$/.exec(t))) return { intent: 'open-recipe', query: m[1] }
  // Arithmetic
  const math = mathIn(t)
  if (math && Number.isFinite(math.value)) return { intent: 'math', ...math }
  // Anything else is a question for the AI
  return { intent: 'ask', question: raw.trim() }
}

// The recipe a spoken name means: the title sharing the most words with it.
export function findRecipe(query, recipes) {
  const words = (s) => norm(s).split(' ').filter((w) => w.length > 1 && !['the', 'la', 'el', 'de', 'del', 'of', 'recipe', 'receta', 'my', 'mi'].includes(w))
  const q = words(query)
  if (!q.length) return null
  let best = null, score = 0
  for (const r of recipes) {
    const t = words(r.title)
    if (!t.length) continue
    const hits = q.filter((w) => t.some((x) => x === w || (w.length > 3 && (x.startsWith(w) || w.startsWith(x))))).length
    const s = hits / q.length + (norm(r.title) === norm(query) ? 1 : 0) + hits / (t.length * 10)
    if (hits && s > score) { best = r; score = s }
  }
  return score >= 0.5 ? best : null
}

// Is what was heard just the app's own voice (spoken lately)? Its words all come from what the app
// said — a whole phrase of it, or most of a longer one.
export function isEcho(heard, spoken) {
  const h = wordsToNumbers(heard).split(' ').filter(Boolean)
  if (!h.length) return true
  for (const s of spoken || []) {
    const said = wordsToNumbers(s)
    if (said.includes(h.join(' '))) return true
    const words = new Set(said.split(' '))
    const inIt = h.filter((w) => words.has(w)).length
    if (h.length >= 3 && inIt / h.length >= 0.8) return true
  }
  return false
}
