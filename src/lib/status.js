// Development state of a recipe, shown wherever a recipe appears and settable from the
// top and bottom of the recipe itself.

export const STATUSES = [
  { key: 'final', icon: '⭐', label: 'Final', short: 'Final', color: '#B7791F', bg: '#FFF8E8', border: '#F0DDB8' },
  { key: 'menu', icon: '🔶', label: 'On the menu, still refining', short: 'On menu', color: '#9A5B1E', bg: '#FFF3E6', border: '#F2D3B0' },
  { key: 'wip', icon: '⚙️', label: 'Work in progress', short: 'WIP', color: '#4A5568', bg: '#F1F3F5', border: '#D9DEE4' },
  { key: 'error', icon: '⚡', label: 'Problem — needs attention', short: 'Problem', color: '#9B2C2C', bg: '#FDECEC', border: '#F3C9C9' },
]

// Only this one asks for a written explanation, shown as a banner on the recipe.
export const STATUS_NEEDING_NOTE = 'error'

export function statusOf(recipe) {
  const key = String(recipe?.status || '')
  return STATUSES.find((s) => s.key === key) || null
}
