import { supabase } from './supabase.js'

// Who can see a recipe, in the words the interface uses everywhere.
export const VISIBILITY = { private: 'Private', shared: 'Invite only', public: 'Public' }

// Links people can open: a public recipe (anyone), or a personal invite (one person).
export const recipeLink = (id) => `${window.location.origin}/?r=${id}`
export const inviteLink = (token) => `${window.location.origin}/?invite=${token}`

export async function setVisibility(id, visibility) {
  const { error } = await supabase.from('recipes').update({ visibility }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listShares(recipeId) {
  const { data, error } = await supabase.from('recipe_shares').select('*').eq('recipe_id', recipeId).order('created_at')
  if (error) throw new Error(error.message)
  return data || []
}

export async function createShare(recipeId, label) {
  const { data, error } = await supabase.from('recipe_shares').insert({ recipe_id: recipeId, label: label.trim() }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function removeShare(id) {
  const { error } = await supabase.from('recipe_shares').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Returns the recipe id the invite opens, or null when the link was already used by someone else.
export async function acceptInvite(token) {
  const { data, error } = await supabase.rpc('accept_recipe_share', { p_token: token })
  if (error) throw new Error(error.message)
  return data || null
}

export function mailInvite(to, recipeTitle, link, fromName) {
  const subject = `${fromName || 'A cook'} shared “${recipeTitle}” with you on Quaderno+`
  const body = `Hi,\n\nI'd like to share my recipe “${recipeTitle}” with you on Quaderno+.\n\nOpen this link and sign in (or create a free account) to see it:\n${link}\n\nThe link is just for you.`
  const addr = /@/.test(to || '') ? to.trim() : ''
  window.location.href = `mailto:${addr}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
