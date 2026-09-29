// Recipe text rewritten for the ear, the way a cook would say it — in the language it is read in:
// "4.5–6 h" → "between 4 and a half hours and 6 hours" / "entre 4 horas y media y 6 horas",
// "1.5 h" → "1 hora y media", "22–26 °C" → "entre 22 y 26 grados Celsius", "500 g" → "500 gramos",
// "2.7×" → "2,7 veces", "1h30" → "1 hora y 30 minutos".

// Units: one / many, and gender where a "half" agrees with it (media hora, medio kilo).
const U = {
  en: {
    h: ['hour', 'hours'], min: ['minute', 'minutes'], s: ['second', 'seconds'], g: ['gram', 'grams'], kg: ['kilogram', 'kilograms'],
    mg: ['milligram', 'milligrams'], ml: ['milliliter', 'milliliters'], cl: ['centiliter', 'centiliters'], dl: ['deciliter', 'deciliters'], l: ['liter', 'liters'],
  },
  es: {
    h: ['hora', 'horas', 'f'], min: ['minuto', 'minutos'], s: ['segundo', 'segundos'], g: ['gramo', 'gramos'], kg: ['kilo', 'kilos'],
    mg: ['miligramo', 'miligramos'], ml: ['mililitro', 'mililitros'], cl: ['centilitro', 'centilitros'], dl: ['decilitro', 'decilitros'], l: ['litro', 'litros'],
  },
  it: {
    h: ['ora', 'ore', 'f'], min: ['minuto', 'minuti'], s: ['secondo', 'secondi'], g: ['grammo', 'grammi'], kg: ['chilo', 'chili'],
    mg: ['milligrammo', 'milligrammi'], ml: ['millilitro', 'millilitri'], cl: ['centilitro', 'centilitri'], dl: ['decilitro', 'decilitri'], l: ['litro', 'litri'],
  },
  fr: {
    h: ['heure', 'heures', 'f'], min: ['minute', 'minutes', 'f'], s: ['seconde', 'secondes', 'f'], g: ['gramme', 'grammes'], kg: ['kilo', 'kilos'],
    mg: ['milligramme', 'milligrammes'], ml: ['millilitre', 'millilitres'], cl: ['centilitre', 'centilitres'], dl: ['décilitre', 'décilitres'], l: ['litre', 'litres'],
  },
  de: {
    h: ['Stunde', 'Stunden', 'f'], min: ['Minute', 'Minuten', 'f'], s: ['Sekunde', 'Sekunden', 'f'], g: ['Gramm', 'Gramm', 'n'], kg: ['Kilo', 'Kilo', 'n'],
    mg: ['Milligramm', 'Milligramm', 'n'], ml: ['Milliliter', 'Milliliter'], cl: ['Zentiliter', 'Zentiliter'], dl: ['Deziliter', 'Deziliter'], l: ['Liter', 'Liter'],
  },
}

// Words, and how each language says a whole number plus a half ('h'), a quarter ('q') or three ('t').
const L = {
  en: {
    C: 'degrees Celsius', F: 'degrees Fahrenheit', pct: 'percent', times: 'times', to: 'to', about: 'about', and: 'and', more: 'more than',
    between: (a, b) => `between ${a} and ${b}`, ord: ['first', 'second', 'third'], comma: false,
    frac(n, f, [one, many], key) {
      const a = key === 'h' ? 'an' : 'a'
      if (n === 0) return f === 'h' ? `half ${a} ${one}` : f === 'q' ? `a quarter of ${a} ${one}` : `three quarters of ${a} ${one}`
      return `${n} and ${f === 'h' ? 'a half' : f === 'q' ? 'a quarter' : 'three quarters'} ${many}`
    },
  },
  es: {
    C: 'grados Celsius', F: 'grados Fahrenheit', pct: 'por ciento', times: 'veces', to: 'a', about: 'unos', and: 'y', more: 'más de',
    between: (a, b) => `entre ${a} y ${b}`, ord: ['primer', 'segundo', 'tercer'], comma: true,
    frac(n, f, [one, many, g]) {
      const half = g === 'f' ? 'media' : 'medio'
      if (n === 0) return f === 'h' ? `${half} ${one}` : f === 'q' ? `un cuarto de ${one}` : `tres cuartos de ${one}`
      return `${n} ${n === 1 ? one : many} y ${f === 'h' ? half : f === 'q' ? 'cuarto' : 'tres cuartos'}`
    },
  },
  it: {
    C: 'gradi Celsius', F: 'gradi Fahrenheit', pct: 'per cento', times: 'volte', to: 'a', about: 'circa', and: 'e', more: 'più di',
    between: (a, b) => `tra ${a} e ${b}`, ord: ['primo', 'secondo', 'terzo'], comma: true,
    frac(n, f, [one, many, g]) {
      const half = g === 'f' ? 'mezza' : 'mezzo'
      if (n === 0) return f === 'h' ? (one === 'ora' ? "mezz'ora" : `${half} ${one}`) : f === 'q' ? `un quarto d'${one}` : `tre quarti d'${one}`
      return `${n} ${n === 1 ? one : many} e ${f === 'h' ? half : f === 'q' ? 'un quarto' : 'tre quarti'}`
    },
  },
  fr: {
    C: 'degrés Celsius', F: 'degrés Fahrenheit', pct: 'pour cent', times: 'fois', to: 'à', about: 'environ', and: 'et', more: 'plus de',
    between: (a, b) => `entre ${a} et ${b}`, ord: ['premier', 'deuxième', 'troisième'], comma: true,
    frac(n, f, [one, many, g]) {
      if (n === 0) return f === 'h' ? `${g === 'f' ? 'une demi' : 'un demi'}-${one}` : f === 'q' ? `un quart d'${one}` : `trois quarts d'${one}`
      return `${n} ${n === 1 ? one : many} ${f === 'h' ? `et ${g === 'f' ? 'demie' : 'demi'}` : f === 'q' ? 'et quart' : 'trois quarts'}`
    },
  },
  de: {
    C: 'Grad Celsius', F: 'Grad Fahrenheit', pct: 'Prozent', times: 'mal', to: 'bis', about: 'etwa', and: 'und', more: 'mehr als',
    between: (a, b) => `zwischen ${a} und ${b}`, ord: ['erste', 'zweite', 'dritte'], comma: true,
    frac(n, f, [one, many, g]) {
      if (f !== 'h') return null // quarters: said as a decimal
      if (n === 0) return `${g === 'f' ? 'eine halbe' : g === 'n' ? 'ein halbes' : 'ein halber'} ${one}`
      return n === 1 ? `eineinhalb ${many}` : `${n} einhalb ${many}`
    },
  },
}

// Units as abbreviations or as words, in any of the languages.
const UNIT_RX = {
  h: /^(h|hr|hrs|hours?|horas?|ore|ora|heures?|stunden?)$/i,
  min: /^(m|min|mins|minutes?|minutos?|minuti|minuto|minuten|')$/i,
  s: /^(s|sec|secs|seconds?|segundos?|secondi|secondo|secondes?|sekunden?|'')$/i,
  kg: /^(kg|kilos?|chili|chilo)$/i, mg: /^mg$/i, g: /^(g|gr|grs|grams?|gramos?|grammi|grammo|grammes?|gramm)$/i,
  ml: /^ml$/i, cl: /^cl$/i, dl: /^dl$/i, l: /^(l|litros?|litri|litro|litres?|liters?)$/i,
}
const unitOf = (u) => Object.keys(UNIT_RX).find((k) => UNIT_RX[k].test(u))

// Kitchen abbreviations, said in full (the abbreviation tells the language): [pattern, one, many].
const ABBR = [
  [/^(tsp|tsps|teaspoons?)$/i, 'teaspoon', 'teaspoons'], [/^(tbsp|tbsps|tbs|tablespoons?)$/i, 'tablespoon', 'tablespoons'],
  [/^oz$/i, 'ounce', 'ounces'], [/^(lb|lbs)$/i, 'pound', 'pounds'], [/^cups?$/i, 'cup', 'cups'],
  [/^(cdta|cdtas)$/i, 'cucharadita', 'cucharaditas'], [/^(cda|cdas)$/i, 'cucharada', 'cucharadas'], [/^(tz|tza)$/i, 'taza', 'tazas'],
  [/^TL$/, 'Teelöffel', 'Teelöffel'], [/^EL$/, 'Esslöffel', 'Esslöffel'],
  [/^(c\.?à\.?c\.?|càc|cac)$/i, 'cuillère à café', 'cuillères à café'], [/^(c\.?à\.?s\.?|càs|cas)$/i, 'cuillère à soupe', 'cuillères à soupe'],
]
const ABBR_RX = /(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s*(tsps?|teaspoons?|tbsps?|tbs|tablespoons?|oz|lbs?|cups?|cdtas?|cdas?|tza|tz|TL|EL|c\.?à\.?[cs]\.?|càc|càs)(?![\p{L}])/gu

const NUM = '\\d+(?:[.,]\\d+)?'
const SEP = '(?:\\s*[–-]\\s*|\\s+(?:a|to|bis|à|o|or)\\s+)' // a range between two numbers
const UNITS = "kg|kilos?|chili|chilo|mg|ml|cl|dl|grams?|gramos?|grammi|grammo|grammes?|gramm|grs|gr|g|litros?|litri|litro|litres?|liters?|l|" +
  "hours?|horas?|ore|ora|heures?|stunden?|hrs|hr|h|minutes?|minutos?|minuti|minuto|minuten|mins|min|seconds?|segundos?|secondi|secondo|secondes?|sekunden?|secs|sec|''|'|s"
const QTY_RX = new RegExp(`(${NUM})(?:${SEP}(${NUM}))?(\\+)?\\s*(${UNITS})(?![\\p{L}\\d'])`, 'gu')
const HM_RX = /(\d+)\s*(?:h|hrs?|hours?)\s*(?:and\s+)?(\d{1,2})(?:\s*(?:min|mins|minutes?|'))?(?![\p{L}\d])/giu

const RANGE = '\u0001'
const toNum = (s) => parseFloat(String(s).replace(',', '.'))

export function forSpeech(text, lang = 'en') {
  const code = (lang || 'en').slice(0, 2)
  const w = L[code] || L.en
  const units = U[code] || U.en
  const show = (n) => { const s = String(+n.toFixed(2)); return w.comma ? s.replace('.', ',') : s }

  // 4.5 hours said as "4 and a half hours" / "4 horas y media"; 1.2 hours as hours and minutes.
  const amount = (value, key) => {
    const [one, many] = units[key]
    const whole = Math.floor(value + 1e-9)
    const frac = +(value - whole).toFixed(3)
    const f = frac === 0.5 ? 'h' : frac === 0.25 ? 'q' : frac === 0.75 ? 't' : null
    if (frac === 0) return `${whole} ${whole === 1 ? one : many}`
    if (f) { const said = w.frac(whole, f, units[key], key); if (said) return said }
    if (key === 'h' && whole > 0) {
      const mins = Math.round(frac * 60)
      return `${whole} ${whole === 1 ? one : many} ${w.and} ${mins} ${units.min[mins === 1 ? 0 : 1]}`
    }
    return `${show(value)} ${many}`
  }
  // "between 22 and 26 grams" when both are whole; "between 4 and a half hours and 6 hours" otherwise.
  // (RANGE marks where a range starts; see the end.)
  const range = (a, b, key) => RANGE + (Number.isInteger(a) && Number.isInteger(b)
    ? `${w.between(show(a), show(b))} ${units[key][1]}`
    : w.between(amount(a, key), amount(b, key)))

  let t = String(text || '').replace(/º/g, '°').replace(/\s+/g, ' ')

  // "7/8 ore", "22/26 °C": outside English a slash between numbers is a range ("1/2" stays a half).
  if (w.comma) t = t.replace(/\b(\d+)\/(\d+)\b/g, (m, a, b) => (+a === 1 ? m : `${a}–${b}`))
  // "1° impasto" — an ordinal, not a temperature.
  t = t.replace(/\b([1-3])\s*°\s+(?=[\p{L}])(?![CcFf]\b)/gu, (_, n) => `${w.ord[+n - 1]} `)
  // "1h30", "1 h 30 min" → "1 hour and 30 minutes".
  t = t.replace(HM_RX, (_, h, m) => `${amount(+h, 'h')} ${w.and} ${amount(+m, 'min')}`)
  // Temperatures: "30°", "28 °C", "22–26 °C", "180°F", "30c" (a bare "c" only from 15 up).
  const temp = (a, b, u) => {
    const scale = u && /f/i.test(u) ? w.F : w.C
    return b ? `${RANGE}${w.between(show(toNum(a)), show(toNum(b)))} ${scale}` : `${show(toNum(a))} ${scale}`
  }
  t = t.replace(new RegExp(`(${NUM})(?:${SEP}(${NUM}))?\\s*°\\s*([CcFf])?(?![\\p{L}])`, 'gu'), (_, a, b, u) => temp(a, b, u))
  t = t.replace(new RegExp(`(${NUM})(?:\\s*[–-]\\s*(${NUM}))?\\s?([CcFf])(?![\\p{L}\\d])`, 'gu'), (m, a, b, u) => (toNum(a) >= 15 ? temp(a, b, u) : m))
  // Times and quantities: "12h", "40 min", "4.5–6 h", "5 a 6 minutos", "20+ h", "500 g", "1.5 kg".
  t = t.replace(QTY_RX, (m, a, b, plus, u) => {
    const key = unitOf(u)
    if (!key) return m
    if (plus) return `${w.more} ${amount(toNum(a), key)}`
    return b ? range(toNum(a), toNum(b), key) : amount(toNum(a), key)
  })
  t = t.replace(ABBR_RX, (m, n, u) => {
    const hit = ABBR.find(([rx]) => rx.test(u))
    return hit ? `${n} ${toNum(n) === 1 || /\//.test(n) ? hit[1] : hit[2]}` : m
  })
  // Percent, "2.5–3×" / "2.7×" / "3 × 550", "~170".
  t = t.replace(new RegExp(`(${NUM})${SEP}(${NUM})\\s*%`, 'g'), (_, a, b) => `${RANGE}${w.between(show(toNum(a)), show(toNum(b)))} ${w.pct}`)
  t = t.replace(new RegExp(`(${NUM})\\s*%`, 'g'), (_, a) => `${show(toNum(a))} ${w.pct}`)
  t = t.replace(new RegExp(`(${NUM})${SEP}(${NUM})\\s*[×x](?=[\\s.,;:)]|$)`, 'g'), (_, a, b) => `${RANGE}${w.between(show(toNum(a)), show(toNum(b)))} ${w.times}`)
  t = t.replace(new RegExp(`(${NUM})\\s*[×x](?=[\\s.,;:)]|$)`, 'g'), (_, a) => `${show(toNum(a))} ${w.times}`)
  t = t.replace(/\s×\s/g, ` ${w.times} `)
  t = t.replace(/~\s*/g, `${w.about} `)
  // Ratios "1:3:43" (not a clock time like 8:30).
  t = t.replace(new RegExp(`\\b(${NUM})(:${NUM}){1,3}\\b`, 'g'), (m) => (/^\d{1,2}:\d{2}$/.test(m) ? m : m.split(':').join(` ${w.to} `)))
  // Other ranges between numbers: "pH 4.0–4.3" → "pH between 4.0 and 4.3".
  t = t.replace(new RegExp(`(${NUM})\\s*[–-]\\s*(${NUM})`, 'g'), (_, a, b) => RANGE + w.between(a, b))
  t = t.replace(/\s&\s/g, ` ${w.and} `)
  // "Sal/pimienta/comino" is a list: "sal, pimienta, comino".
  t = t.replace(/(\p{L})\s*\/\s*(?=\p{L})/gu, '$1, ')
  // Arrows and bullets are pauses, not words.
  t = t.replace(/\s*(→|->|⇒|•|·)\s*/g, ', ')
  // A range says the approximation itself: drop "circa / about / unos" and a bare "a / at / per"
  // just before it ("a entre 22 y 26 grados" → "entre 22 y 26 grados").
  t = t.replace(new RegExp(`(?:\\b(?:a|at|à|per|bei)\\s+)?(?:\\b(?:circa|about|around|approx\\.?|aprox\\.?|unos|unas|environ|etwa|ca\\.)\\s+)?${RANGE}`, 'giu'), '')
  t = t.split(RANGE).join('')
  // Decimals said the local way: "4,5" in Spanish, Italian, French, German.
  if (w.comma) t = t.replace(/(\d)\.(\d)/g, '$1,$2')
  return t.replace(/\s+/g, ' ').trim()
}
