export const LANGS = ['English', 'Spanish', 'French', 'Italian', 'German', 'Portuguese', 'Japanese']

export const EXPIRY_OPTS = { '24 h': 86400000, '1 week': 604800000, '1 month': 2592000000 }
export const EXPIRY_LABELS = Object.keys(EXPIRY_OPTS)

export const SENSORY_ATTRS = [
  'Appearance', 'Color', 'Aroma', 'Texture', 'Crumb structure', 'Crust', 'Flavor', 'Aftertaste', 'Overall score',
]

export const SENSORY_LABELS = {
  'Appearance': 'Visual presentation',
  'Color': 'Color uniformity',
  'Aroma': 'Smell intensity & character',
  'Texture': 'Mouthfeel & bite',
  'Crumb structure': 'Open, uniform, or tight crumb',
  'Crust': 'Thickness, color, crunch',
  'Flavor': 'Taste balance & complexity',
  'Aftertaste': 'Persistence & pleasantness',
  'Overall score': 'Overall quality',
}

export const FLOUR_WORDS = [
  'flour', 'farina', 'harina', 'mehl', 'farine', 'semolina', 'semola', 'manitoba', 'grano', 't45', 't55', 't65', 't80', 't150', '00', 'tipo',
]

export const MAX_AUDIO_BYTES = (2 * 60 * 128 * 1024) / 8 // ~2 min @ 128kbps
export const MAX_VIDEO_CAP = 30 * 1024 * 1024 // 30 MB cap
