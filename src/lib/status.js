// Per-recipe development status, shown as a badge everywhere a recipe appears:
// the sidebar, home page cards, the quick switcher and the recipe header.

export const STATUSES = [
  { key: 'wip', icon: '🚧', label: 'Work in progress', short: 'WIP', color: '#B7791F', bg: '#FFF6E6', border: '#F0DDB8' },
  { key: 'done', icon: '✅', label: 'Finished', short: 'Done', color: '#2D6A4F', bg: '#EAF5EF', border: '#BFE0CD' },
  { key: 'caution', icon: '⚠️', label: 'Caution', short: 'Caution', color: '#9B2C2C', bg: '#FDECEC', border: '#F3C9C9' },
]

export function statusOf(recipe) {
  const key = String(recipe?.status || '')
  return STATUSES.find((s) => s.key === key) || null
}
