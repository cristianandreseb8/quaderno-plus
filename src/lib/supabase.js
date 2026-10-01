import { createClient } from '@supabase/supabase-js'

const URL_ = import.meta.env.VITE_SUPABASE_URL

// "Remember me": the session is kept on the device (localStorage) — or, unticked, only until the
// browser closes (sessionStorage), the way sign-in forms usually work.
const REMEMBER = 'qdplus_remember'
export const rememberMe = () => { try { return localStorage.getItem(REMEMBER) !== '0' } catch (_) { return true } }
export const setRememberMe = (on) => { try { localStorage.setItem(REMEMBER, on ? '1' : '0') } catch (_) { /* ignore */ } }
const store = () => (rememberMe() ? localStorage : sessionStorage)
const storage = {
  getItem: (k) => { try { return store().getItem(k) } catch (_) { return null } },
  setItem: (k, v) => {
    try {
      store().setItem(k, v)
      ;(rememberMe() ? sessionStorage : localStorage).removeItem(k)
    } catch (_) { /* storage unavailable */ }
  },
  removeItem: (k) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k) } catch (_) { /* ignore */ } },
}

export const supabase = createClient(URL_, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { storage } })

// The session supabase-js saved on this device (its default storage key). Read directly, the
// app can open the signed-in workspace at once instead of waiting for the token refresh.
const AUTH_KEY = `sb-${new URL(URL_).hostname.split('.')[0]}-auth-token`
export function storedSession() {
  try {
    const s = JSON.parse(storage.getItem(AUTH_KEY) || 'null')
    const session = s?.user ? s : s?.currentSession
    return session?.user?.id ? session : null
  } catch (_) {
    return null
  }
}
