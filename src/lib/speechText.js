// Recipe text rewritten for the ear: "12h" → "12 hours", "30°" / "30c" → "30 degrees Celsius",
// "500 g" → "500 grams", "4.5–6 h" → "4.5 to 6 hours", "2.7×" → "2.7 times" — in the language
// the text is read in, so a voice says what a cook would say rather than spelling symbols.

const W = {
  en: { h: ['hour', 'hours'], min: ['minute', 'minutes'], s: ['second', 'seconds'], C: 'degrees Celsius', F: 'degrees Fahrenheit', g: ['gram', 'grams'], kg: ['kilogram', 'kilograms'], mg: ['milligram', 'milligrams'], ml: ['milliliter', 'milliliters'], cl: ['centiliter', 'centiliters'], dl: ['deciliter', 'deciliters'], l: ['liter', 'liters'], pct: 'percent', times: 'times', to: 'to', about: 'about', and: 'and', more: 'more than', ord: ['first', 'second', 'third'], comma: false },
  es: { h: ['hora', 'horas'], min: ['minuto', 'minutos'], s: ['segundo', 'segundos'], C: 'grados Celsius', F: 'grados Fahrenheit', g: ['gramo', 'gramos'], kg: ['kilo', 'kilos'], mg: ['miligramo', 'miligramos'], ml: ['mililitro', 'mililitros'], cl: ['centilitro', 'centilitros'], dl: ['decilitro', 'decilitros'], l: ['litro', 'litros'], pct: 'por ciento', times: 'veces', to: 'a', about: 'unos', and: 'y', more: 'más de', ord: ['primer', 'segundo', 'tercer'], comma: true },
  it: { h: ['ora', 'ore'], min: ['minuto', 'minuti'], s: ['secondo', 'secondi'], C: 'gradi Celsius', F: 'gradi Fahrenheit', g: ['grammo', 'grammi'], kg: ['chilo', 'chili'], mg: ['milligrammo', 'milligrammi'], ml: ['millilitro', 'millilitri'], cl: ['centilitro', 'centilitri'], dl: ['decilitro', 'decilitri'], l: ['litro', 'litri'], pct: 'per cento', times: 'volte', to: 'a', about: 'circa', and: 'e', more: 'più di', ord: ['primo', 'secondo', 'terzo'], comma: true },
  fr: { h: ['heure', 'heures'], min: ['minute', 'minutes'], s: ['seconde', 'secondes'], C: 'degrés Celsius', F: 'degrés Fahrenheit', g: ['gramme', 'grammes'], kg: ['kilo', 'kilos'], mg: ['milligramme', 'milligrammes'], ml: ['millilitre', 'millilitres'], cl: ['centilitre', 'centilitres'], dl: ['décilitre', 'décilitres'], l: ['litre', 'litres'], pct: 'pour cent', times: 'fois', to: 'à', about: 'environ', and: 'et', more: 'plus de', ord: ['premier', 'deuxième', 'troisième'], comma: true },
  de: { h: ['Stunde', 'Stunden'], min: ['Minute', 'Minuten'], s: ['Sekunde', 'Sekunden'], C: 'Grad Celsius', F: 'Grad Fahrenheit', g: ['Gramm', 'Gramm'], kg: ['Kilo', 'Kilo'], mg: ['Milligramm', 'Milligramm'], ml: ['Milliliter', 'Milliliter'], cl: ['Zentiliter', 'Zentiliter'], dl: ['Deziliter', 'Deziliter'], l: ['Liter', 'Liter'], pct: 'Prozent', times: 'mal', to: 'bis', about: 'etwa', and: 'und', more: 'mehr als', ord: ['erste', 'zweite', 'dritte'], comma: true },
}

// Kitchen abbreviations, said in full (the abbreviation tells the language): [pattern, one, many].
const ABBR = [
  [/^(tsp|tsps|teaspoons?)$/i, 'teaspoon', 'teaspoons'], [/^(tbsp|tbsps|tbs|tablespoons?)$/i, 'tablespoon', 'tablespoons'],
  [/^oz$/i, 'ounce', 'ounces'], [/^(lb|lbs)$/i, 'pound', 'pounds'], [/^cups?$/i, 'cup', 'cups'],
  [/^(cdta|cdtas)$/i, 'cucharadita', 'cucharaditas'], [/^(cda|cdas)$/i, 'cucharada', 'cucharadas'], [/^(tz|tza)$/i, 'taza', 'tazas'],
  [/^TL$/, 'Teelöffel', 'Teelöffel'], [/^EL$/, 'Esslöffel', 'Esslöffel'],
  [/^(c\.?à\.?c\.?|càc|cac)$/i, 'cuillère à café', 'cuillères à café'], [/^(c\.?à\.?s\.?|càs|cas)$/i, 'cuillère à soupe', 'cuillères à soupe'],
]
const ABBR_RX = /(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s*(tsps?|teaspoons?|tbsps?|tbs|tablespoons?|oz|lbs?|cups?|cdtas?|cdas?|tza|tz|TL|EL|c\.?à\.?[cs]\.?|càc|càs)(?![\p{L}])/gu

const UNIT = {
  h: /^(h|hr|hrs|hours?)$/i,
  min: /^(m|min|mins|minutes?|')$/i,
  s: /^(s|sec|secs|seconds?|'')$/i,
  kg: /^kg$/i, mg: /^mg$/i, g: /^(g|gr|grs)$/i, ml: /^ml$/i, cl: /^cl$/i, dl: /^dl$/i, l: /^l$/i,
}
const unitOf = (u) => Object.keys(UNIT).find((k) => UNIT[k].test(u))

const NUM = '\\d+(?:[.,]\\d+)?'
// number, optional range ("4.5–6", "7/8", "5 a 6"), optional "+", unit
const QTY_RX = new RegExp(`(${NUM})(?:\\s*(?:[–-]|/|\\s(?:a|to|bis|à)\\s)\\s*(${NUM}))?(\\+)?\\s*(kg|mg|ml|cl|dl|grs|gr|g|l|hours?|hrs|hr|h|minutes?|mins|min|seconds?|secs|sec|''|'|s)(?![\\p{L}\\d'])`, 'gu')

export function forSpeech(text, lang = 'en') {
  const w = W[(lang || 'en').slice(0, 2)] || W.en
  const one = (n) => parseFloat(String(n).replace(',', '.')) === 1
  let t = String(text || '').replace(/º/g, '°').replace(/\s+/g, ' ')

  // "1° impasto" (an ordinal, in Italian and Spanish) — not a temperature.
  t = t.replace(/\b([1-3])\s*°\s+(?=[\p{L}])(?![CcFf]\b)/gu, (_, n) => `${w.ord[+n - 1]} `)
  // "7/8 ore", "22/26 °C": in Italian, Spanish, French and German a slash between two numbers is
  // a range ("1/2" stays a half); in English it is a fraction ("3/4 cup").
  if (w.comma) t = t.replace(/\b(\d+)\/(\d+)\b/g, (m, a, b) => (+a === 1 ? m : `${a}–${b}`))
  // Temperatures: "30°", "30 °C", "22–26 °C", "180°F", "30c" (a bare "c" only for 15 and up).
  t = t.replace(new RegExp(`(${NUM})(?:\\s*[–-]\\s*(${NUM}))?\\s*°\\s*([CcFf])?(?![\\p{L}])`, 'gu'),
    (_, a, b, u) => `${a}${b ? ` ${w.to} ${b}` : ''} ${u && /f/i.test(u) ? w.F : w.C}`)
  t = t.replace(new RegExp(`(${NUM})(?:\\s*[–-]\\s*(${NUM}))?\\s?([CcFf])(?![\\p{L}\\d])`, 'gu'),
    (m, a, b, u) => (parseFloat(a) >= 15 ? `${a}${b ? ` ${w.to} ${b}` : ''} ${/f/i.test(u) ? w.F : w.C}` : m))
  // Times and quantities: "12h", "40 min", "4.5–6 h", "7/8 ore", "20+ h", "500 g", "1 kg".
  t = t.replace(QTY_RX, (m, a, b, plus, u) => {
    const k = unitOf(u)
    if (!k) return m
    const words = w[k]
    const word = !b && one(a) ? words[0] : words[1]
    if (plus) return `${w.more} ${a} ${word}`
    return `${a}${b ? ` ${w.to} ${b}` : ''} ${word}`
  })
  t = t.replace(ABBR_RX, (m, n, u) => {
    const hit = ABBR.find(([rx]) => rx.test(u))
    return hit ? `${n} ${one(n) || /\//.test(n) ? hit[1] : hit[2]}` : m
  })
  // Percent, "2.7×" / "3 × 550", "~170".
  t = t.replace(new RegExp(`(${NUM})\\s*%`, 'g'), (_, a) => `${a} ${w.pct}`)
  t = t.replace(new RegExp(`(${NUM})\\s*[×x](?=[\\s.,;:)]|$)`, 'g'), (_, a) => `${a} ${w.times}`)
  t = t.replace(/\s×\s/g, ` ${w.times} `)
  t = t.replace(/~\s*/g, `${w.about} `)
  // Ratios "1:3:43" (not a clock time like 8:30).
  t = t.replace(new RegExp(`\\b(${NUM})(:${NUM}){1,3}\\b`, 'g'), (m) => (/^\d{1,2}:\d{2}$/.test(m) ? m : m.split(':').join(` ${w.to} `)))
  // Remaining number ranges: "pH 4.0–4.3", "2.5–3".
  t = t.replace(new RegExp(`(${NUM})\\s*[–-]\\s*(${NUM})`, 'g'), (_, a, b) => `${a} ${w.to} ${b}`)
  t = t.replace(/\s&\s/g, ` ${w.and} `)
  // Arrows and bullets are pauses, not words ("pH toward 3.9 → 1:2:43").
  t = t.replace(/\s*(→|->|⇒|•|·)\s*/g, ', ')
  // Decimals said the local way: "4,5" in Spanish, Italian, French, German.
  if (w.comma) t = t.replace(/(\d)\.(\d)/g, '$1,$2')
  return t.replace(/\s+/g, ' ').trim()
}
