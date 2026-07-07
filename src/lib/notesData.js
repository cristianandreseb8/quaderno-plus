import { uid } from './recipeCalc.js'

export function parseTabs(notesPad) {
  if (!notesPad) return [{ id: uid(), name: 'General', content: '' }]
  try {
    const p = JSON.parse(notesPad)
    if (Array.isArray(p) && p.length > 0) return p
  } catch (_) {
    /* legacy plain-text notes */
  }
  return [{ id: uid(), name: 'General', content: notesPad }]
}

export const serializeTabs = (tabs) => JSON.stringify(tabs)
