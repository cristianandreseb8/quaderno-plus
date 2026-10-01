import { useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { resendConfirmation, sendPasswordReset, sendSignInLink, signIn, signUp } from '../lib/auth.js'
import { rememberMe, setRememberMe } from '../lib/supabase.js'

// Sign in / create account / forgotten password / sign-in link by email. `reason` explains why the
// screen appears (an invite, a private recipe link); `onGuest` offers browsing public recipes
// without an account. Fields carry the names and autocomplete hints password managers look for.
const SPAM_HINT = 'It can take a minute. Not there? Look in the spam or promotions folder — it comes from noreply@mail.app.supabase.io.'

export default function AuthScreen({ reason, onCancel, cancelLabel, onGuest }) {
  const [mode, setMode] = useState('signin') // signin | signup | reset | link
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(rememberMe)
  const [caps, setCaps] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null) // { message, code }
  const [info, setInfo] = useState('')
  const [canResend, setCanResend] = useState(false)

  const go = (m) => { setMode(m); setErr(null); setInfo(''); setCanResend(false) }

  async function submit(e) {
    e.preventDefault()
    setErr(null); setInfo(''); setBusy(true)
    try {
      if (mode === 'signin') {
        setRememberMe(remember)
        await signIn(email, password)
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use at least 8 characters for the password.')
        setRememberMe(remember)
        const ready = await signUp(name, email, password)
        if (!ready) { setInfo(`Almost there — open the email we just sent to ${email.trim()} and confirm your address. ${SPAM_HINT}`); setCanResend(true) }
      } else if (mode === 'reset') {
        await sendPasswordReset(email)
        setInfo(`If ${email.trim()} has an account, a link to choose a new password is on its way. ${SPAM_HINT}`)
      } else {
        setRememberMe(remember)
        await sendSignInLink(email)
        setInfo(`A sign-in link is on its way to ${email.trim()}. Open it on this device. ${SPAM_HINT}`)
      }
    } catch (ex) {
      setErr({ message: ex.message, code: ex.code })
      if (ex.code === 'unconfirmed') setCanResend(true)
    } finally {
      setBusy(false)
    }
  }
  async function resend() {
    setBusy(true); setErr(null)
    try {
      await resendConfirmation(email)
      setInfo(`Sent again to ${email.trim()}. ${SPAM_HINT}`)
      setCanResend(false)
    } catch (ex) {
      setErr({ message: ex.message, code: ex.code })
    } finally {
      setBusy(false)
    }
  }

  const title = { signup: 'Create your account', reset: 'Reset your password', link: 'Sign in with an email link' }[mode] || 'Welcome back'
  const cta = { signup: 'Create account', reset: 'Send reset link', link: 'Email me a sign-in link' }[mode] || 'Sign in'
  const withPassword = mode === 'signin' || mode === 'signup'
  return (
    <div className="Q-auth">
      <form className="Q-auth-card" onSubmit={submit} method="post" action="#" autoComplete="on">
        <div className="Q-auth-brand">Quaderno<b>+</b></div>
        <h1>{title}</h1>
        {reason && <p className="Q-auth-reason">{reason}</p>}
        {mode === 'reset' && <p className="Q-auth-reason">We will email you a link to choose a new password.</p>}
        {mode === 'link' && <p className="Q-auth-reason">No password needed: we email you a link that signs you in.</p>}

        {mode === 'signup' && (
          <div className="Q-field">
            <label htmlFor="q-name">Your name</label>
            <input id="q-name" name="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="How others will see you" />
          </div>
        )}
        <div className="Q-field">
          <label htmlFor="q-email">Email</label>
          <input
            id="q-email" name="email" type="email" required inputMode="email" autoCapitalize="none" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)} autoComplete={mode === 'signup' ? 'email' : 'username'} autoFocus
          />
        </div>
        {withPassword && (
          <div className="Q-field">
            <label htmlFor="q-password">
              Password
              {mode === 'signin' && <button type="button" className="Q-link" onClick={() => go('reset')}>Forgot password?</button>}
            </label>
            <div className="Q-pw">
              <input
                id="q-password" name="password" type={show ? 'text' : 'password'} required value={password}
                onChange={(e) => setPassword(e.target.value)} minLength={mode === 'signup' ? 8 : undefined}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                onKeyUp={(e) => setCaps(!!e.getModifierState?.('CapsLock'))} onBlur={() => setCaps(false)}
              />
              <button type="button" className="Q-pw-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide the password' : 'Show the password'} title={show ? 'Hide' : 'Show'}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {caps && <div className="Q-auth-hint">Caps Lock is on.</div>}
            {mode === 'signup' && password && password.length < 8 && <div className="Q-auth-hint">At least 8 characters.</div>}
          </div>
        )}
        {mode !== 'reset' && (
          <label className="Q-auth-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember me on this device
          </label>
        )}

        {err && (
          <div className="Q-auth-err">
            {err.message}
            {err.code === 'exists' && <> <button type="button" className="Q-link" onClick={() => go('signin')}>Sign in</button> · <button type="button" className="Q-link" onClick={() => go('reset')}>Reset password</button></>}
          </div>
        )}
        {info && <div className="Q-auth-info">{info}</div>}
        {canResend && email.trim() && (
          <button type="button" className="Q-auth-resend" onClick={resend} disabled={busy}>Send the confirmation email again</button>
        )}
        <button className="btn primary block" disabled={busy}>
          {busy && <Loader2 size={15} className="spin" />}
          {cta}
        </button>
        {mode === 'signin' && (
          <button type="button" className="Q-auth-alt" onClick={() => go('link')}>Sign in with an email link instead</button>
        )}
        <div className="Q-auth-switch">
          {mode === 'signin' && <>New to Quaderno+? <button type="button" className="Q-link" onClick={() => go('signup')}>Create an account</button></>}
          {mode !== 'signin' && <>Have an account? <button type="button" className="Q-link" onClick={() => go('signin')}>Sign in</button></>}
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
