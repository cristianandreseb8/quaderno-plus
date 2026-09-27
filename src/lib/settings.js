import { createContext, useContext } from 'react'

// Appearance and reading preferences are per device (a phone in the kitchen and a laptop in
// the office often want different templates), so they live in localStorage, not the DB.
const KEY = 'qdplus_settings'

export const THEMES = [
  { id: 'clean', name: 'Clean', desc: 'Crisp white, warm accent', colors: ['#FFFFFF', '#F6F5F2', '#B8652A', '#1F3A4D'], font: 'serif' },
  { id: 'paper', name: 'Paper', desc: 'Cream notebook, the classic look', colors: ['#FAF7F0', '#F3EDE1', '#BC6C2C', '#1F3A4D'], font: 'serif' },
  { id: 'bistro', name: 'Bistro', desc: 'Warm linen, burgundy, elegant titles', colors: ['#F8F4EC', '#F1EADD', '#8C2F39', '#3B2A20'], font: 'didone' },
  { id: 'nordic', name: 'Nordic', desc: 'Cool grey, modern sans-serif', colors: ['#F6F7F8', '#FFFFFF', '#2E6F8E', '#1C2127'], font: 'sans' },
  { id: 'kitchen', name: 'Kitchen', desc: 'High contrast, larger text for the line', colors: ['#FFFFFF', '#F2F2F2', '#C2410C', '#000000'], font: 'sans-bold' },
  { id: 'slate', name: 'Slate', desc: 'Dark, easy on the eyes at night', colors: ['#131518', '#22262C', '#E09A5B', '#E9E6E1'], font: 'serif', dark: true },
]

export const TEXT_SIZES = [
  { id: 's', label: 'S' },
  { id: 'm', label: 'M' },
  { id: 'l', label: 'L' },
  { id: 'xl', label: 'XL' },
]

export const DEFAULTS = {
  theme: 'clean',
  textSize: 'm',
  layout: 'stacked', // 'stacked' | 'split' (ingredients beside the method on wide screens)
  translateLang: 'English',
  exportNotes: false,
}

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch (_) {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch (_) { /* storage unavailable */ }
}

export function applySettings(s) {
  const root = document.documentElement
  root.dataset.theme = s.theme
  root.dataset.textsize = s.textSize
  const theme = THEMES.find((t) => t.id === s.theme) || THEMES[0]
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta) }
  meta.content = theme.colors[0]
}

export const SettingsContext = createContext({ settings: DEFAULTS, update: () => {} })
export const useSettings = () => useContext(SettingsContext)
