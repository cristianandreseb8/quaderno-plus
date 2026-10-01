import { useEffect, useState } from 'react'
import { setRememberMe, storedSession, supabase } from './supabase.js'

// Session + profile of the signed-in user. Someone signed in on this device gets the workspace
// straight away from the saved session (Supabase refreshes the token meanwhile, and signs them
// out if that fails); otherwise `loading` is true until Supabase has looked.
export function useAuth() {
  const [session, setSession] = useState(() => storedSession() || undefined)
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

// Supabase's messages, in the words of the sign-in screen. `code` lets the screen offer the next
// step (resend the confirmation, reset the password).
function friendly(error) {
  const m = String(error?.message || '')
  const e = new Error(m)
  if (/invalid login credentials/i.test(m)) e.message = 'Wrong email or password.'
  else if (/email not confirmed/i.test(m)) { e.message = 'This email is not confirmed yet. Open the link in the email we sent — or send it again.'; e.code = 'unconfirmed' }
  else if (/already registered|already been registered|user already exists/i.test(m)) { e.message = 'There is already an account with this email. Sign in, or reset the password.'; e.code = 'exists' }
  else if (/rate limit|too many|security purposes/i.test(m)) e.message = 'Too many attempts or emails just now. Wait a minute and try again.'
  else if (/not authorized/i.test(m)) e.message = 'Emails cannot be sent to this address yet. Ask the app owner to set up the mail service.'
  else if (/password should be|weak password/i.test(m)) e.message = 'Choose a stronger password: at least 8 characters, ideally with numbers or symbols.'
  else if (/signups? not allowed|signup is disabled/i.test(m)) e.message = 'New accounts are not open right now.'
  return e
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw friendly(error)
}

// A one-time sign-in link by email, for an account that already exists.
export async function sendSignInLink(email) {
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: redirect() } })
  if (error) throw friendly(/signups? not allowed|not found/i.test(error.message) ? { message: 'There is no account with this email.' } : error)
}

export async function resendConfirmation(email) {
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: redirect() } })
  if (error) throw friendly(error)
}

export async function changeEmail(email) {
  const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: redirect() })
  if (error) throw friendly(error)
}

// Returns true when the account is ready to use, false when Supabase still wants the email
// confirmed (only if "Confirm email" is switched on for the project).
export async function signUp(name, email, password) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(), password, options: { data: { name: name.trim() }, emailRedirectTo: redirect() },
  })
  if (error) throw friendly(error)
  // An email that already has an account comes back without identities (no error, by design).
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw friendly({ message: 'User already registered' })
  }
  return !!data.session
}

// "Continue as guest": a guest account with everything an account has, kept on this device. It
// needs "Allow anonymous sign-ins" on in Supabase (Authentication → Sign In / Providers); while it is
// off the error has code 'guest-off' and the guest only browses public recipes.
export async function continueAsGuest() {
  setRememberMe(true)
  const { error } = await supabase.auth.signInAnonymously()
  if (!error) return
  const e = friendly(error)
  if (/anonymous/i.test(error.message || '')) e.code = 'guest-off'
  throw e
}
export const isGuestUser = (user) => !!user?.is_anonymous
// A guest's work lives only in that guest account: signing out loses it, so ask first.
export function confirmSignOut(user) {
  return !isGuestUser(user) || window.confirm('You are a guest: signing out loses everything you made here, for good.\n\nTo keep it, add your email in Settings → Account first.\n\nSign out anyway?')
}

export async function signOut() {
  // The recipe list kept on this device for a fast start goes with the account.
  try { Object.keys(localStorage).filter((k) => k.startsWith('qdplus_list_')).forEach((k) => localStorage.removeItem(k)) } catch (_) { /* ignore */ }
  await supabase.auth.signOut()
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect() })
  if (error) throw friendly(error)
}

export async function setNewPassword(password) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw friendly(error)
}

export async function saveDisplayName(uid, name) {
  const { data, error } = await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', uid).select().single()
  if (error) throw new Error(error.message)
  return data
}
