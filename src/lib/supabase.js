import { createClient } from '@supabase/supabase-js'

const URL_ = import.meta.env.VITE_SUPABASE_URL

export const supabase = createClient(URL_, import.meta.env.VITE_SUPABASE_ANON_KEY)

// The session supabase-js saved on this device (its default storage key). Read directly, the
// app can open the signed-in workspace at once instead of waiting for the token refresh.
const AUTH_KEY = `sb-${new URL(URL_).hostname.split('.')[0]}-auth-token`
export function storedSession() {
  try {
    const s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null')
    const session = s?.user ? s : s?.currentSession
    return session?.user?.id ? session : null
  } catch (_) {
    return null
  }
}
