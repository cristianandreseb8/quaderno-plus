import { supabase } from './supabase.js'

// Fire-and-forget crash reporting to the app's own DB — this is a personal single-user app,
// so a simple table beats wiring up an external error-tracking service.
export function logClientError(context, error) {
  try {
    const message = error?.message || String(error)
    const stack = String(error?.stack || '').slice(0, 4000)
    supabase.from('client_errors').insert({
      message: message.slice(0, 1000),
      stack,
      context: String(context || '').slice(0, 200),
      user_agent: navigator.userAgent,
    }).then(() => {}, () => {})
  } catch (_) { /* never let the logger itself throw */ }
}

export function installGlobalErrorLogging() {
  window.addEventListener('error', (e) => logClientError('window.onerror', e.error || e.message))
  window.addEventListener('unhandledrejection', (e) => logClientError('unhandledrejection', e.reason))
}
