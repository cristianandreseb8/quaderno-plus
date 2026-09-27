import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { sendPasswordReset, signIn, signUp } from '../lib/auth.js'

// Sign in / create account. `reason` explains why the screen appears (an invite, a private
// recipe link); `onGuest` offers browsing public recipes without an account.
export default function AuthScreen({ reason, onCancel, cancelLabel, onGuest }) {
  const [mode, setMode] = useState('signin') // signin | signup | reset
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  async function submit(e) {
    e.preventDefault()
    setErr(''); setInfo(''); setBusy(true)
    try {
      if (mode === 'signin') await signIn(email, password)
      else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use at least 8 characters for the password.')
        const ready = await signUp(name, email, password)
        if (!ready) setInfo('Almost there — open the email we just sent and confirm your address, then sign in.')
      } else {
        await sendPasswordReset(email)
        setInfo('If that email has an account, a link to set a new password is on its way.')
      }
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Welcome back'
  return (
    <div className="Q-auth">
      <form className="Q-auth-card" onSubmit={submit}>
        <div className="Q-auth-brand">Quaderno<b>+</b></div>
        <h1>{title}</h1>
        {reason && <p className="Q-auth-reason">{reason}</p>}

        {mode === 'signup' && (
          <div className="Q-field"><label>Your name</label><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="How others will see you" /></div>
        )}
        <div className="Q-field"><label>Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus /></div>
        {mode !== 'reset' && (
          <div className="Q-field">
            <label>Password{mode === 'signin' && <button type="button" className="Q-link" onClick={() => { setMode('reset'); setErr(''); setInfo('') }}>Forgot?</button>}</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 8 : undefined} />
          </div>
        )}
        {err && <div className="Q-auth-err">{err}</div>}
        {info && <div className="Q-auth-info">{info}</div>}
        <button className="btn primary block" disabled={busy}>
          {busy && <Loader2 size={15} className="spin" />}
          {mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
        </button>
        <div className="Q-auth-switch">
          {mode === 'signin' && <>New to Quaderno+? <button type="button" className="Q-link" onClick={() => { setMode('signup'); setErr(''); setInfo('') }}>Create an account</button></>}
          {mode !== 'signin' && <>Have an account? <button type="button" className="Q-link" onClick={() => { setMode('signin'); setErr(''); setInfo('') }}>Sign in</button></>}
        </div>
        {onCancel && <button type="button" className="Q-auth-cancel" onClick={onCancel}>{cancelLabel || 'Back'}</button>}
        {onGuest && mode === 'signin' && (
          <button type="button" className="Q-auth-guest" onClick={onGuest}>
            Continue as guest<span>Browse public recipes without an account</span>
          </button>
        )}
      </form>
    </div>
  )
}
