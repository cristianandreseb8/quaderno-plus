import { supabase } from './supabase.js'

// Development log for a recipe: what was changed on each attempt and why.

export const OUTCOMES = [
  { key: 'tried', icon: '🧪', label: 'Tried', color: '#4A5568', bg: '#F1F3F5' },
  { key: 'kept', icon: '👍', label: 'Kept this', color: '#2D6A4F', bg: '#EAF5EF' },
  { key: 'rejected', icon: '👎', label: 'Rejected', color: '#9B2C2C', bg: '#FDECEC' },
  { key: 'final', icon: '⭐', label: 'This is the final', color: '#B7791F', bg: '#FFF8E8' },
]

export function outcomeOf(key) {
  return OUTCOMES.find((o) => o.key === key) || OUTCOMES[0]
}

export async function loadTrials(recipeId) {
  try {
    const { data, error } = await supabase
      .from('recipe_trials').select('*').eq('recipe_id', recipeId)
      .order('trial_date', { ascending: true }).order('created_at', { ascending: true })
    if (error) throw error
    return data || []
  } catch (e) {
    console.error('loadTrials:', e)
    return []
  }
}

export async function saveTrial(trial) {
  try {
    const row = { ...trial }
    if (!row.id) delete row.id
    const { data, error } = await supabase.from('recipe_trials').upsert(row).select().single()
    if (error) throw error
    return data
  } catch (e) {
    console.error('saveTrial:', e)
    return null
  }
}

export async function deleteTrial(id) {
  try {
    const { error } = await supabase.from('recipe_trials').delete().eq('id', id)
    if (error) throw error
    return true
  } catch (e) {
    console.error('deleteTrial:', e)
    return false
  }
}

/**
 * Pivots the log into one row per parameter, showing how it moved across trials —
 * the "20 g → 22 g → 30 g" view that makes the history readable at a glance.
 * Parameters are matched case-insensitively so "Rote Beete Saft" and "rote beete saft" line up.
 */
export function buildProgression(trials) {
  const byParam = new Map()
  trials.forEach((t, i) => {
    for (const c of Array.isArray(t.changes) ? t.changes : []) {
      const what = String(c.what || '').trim()
      if (!what) continue
      const key = what.toLowerCase()
      if (!byParam.has(key)) byParam.set(key, { what, steps: [] })
      byParam.get(key).steps.push({
        trialIndex: i,
        label: t.label || `Trial ${i + 1}`,
        value: String(c.value ?? '').trim(),
        outcome: t.outcome,
        date: t.trial_date,
      })
    }
  })
  return [...byParam.values()].sort((a, b) => b.steps.length - a.steps.length || a.what.localeCompare(b.what))
}
