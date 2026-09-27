import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Session + profile of the signed-in user. `loading` is true until Supabase has restored any
// saved session, so the app never flashes the sign-in screen for someone already signed in.
export function useAuth() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession(data.session || null) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s || null)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  const uid = session?.user?.id
  useEffect(() => {
    if (!uid) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle().then(({ data }) => setProfile(data || { id: uid, display_name: '' }))
  }, [uid])

  return {
    loading: session === undefined,
    user: session?.user || null,
    profile,
    setProfile,
    recovering,
    doneRecovering: () => setRecovering(false),
  }
}

const redirect = () => window.location.origin + '/'

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message)
}

// Returns true when the account is ready to use, false when Supabase still wants the email
// confirmed (only if "Confirm email" is switched on for the project).
export async function signUp(name, email, password) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(), password, options: { data: { name: name.trim() }, emailRedirectTo: redirect() },
  })
  if (error) throw new Error(error.message)
  return !!data.session
}

export async function signOut() { await supabase.auth.signOut() }

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect() })
  if (error) throw new Error(error.message)
}

export async function setNewPassword(password) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw new Error(error.message)
}

export async function saveDisplayName(uid, name) {
  const { data, error } = await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', uid).select().single()
  if (error) throw new Error(error.message)
  return data
}
