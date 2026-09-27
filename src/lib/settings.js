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

// The boxes of a recipe page. Their order, column (side-by-side layout) and folded state are
// a personal layout, so they are kept per device like the rest of these settings.
export const BLOCK_IDS = ['ingredients', 'video', 'method', 'notes', 'photos']
const DEFAULT_BLOCKS = {
  order: BLOCK_IDS,
  col: { ingredients: 'left', video: 'right', method: 'right', notes: 'right', photos: 'right' },
  collapsed: {},
}
// Phones show one column in this order; there the video opens first, above everything.
export const isPhoneDevice = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(max-width: 760px)').matches || /Android|iPhone|iPod/i.test(navigator.userAgent))
const videoFirst = (b) => ({
  ...b,
  order: ['video', ...(b.order || BLOCK_IDS).filter((id) => id !== 'video')],
  collapsed: { ...(b.collapsed || {}), video: false },
})
const defaultBlocks = () => (isPhoneDevice() ? videoFirst(DEFAULT_BLOCKS) : DEFAULT_BLOCKS)
export function normalizeBlocks(b) {
  const order = (Array.isArray(b?.order) ? b.order : []).filter((id) => BLOCK_IDS.includes(id))
  BLOCK_IDS.forEach((id) => { if (!order.includes(id)) order.push(id) })
  return { order, col: { ...DEFAULT_BLOCKS.col, ...(b?.col || {}) }, collapsed: { ...(b?.collapsed || {}) } }
}

// Bumped when a default changes in a way saved settings should pick up once.
const VERSION = 2

export const DEFAULTS = {
  v: VERSION,
  theme: 'slate',
  textSize: 'm',
  layout: 'stacked', // 'stacked' | 'split' (ingredients beside the method on wide screens)
  translateLang: 'English',
  exportNotes: false,
  sidebar: true,
  blocks: DEFAULT_BLOCKS,
}

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!raw) return { ...DEFAULTS, blocks: normalizeBlocks(defaultBlocks()) }
    let s = { ...DEFAULTS, ...raw }
    if ((raw.v || 1) < 2) {
      // 2026-09-27: the dark template (Slate) became the default, and phones open recipes
      // with the video first. Applied once; a template picked afterwards is kept.
      s = { ...s, v: 2, theme: 'slate', blocks: isPhoneDevice() ? videoFirst(normalizeBlocks(s.blocks)) : s.blocks }
      saveSettings(s)
    }
    return { ...s, blocks: normalizeBlocks(s.blocks) }
  } catch (_) {
    return { ...DEFAULTS, blocks: normalizeBlocks(defaultBlocks()) }
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
