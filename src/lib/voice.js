import { useRef, useState } from 'react'

export const VOICE_LANGS = [
  { code: 'es-ES', label: 'Español' },
  { code: 'en-US', label: 'English' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'it-IT', label: 'Italiano' },
]

const BAKING_CORRECTIONS = {
  'krave': 'krapfen', 'crave': 'krapfen', 'grave': 'krapfen',
  'macaroon': 'macaron', 'macarons': 'macaron',
  'brigadeiro': 'brigadeiro', 'briggadeiro': 'brigadeiro',
  'panettoni': 'panettone', 'panetoni': 'panettone',
  'focaccia': 'focaccia', 'fokacia': 'focaccia',
  'brioche': 'brioche', 'brioce': 'brioche', 'briosh': 'brioche',
  'croissant': 'croissant', 'cruasson': 'croissant', 'cruasán': 'croissant',
  'baguette': 'baguette', 'baguet': 'baguette',
  'choux': 'choux', 'chu': 'choux',
  'feuilletage': 'feuilletage', 'feiyetage': 'feuilletage',
  'laminage': 'laminage',
  'autolyse': 'autolyse', 'autolisis': 'autolyse',
  'levain': 'levain', 'levén': 'levain',
  'poolish': 'poolish', 'pulich': 'poolish',
  'biga': 'biga', 'viga': 'biga',
  'sourdough': 'sourdough', 'sour dough': 'sourdough',
  'lievito naturale': 'lievito naturale', 'levito natural': 'lievito naturale',
  'maillard': 'maillard', 'mayar': 'maillard',
  'tangzhong': 'tangzhong', 'tanjon': 'tangzhong',
  'viennoiserie': 'viennoiserie', 'vienoiserie': 'viennoiserie',
  'pâte feuilletée': 'pâte feuilletée',
  'crème pâtissière': 'crème pâtissière', 'creme patissiere': 'crème pâtissière',
  'ganache': 'ganache', 'ganatche': 'ganache',
  'praline': 'praliné', 'pralinee': 'praliné',
  'couverture': 'couverture', 'covercure': 'couverture',
}

export function correctBakingTerms(text) {
  let r = text
  Object.entries(BAKING_CORRECTIONS).forEach(([wrong, right]) => {
    const rx = new RegExp('\\b' + wrong + '\\b', 'gi')
    r = r.replace(rx, right)
  })
  return r
}

export function useVoiceInput(onTranscript, smartCorrect = true) {
  const [recording, setRecording] = useState(false)
  const [lang, setLang] = useState(() => localStorage.getItem('qdplus_voice_lang') || 'es-ES')
  const ref = useRef(null)
  const acc = useRef('')

  function saveLang(l) {
    setLang(l)
    localStorage.setItem('qdplus_voice_lang', l)
  }

  function start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Voice input requires Chrome.'); return }
    const r = new SR()
    r.lang = lang
    r.continuous = true
    r.interimResults = false
    r.onresult = (e) => {
      const t = Array.from(e.results).slice(e.resultIndex).filter((x) => x.isFinal).map((x) => x[0].transcript).join(' ')
      if (t) acc.current += (acc.current ? ' ' : '') + t
    }
    r.onend = () => {
      setRecording(false)
      if (acc.current.trim()) {
        const final = smartCorrect ? correctBakingTerms(acc.current.trim()) : acc.current.trim()
        onTranscript(final)
        acc.current = ''
      }
    }
    r.onerror = () => setRecording(false)
    r.start()
    ref.current = r
    acc.current = ''
    setRecording(true)
  }

  function stop() {
    ref.current?.stop()
  }

  return { recording, start, stop, lang, setLang: saveLang, VOICE_LANGS }
}
