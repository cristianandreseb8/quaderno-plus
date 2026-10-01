import { createContext, useContext } from 'react'

// Appearance and reading preferences are per device (a phone in the kitchen and a laptop in
// the office often want different templates), so they live in localStorage, not the DB.
const KEY = 'qdplus_settings'

// heading: the title font (also used for the card preview). fonts: the Google Fonts families a
// template needs — loaded only when that template is used, or while templates are browsed.
const SYS_SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
const SYS_SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
export const THEMES = [
  // Light
  { id: 'clean', name: 'Clean', desc: 'Crisp white, warm accent', colors: ['#FFFFFF', '#F6F5F2', '#B8652A', '#1F3A4D'], heading: SYS_SERIF },
  { id: 'paper', name: 'Paper', desc: 'Cream notebook, the classic look', colors: ['#FAF7F0', '#F3EDE1', '#BC6C2C', '#1F3A4D'], heading: SYS_SERIF },
  { id: 'bistro', name: 'Bistro', desc: 'Warm linen, burgundy, elegant titles', colors: ['#F8F4EC', '#F1EADD', '#8C2F39', '#3B2A20'], heading: 'Didot, "Bodoni 72", Georgia, serif' },
  { id: 'atelier', name: 'Atelier', desc: 'Ivory and bronze, fine pâtisserie serif', colors: ['#FBF8F3', '#F2ECE2', '#9A6B3F', '#1A1714'], heading: '"Cormorant Garamond", Georgia, serif', fonts: 'family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700' },
  { id: 'nordic', name: 'Nordic', desc: 'Cool grey, modern sans-serif', colors: ['#F6F7F8', '#FFFFFF', '#2E6F8E', '#1C2127'], heading: SYS_SANS, headingWeight: 650 },
  { id: 'studio', name: 'Studio', desc: 'All Inter, sharp and minimal', colors: ['#FFFFFF', '#F4F4F5', '#2F54EB', '#111114'], heading: 'Inter, system-ui, sans-serif', headingWeight: 700, fonts: 'family=Inter:wght@400;500;600;700;800' },
  { id: 'bakery', name: 'Bakery', desc: 'Friendly rounded type, warm peach', colors: ['#FFF7F0', '#FDEBDD', '#E0763F', '#3A2418'], heading: 'Nunito, system-ui, sans-serif', headingWeight: 800, fonts: 'family=Nunito:wght@400;500;600;700;800' },
  { id: 'lab', name: 'Lab', desc: 'Plex type, like an R&D notebook', colors: ['#F4F5F2', '#FFFFFF', '#0F7B6C', '#1B1F1D'], heading: '"IBM Plex Mono", monospace', headingWeight: 600, fonts: 'family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700' },
  { id: 'kitchen', name: 'Kitchen', desc: 'High contrast, larger text for the line', colors: ['#FFFFFF', '#F2F2F2', '#C2410C', '#000000'], heading: SYS_SANS, headingWeight: 800 },
  { id: 'jan', name: 'Jan', desc: 'Calm and quiet — timers are grey bars that fill between the steps', colors: ['#F7F6F2', '#EDEBE5', '#4E6A5E', '#262624'], heading: 'Manrope, system-ui, sans-serif', headingWeight: 700, fonts: 'family=Manrope:wght@400;500;600;700;800', stepBars: true },
  // Dark
  { id: 'slate', name: 'Slate', desc: 'Dark, easy on the eyes at night', colors: ['#131518', '#22262C', '#E09A5B', '#E9E6E1'], heading: SYS_SERIF, dark: true },
  { id: 'noir', name: 'Noir', desc: 'Pure black and gold, grand titles', colors: ['#0A0A0A', '#181818', '#D4AF6A', '#F2EFEA'], heading: '"Playfair Display", Georgia, serif', fonts: 'family=Playfair+Display:wght@500;600;700', dark: true },
  { id: 'espresso', name: 'Espresso', desc: 'Dark roast browns, soft serif', colors: ['#1A1411', '#2C231D', '#D9975B', '#EFE4D6'], heading: 'Fraunces, Georgia, serif', fonts: 'family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700', dark: true },
  { id: 'forest', name: 'Forest', desc: 'Deep green, calm and bookish', colors: ['#0F1512', '#1E2822', '#8FC19A', '#E3EAE4'], heading: 'Lora, Georgia, serif', fonts: 'family=Lora:wght@500;600;700', dark: true },
  { id: 'midnight', name: 'Midnight', desc: 'Night blue, geometric sans', colors: ['#0E1422', '#1C2539', '#7FB2FF', '#E4E9F2'], heading: '"Space Grotesk", system-ui, sans-serif', headingWeight: 600, fonts: 'family=Space+Grotesk:wght@500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700', dark: true },
]

// Load a template's web fonts once (a <link> per template; the browser caches the files).
export function loadThemeFonts(theme) {
  if (!theme?.fonts || typeof document === 'undefined') return
  const id = `qd-font-${theme.id}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${theme.fonts}&display=swap`
  document.head.appendChild(link)
}

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
  proofread: true, // spelling underlines and the AI "Check spelling" button in the editor
  chefMode: 'pro', // 'pro' (steps overview, next step, step clock, voice commands…) or 'simple'
  heyChef: {}, // { auto: start listening when the app opens, lang: 'auto' | 'en-US' | 'es-ES' …, speak: answer out loud }
  custom: [], // your own templates (customOf, templateFrom below); in use as theme 'custom:<id>'
  jan: {}, // "Jan" made yours: { colors: { bg, surface, ink, muted, line, accent, bar }, fonts: { heading, body, numbers }, aligned, season, peek, region }
  sidebar: true,
  sideWidth: null, // px, once the list has been resized by dragging its edge
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

// Fonts Jan can be set in (Google Fonts families).
export const JAN_FONTS = [
  ['System sans', 'sans'], ['System serif', 'serif'], ['System mono', 'mono'],
  ['Manrope', 'sans'], ['Inter', 'sans'], ['DM Sans', 'sans'], ['Work Sans', 'sans'], ['Karla', 'sans'], ['Nunito', 'sans'], ['Rubik', 'sans'],
  ['Space Grotesk', 'sans'], ['Josefin Sans', 'sans'], ['Quicksand', 'sans'], ['IBM Plex Sans', 'sans'],
  ['Lora', 'serif'], ['Fraunces', 'serif'], ['Playfair Display', 'serif'], ['Cormorant Garamond', 'serif'], ['EB Garamond', 'serif'],
  ['Libre Baskerville', 'serif'], ['Source Serif 4', 'serif'], ['Newsreader', 'serif'],
  ['IBM Plex Mono', 'mono'], ['JetBrains Mono', 'mono'], ['DM Mono', 'mono'], ['Space Mono', 'mono'],
]
// Background, text and accent lead; cards, soft text, lines and bars follow them unless chosen too.
export const JAN_COLORS = [
  ['bg', 'Background', '#F7F6F2'], ['ink', 'Text', '#262624'], ['accent', 'Accent (buttons, links)', '#4E6A5E'],
  ['surface', 'Cards and fields', '#FCFBF8'], ['muted', 'Soft text', '#6E6B64'], ['line', 'Lines', '#E4E1DA'], ['bar', 'Timer bars', '#4E6A5E'],
]
export const JAN_DEFAULTS = { aligned: true, season: true, peek: true }
export const janOption = (s, key) => (s?.jan?.[key] ?? JAN_DEFAULTS[key])
const FALLBACK = { sans: 'ui-sans-serif, system-ui, sans-serif', serif: 'Georgia, serif', mono: 'ui-monospace, Menlo, monospace' }
const SYSTEM = { 'System sans': SYS_SANS, 'System serif': SYS_SERIF, 'System mono': FALLBACK.mono }
export const fontStack = (name) => { if (SYSTEM[name]) return SYSTEM[name]; const f = JAN_FONTS.find(([n]) => n === name); return f ? `"${f[0]}", ${FALLBACK[f[1]]}` : null }
// Light text on a dark accent, dark text on a light one.
function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1A1A1A' : '#FFFFFF'
}
// Jan made yours, and your own templates, are drawn from a few colours and fonts set on the page
// (variables.css mixes every other shade from them).
const OPTION_ATTRS = ['corners', 'spacing', 'heads', 'stepnums', 'lines', 'amounts', 'dark']
function applyJan(s) {
  const root = document.documentElement
  const vars = ['--jan-bg', '--jan-surface', '--jan-ink', '--jan-muted', '--jan-line', '--jan-accent', '--jan-bar', '--jan-heading-font', '--jan-body-font', '--jan-mono-font', '--accent-ink', '--heading-weight']
  vars.forEach((v) => root.style.removeProperty(v))
  OPTION_ATTRS.forEach((a) => delete root.dataset[a])
  root.style.removeProperty('color-scheme')
  const custom = customOf(s)
  const look = custom || (s.theme === 'jan' ? s.jan || {} : null)
  if (!look) return
  const c = look.colors || {}
  Object.entries(c).forEach(([k, v]) => { if (v) root.style.setProperty(`--jan-${k}`, v) })
  if (c.accent && inkOn(c.accent)) root.style.setProperty('--accent-ink', inkOn(c.accent))
  const f = look.fonts || {}
  const families = []
  ;[['heading', '--jan-heading-font'], ['body', '--jan-body-font'], ['numbers', '--jan-mono-font']].forEach(([k, v]) => {
    const stack = fontStack(f[k])
    if (stack) { root.style.setProperty(v, stack); if (!SYSTEM[f[k]]) families.push(f[k]) }
  })
  if (families.length) {
    loadThemeFonts({ id: `jan-${families.join('-').replace(/\s+/g, '')}`, fonts: [...new Set(families)].map((n) => `family=${n.replace(/ /g, '+')}:wght@400;500;600;700;800`).join('&') })
  }
  if (!custom) return
  if (custom.weight) root.style.setProperty('--heading-weight', String(custom.weight))
  const set = (a, v, plain) => { if (v != null && v !== plain) root.dataset[a] = String(v) }
  set('corners', custom.corners, 'soft')
  set('spacing', custom.spacing, 'comfortable')
  set('heads', custom.heads, 'theme')
  set('stepnums', custom.stepNums, 'numbers')
  if (custom.lines === false) root.dataset.lines = '0'
  set('amounts', custom.amounts, 'bold')
  if (isDark(c.bg)) { root.dataset.dark = '1'; root.style.setProperty('color-scheme', 'dark') }
}
const isDark = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return false; const n = parseInt(m[1], 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.45 }

// ── Your own templates ───────────────────────────────────────────────────────
// settings.custom: [{ id, name, colors: { bg, ink, accent, surface, muted, line, bar }, fonts: { heading, body, numbers },
//   weight, corners: 'square' | 'soft' | 'round', spacing: 'compact' | 'comfortable' | 'airy',
//   heads: 'theme' | 'normal' | 'upper' | 'smallcaps', stepNums: 'numbers' | 'circles' | 'none',
//   lines, amounts: 'bold' | 'accent' | 'plain', stepBars, aligned, season, peek, region }].
// The one in use: settings.theme = 'custom:<id>'.
export const customOf = (s) => (String(s?.theme || '').startsWith('custom:') ? (s.custom || []).find((t) => `custom:${t.id}` === s.theme) || null : null)
const firstFamily = (stack) => String(stack || '').split(',')[0].replace(/["']/g, '').trim()
// A new template, starting from the one in use (or any other).
export function templateFrom(s, themeId = s.theme) {
  const own = (s.custom || []).find((t) => `custom:${t.id}` === themeId)
  if (own) return { ...JSON.parse(JSON.stringify(own)), id: undefined, name: `${own.name} copy` }
  if (themeId === 'jan') {
    const color = (k) => s.jan?.colors?.[k] || JAN_COLORS.find(([x]) => x === k)[2]
    return {
      name: 'My Jan', colors: Object.fromEntries(JAN_COLORS.map(([k]) => [k, color(k)])),
      fonts: { heading: s.jan?.fonts?.heading || 'Manrope', body: s.jan?.fonts?.body || 'Manrope', numbers: s.jan?.fonts?.numbers || 'System mono' },
      weight: 700, corners: 'soft', spacing: 'comfortable', heads: 'theme', stepNums: 'numbers', lines: true, amounts: 'bold',
      stepBars: true, aligned: janOption(s, 'aligned'), season: janOption(s, 'season'), peek: janOption(s, 'peek'), region: s.jan?.region || '',
    }
  }
  const t = THEMES.find((x) => x.id === themeId) || THEMES[0]
  const [bg, surface2, accent, ink] = t.colors
  const head = firstFamily(t.heading)
  const known = JAN_FONTS.some(([n]) => n === head)
  const serif = /serif/i.test(t.heading) && !/sans-serif/i.test(t.heading)
  const heading = known ? head : (serif ? 'System serif' : 'System sans')
  const body = known && !serif ? head : 'System sans'
  const mix = (a, b, w) => { const p = (h) => parseInt(h.slice(1), 16); const x = p(a), y = p(b); const ch = (sh) => Math.round(((x >> sh) & 255) * w + ((y >> sh) & 255) * (1 - w)); return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}` }
  return {
    name: `My ${t.name}`,
    colors: { bg, ink, accent, surface: t.dark ? surface2 : mix(bg, '#ffffff', 0.5), muted: mix(ink, bg, 0.62), line: mix(bg, ink, 0.86), bar: accent },
    fonts: { heading, body, numbers: 'System mono' },
    weight: t.headingWeight || 600, corners: 'soft', spacing: 'comfortable', heads: 'theme', stepNums: 'numbers', lines: true, amounts: 'bold',
    stepBars: !!t.stepBars, aligned: false, season: false, peek: true, region: '',
  }
}
// What the template in use switches on: Jan's layout ideas, for Jan and for your own templates.
export function themeFeatures(s) {
  const c = customOf(s)
  if (c) return { stepBars: !!c.stepBars, aligned: !!c.aligned, season: !!c.season, peek: c.peek !== false, region: c.region || '' }
  if (s?.theme === 'jan') return { stepBars: true, aligned: janOption(s, 'aligned'), season: janOption(s, 'season'), peek: janOption(s, 'peek'), region: s.jan?.region || '' }
  return { stepBars: !!THEMES.find((t) => t.id === s?.theme)?.stepBars, aligned: false, season: false, peek: false, region: '' }
}

export function applySettings(s) {
  const root = document.documentElement
  const custom = customOf(s)
  root.dataset.theme = custom ? 'custom' : String(s.theme).startsWith('custom:') ? 'slate' : s.theme // a deleted template
  applyJan(s)
  root.dataset.textsize = s.textSize
  const theme = THEMES.find((t) => t.id === s.theme) || THEMES[0]
  if (!custom) loadThemeFonts(theme)
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta) }
  meta.content = custom?.colors?.bg || theme.colors[0]
}

export const SettingsContext = createContext({ settings: DEFAULTS, update: () => {} })
export const useSettings = () => useContext(SettingsContext)
