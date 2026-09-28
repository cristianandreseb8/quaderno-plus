// Times written in a step — "40 minuti", "7/8 ore", "1 h 30 min", "25 min", "30''" — so a step
// can offer a timer for them. Ranges ("7/8 ore", "5 a 6 minutos") start with the shorter time,
// the moment to go and check.

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const H = '(?:h|hr|hrs|hours?|horas?|ora|ore|heures?|std|stunden?)'
const M = "(?:m|min|mins|minutes?|minutos?|minuti|minuto|minuten|'(?!'))"
const S = '(?:s|sec|secs|seconds?|segundos?|secondi|secondo|secondes?|sek|sekunden?|\'\'|")'
const NUM = '(\\d+(?:[.,]\\d+)?|[½¼¾])'
const RANGE = '(?:\\s*(\\/|-|–|a|to|o|or|bis)\\s*(\\d+(?:[.,]\\d+)?))?'
const RX = new RegExp(`${NUM}${RANGE}\\+?\\s*(${S}|${H}|${M})(?![a-z])`, 'g') // "20+ h" counts as 20 h
const TAIL_MIN = new RegExp(`^\\s*(?:e|y|and|et|und|,)?\\s*(\\d{1,2})\\s*(?:${M})?(?![a-z\\d])`)

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75 }
const num = (s) => FRACTIONS[s] ?? parseFloat(String(s).replace(',', '.'))
const unitMs = (u) => (new RegExp(`^${S}$`).test(u) ? 1000 : new RegExp(`^${H}$`).test(u) ? 3600000 : 60000)

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h && m) return `${h} h ${m} min`
  if (h) return `${h} h`
  if (m && sec) return `${m} min ${sec} s`
  if (m) return `${m} min`
  return `${sec} s`
}

export function findDurations(text) {
  const t = norm(text)
  const out = []
  RX.lastIndex = 0
  let m
  while ((m = RX.exec(t))) {
    const [whole, a, sep, b, unit] = m
    let lo = num(a), hi = null
    if (sep && b) {
      // "1/2 minuto" is half a minute; "7/8 ore" or "5/6 minuti" are ranges.
      if (sep === '/' && lo === 1) lo = 1 / num(b)
      else hi = num(b)
    }
    let ms = lo * unitMs(unit)
    const short = { 1000: 's', 60000: 'min', 3600000: 'h' }[unitMs(unit)]
    let label = hi ? `${+lo.toFixed(2)}–${+hi.toFixed(2)} ${short}` : fmtDuration(ms)
    // "1 h 30 min", "1h30", "2 ore e 15 minuti"
    if (unitMs(unit) === 3600000 && !hi) {
      const tail = t.slice(m.index + whole.length).match(TAIL_MIN)
      if (tail && +tail[1] < 60) {
        ms += +tail[1] * 60000
        label = fmtDuration(ms)
        RX.lastIndex = m.index + whole.length + tail[0].length
      }
    }
    if (ms >= 1000 && ms <= 72 * 3600000 && !out.some((d) => d.ms === ms)) out.push({ ms, label })
  }
  return out
}

// What someone types into a timer: "12", "12 min", "1h30", "90s", "1:30" (m:ss), "1:05:00".
export function parseDurationInput(input) {
  const t = String(input || '').trim()
  if (!t) return 0
  const clock = t.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/)
  if (clock) return clock[3] ? (+clock[1] * 3600 + +clock[2] * 60 + +clock[3]) * 1000 : (+clock[1] * 60 + +clock[2]) * 1000
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return num(t) * 60000
  const compact = t.match(/^(\d+)\s*h\s*(\d{1,2})$/i)
  if (compact) return (+compact[1] * 60 + +compact[2]) * 60000
  const found = findDurations(t)
  return found.reduce((sum, d) => sum + d.ms, 0)
}
