import { supabase } from './supabase.js'

// Sign-off on critical steps. There is no auth yet, so "who" is a chef name kept on the
// device — enough to see that a specific person confirmed reading a step, and it maps
// straight onto real accounts once team logins land.

const CHEF_KEY = 'qdplus_chef_name'

export function getChefName() {
  try { return localStorage.getItem(CHEF_KEY) || '' } catch { return '' }
}

export function setChefName(name) {
  try { localStorage.setItem(CHEF_KEY, String(name || '').trim()) } catch { /* storage unavailable */ }
}

export async function loadAcks(recipeId) {
  try {
    const { data, error } = await supabase
      .from('recipe_acks').select('*').eq('recipe_id', recipeId).order('acked_at', { ascending: false })
    if (error) throw error
    return data || []
  } catch (e) {
    console.error('loadAcks:', e)
    return []
  }
}

export async function addAck(recipeId, stepIndex, who) {
  try {
    const { error } = await supabase
      .from('recipe_acks')
      .upsert(
        { recipe_id: recipeId, step_index: stepIndex, who, acked_at: new Date().toISOString() },
        { onConflict: 'recipe_id,step_index,who' },
      )
    if (error) throw error
    return true
  } catch (e) {
    console.error('addAck:', e)
    return false
  }
}
