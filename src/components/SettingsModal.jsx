import Modal from './ui/Modal.jsx'
import { JAN_COLORS, JAN_DEFAULTS, JAN_FONTS, THEMES, TEXT_SIZES, janOption, loadThemeFonts, useSettings } from '../lib/settings.js'
import { setVoiceCfg, speak, useTimers, voiceLang } from '../lib/timers.js'
import { LANGS } from '../lib/constants.js'
import { INSTALL_HELP, useInstall } from '../lib/install.js'
import { changeEmail, confirmSignOut, isGuestUser, saveDisplayName, setNewPassword, signOut } from '../lib/auth.js'
import { toast } from './ui/Toaster.jsx'
import { HEY_LANGS } from './HeyChef.jsx'
import { heyChefSupported, setHeyChef, useHeyChef } from '../lib/heychef.js'
import { useEffect, useState } from 'react'

function ThemeCard({ theme, active, onPick }) {
  const [bg, surface, accent, ink] = theme.colors
  return (
    <button type="button" className={`Q-theme-card${active ? ' active' : ''}`} onClick={onPick} aria-pressed={active}>
      <div className="Q-theme-prev" style={{ background: bg, color: ink }}>
        <div className="Q-theme-prev-side" style={{ background: surface }}>
          <i style={{ background: accent }} /><i /><i />
        </div>
        <div className="Q-theme-prev-main">
          <b style={{ fontFamily: theme.heading, fontWeight: theme.headingWeight || 600 }}>Brioche</b>
          <span style={{ background: ink }} />
          <span style={{ background: ink }} />
          <em style={{ background: accent }} />
        </div>
      </div>
      <div className="Q-theme-name">{theme.name}</div>
      <div className="Q-theme-desc">{theme.desc}</div>
    </button>
  )
}

// How fast chef mode and the timers speak (kept with the rest of the voice choices, per device).
const SAMPLE = {
  es: 'Paso 2. Dejar fermentar 4.5–6 h a 28 °C.',
  it: 'Passo 2. Lasciar lievitare 4.5–6 h a 28 °C.',
  fr: 'Étape 2. Laisser pousser 4.5–6 h à 28 °C.',
  de: 'Schritt 2. 4.5–6 h bei 28 °C gehen lassen.',
  en: 'Step 2. Let it rise 4.5–6 h at 28 °C.',
}
function VoiceSettings() {
  const { voiceCfg } = useTimers()
  const rate = voiceCfg.rate || 0.85
  const word = rate < 0.75 ? 'Very slow' : rate < 0.9 ? 'Slow' : rate <= 1.05 ? 'Normal' : rate <= 1.2 ? 'Fast' : 'Very fast'
  const test = () => { const lang = voiceLang(null); speak(SAMPLE[lang.slice(0, 2)] || SAMPLE.en, lang, { interrupt: true }) }
  return (
    <section className="Q-set-sec">
      <h3>Voice</h3>
      <div className="Q-set-row">
        <div>
          <div className="Q-set-label">Speed</div>
          <div className="Q-set-help">How fast chef mode reads the steps and timers say their name.</div>
        </div>
        <button type="button" className="btn ghost sm" onClick={test}>Test</button>
      </div>
      <div className="Q-voice-rate">
        <span>Slower</span>
        <input
          type="range" min="0.6" max="1.3" step="0.05" value={rate} aria-label="Voice speed"
          onChange={(e) => setVoiceCfg({ rate: +e.target.value })} onPointerUp={test} onKeyUp={test}
        />
        <span>Faster</span>
        <b>{word}</b>
      </div>
    </section>
  )
}

export default function SettingsModal({ onClose, uncategorizedCount, categorizing, onAutoCategorize, recipeCount, user, profile, onProfile }) {
  const { settings, update } = useSettings()
  const install = useInstall()
  // Show every template in its own fonts while choosing.
  useEffect(() => { THEMES.forEach(loadThemeFonts) }, [])
  const [name, setName] = useState(profile?.display_name || '')
  const [savingName, setSavingName] = useState(false)
  async function saveName() {
    if (!user || name.trim() === (profile?.display_name || '')) return
    setSavingName(true)
    try { onProfile(await saveDisplayName(user.id, name)); toast.success('Name saved') } catch (e) { toast.error(e.message) } finally { setSavingName(false) }
  }
  async function copyInvite() {
    const link = window.location.origin + '/'
    try { await navigator.clipboard.writeText(link); toast.success('Link copied — send it to anyone you want to invite') } catch (_) { window.prompt('Copy this link:', link) }
  }

  return (
    <Modal title="Settings" onClose={onClose} width={760}>
      {user && (
        <section className="Q-set-sec">
          <h3>Account</h3>
          <div className="Q-set-row">
            <div style={{ flex: 1 }}>
              <div className="Q-set-label">Your name</div>
              <div className="Q-set-help">Shown to people you share recipes with. {isGuestUser(user) ? 'You are a guest on this device.' : `Signed in as ${user.email}.`}</div>
            </div>
            <input className="Q-inline-input" style={{ maxWidth: 220 }} value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} disabled={savingName} />
          </div>
          <div className="Q-set-row">
            <div>
              <div className="Q-set-label">Invite someone to Quaderno+</div>
              <div className="Q-set-help">They create a free account with the link. To give them a specific recipe, use Share on that recipe.</div>
            </div>
            <button className="btn ghost sm" onClick={copyInvite}>Copy link</button>
          </div>
          {isGuestUser(user) ? <KeepGuestWork pending={user.new_email} /> : <AccountSecurity email={user.email} />}
          <div className="Q-set-row">
            <div><div className="Q-set-label">Sign out</div><div className="Q-set-help">{isGuestUser(user) ? 'As a guest, signing out loses what you made here.' : 'Your recipes stay safe in your account.'}</div></div>
            <button className="btn ghost sm" onClick={() => { if (!confirmSignOut(user)) return; onClose(); signOut() }}>Sign out</button>
          </div>
        </section>
      )}

      <section className="Q-set-sec">
        <h3>Template</h3>
        <p className="Q-set-help">Changes colours and typography across the whole app. Saved on this device.</p>
        {[['Light', THEMES.filter((t) => !t.dark)], ['Dark', THEMES.filter((t) => t.dark)]].map(([label, list]) => (
          <div key={label}>
            <div className="Q-theme-group">{label}</div>
            <div className="Q-theme-grid">
              {list.map((t) => <ThemeCard key={t.id} theme={t} active={settings.theme === t.id} onPick={() => update({ theme: t.id })} />)}
            </div>
          </div>
        ))}
        {settings.theme === 'jan' && <JanSettings />}
      </section>

      <section className="Q-set-sec">
        <h3>Reading</h3>
        <div className="Q-set-row">
          <div>
            <div className="Q-set-label">Text size</div>
            <div className="Q-set-help">Size of ingredients and method.</div>
          </div>
          <div className="Q-seg">
            {TEXT_SIZES.map((s) => (
              <button key={s.id} type="button" className={settings.textSize === s.id ? 'on' : ''} onClick={() => update({ textSize: s.id })}>{s.label}</button>
            ))}
          </div>
        </div>
        <div className="Q-set-row">
          <div>
            <div className="Q-set-label">Recipe layout</div>
            <div className="Q-set-help">Side by side keeps the ingredients next to the method on wide screens.</div>
          </div>
          <div className="Q-seg">
            <button type="button" className={settings.layout === 'stacked' ? 'on' : ''} onClick={() => update({ layout: 'stacked' })}>Stacked</button>
            <button type="button" className={settings.layout === 'split' ? 'on' : ''} onClick={() => update({ layout: 'split' })}>Side by side</button>
          </div>
        </div>
      </section>

      <section className="Q-set-sec">
        <h3>Chef mode</h3>
        <div className="Q-set-row">
          <div>
            <div className="Q-set-label">{settings.chefMode === 'simple' ? 'Simple' : 'Pro'}</div>
            <div className="Q-set-help">
              {settings.chefMode === 'simple'
                ? 'Just the step, its ingredients and its timers — nothing else on screen.'
                : 'Adds every step at a glance, the next step, a clock for each step against your usual time, long waits coming up, the key numbers highlighted, and hands-free voice commands (“next”, “back”, “repeat”, “timer”, “stop”).'}
            </div>
          </div>
          <div className="Q-seg">
            <button type="button" className={settings.chefMode === 'simple' ? 'on' : ''} onClick={() => update({ chefMode: 'simple' })}>Simple</button>
            <button type="button" className={settings.chefMode !== 'simple' ? 'on' : ''} onClick={() => update({ chefMode: 'pro' })}>Pro</button>
          </div>
        </div>
      </section>

      <HeyChefSettings />

      <VoiceSettings />

      <section className="Q-set-sec">
        <h3>Recipes</h3>
        <div className="Q-set-row">
          <div>
            <div className="Q-set-label">Preferred translation language</div>
            <div className="Q-set-help">Shown first in the Translate menu.</div>
          </div>
          <select className="Q-select" value={settings.translateLang} onChange={(e) => update({ translateLang: e.target.value })}>
            {LANGS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <label className="Q-set-row Q-set-check">
          <div>
            <div className="Q-set-label">Include notes when exporting</div>
            <div className="Q-set-help">Adds your recipe notes to PDF and image exports.</div>
          </div>
          <input type="checkbox" className="Q-switch" checked={settings.exportNotes} onChange={(e) => update({ exportNotes: e.target.checked })} />
        </label>
        <label className="Q-set-row Q-set-check">
          <div>
            <div className="Q-set-label">Spelling & grammar check</div>
            <div className="Q-set-help">Underlines mistakes while you write a recipe, and adds “Check spelling” to the editor: AI proposes corrections in the recipe’s own language and you choose which to apply.</div>
          </div>
          <input type="checkbox" className="Q-switch" checked={settings.proofread !== false} onChange={(e) => update({ proofread: e.target.checked })} />
        </label>
      </section>

      <section className="Q-set-sec">
        <h3>App</h3>
        <div className="Q-set-row">
          <div>
            <div className="Q-set-label">{install.installed ? 'Installed' : 'Install Quaderno+'}</div>
            <div className="Q-set-help">
              {install.installed
                ? 'You are using the installed app. It opens from its own icon and works with a weak connection.'
                : install.canPrompt
                  ? 'Add it to this device as an app: its own icon and window, and it opens even with a weak connection.'
                  : INSTALL_HELP[install.platform]}
            </div>
          </div>
          {!install.installed && install.canPrompt && <button className="btn primary sm" onClick={() => install.prompt()}>Install</button>}
        </div>
      </section>

      <section className="Q-set-sec">
        <h3>Library tools</h3>
        <div className="Q-set-row">
          <div>
            <div className="Q-set-label">Auto-categorize with AI</div>
            <div className="Q-set-help">
              {uncategorizedCount
                ? `${uncategorizedCount} recipe${uncategorizedCount === 1 ? '' : 's'} without a category. AI suggests one from the title and ingredients.`
                : 'Every recipe already has a category.'}
            </div>
          </div>
          <button className="btn ghost sm" disabled={!uncategorizedCount || categorizing} onClick={onAutoCategorize}>
            {categorizing ? 'Categorizing…' : 'Categorize'}
          </button>
        </div>
      </section>

      <div className="Q-set-foot">Quaderno+ · {recipeCount} recipe{recipeCount === 1 ? '' : 's'}</div>
    </Modal>
  )
}

// Password and email of the signed-in account.
// A guest keeps everything by turning the guest account into a real one: an email (confirmed from
// the link sent to it), then a password here.
function KeepGuestWork({ pending }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await changeEmail(value)
      toast.success('Open the link we sent to confirm it — then set a password here', { duration: 9000 })
      setValue('')
    } catch (ex) {
      toast.error(ex.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="Q-set-row">
      <div>
        <div className="Q-set-label">Keep your work</div>
        <div className="Q-set-help">{pending ? `Waiting for you to confirm ${pending} from the link we sent.` : 'You are using Quaderno+ as a guest. Add your email to turn this into your account — everything you made stays.'}</div>
      </div>
      <form className="Q-set-form" onSubmit={save}>
        <input type="email" required value={value} onChange={(e) => setValue(e.target.value)} autoComplete="email" placeholder="Your email" />
        <button className="btn primary sm" disabled={busy}>{pending ? 'Send again' : 'Add'}</button>
      </form>
    </div>
  )
}

function AccountSecurity({ email }) {
  const [open, setOpen] = useState(null) // 'password' | 'email'
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => { setOpen(null); setValue('') }
  async function save(e) {
    e.preventDefault()
    setBusy(true)
    try {
      if (open === 'password') {
        if (value.length < 8) throw new Error('Use at least 8 characters.')
        await setNewPassword(value)
        toast.success('Password changed')
      } else {
        await changeEmail(value)
        toast.success('Check both inboxes: confirm the change from the link we sent', { duration: 9000 })
      }
      close()
    } catch (ex) {
      toast.error(ex.message)
    } finally {
      setBusy(false)
    }
  }
  const row = (kind, label, help) => (
    <div className="Q-set-row">
      <div><div className="Q-set-label">{label}</div><div className="Q-set-help">{help}</div></div>
      {open === kind ? (
        <form className="Q-set-form" onSubmit={save}>
          <input
            type={kind === 'password' ? 'password' : 'email'} autoFocus required value={value} onChange={(e) => setValue(e.target.value)}
            autoComplete={kind === 'password' ? 'new-password' : 'email'} placeholder={kind === 'password' ? 'New password (8+ characters)' : 'New email'}
          />
          <button className="btn primary sm" disabled={busy}>Save</button>
          <button type="button" className="btn ghost sm" onClick={close}>Cancel</button>
        </form>
      ) : (
        <button className="btn ghost sm" onClick={() => { setOpen(kind); setValue('') }}>Change</button>
      )}
    </div>
  )
  return (
    <>
      {row('password', 'Password', 'Choose a new password for this account.')}
      {row('email', 'Email', `Now ${email}. The change is confirmed from a link sent to the new address.`)}
    </>
  )
}

// "Jan" made yours: every colour, the fonts, and how its recipes are laid out.
function JanSettings() {
  const { settings, update } = useSettings()
  const jan = settings.jan || {}
  const set = (patch) => update({ jan: { ...jan, ...patch } })
  const color = (k) => jan.colors?.[k] || JAN_COLORS.find(([x]) => x === k)[2]
  const font = (k, d) => jan.fonts?.[k] || d
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch (_) { return '' } })()
  const fontSelect = (k, label, d, kinds) => (
    <label className="Q-jan-font">
      <span>{label}</span>
      <select className="Q-select" value={font(k, d)} onChange={(e) => set({ fonts: { ...(jan.fonts || {}), [k]: e.target.value } })} style={{ fontFamily: `"${font(k, d)}"` }}>
        {JAN_FONTS.filter(([, kind]) => kinds.includes(kind)).map(([n]) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  )
  const toggle = (key, label, help) => (
    <label className="Q-set-row Q-set-check">
      <div><div className="Q-set-label">{label}</div><div className="Q-set-help">{help}</div></div>
      <input type="checkbox" className="Q-switch" checked={janOption(settings, key)} onChange={(e) => set({ [key]: e.target.checked })} />
    </label>
  )
  return (
    <div className="Q-jan">
      <div className="Q-jan-head">
        <b>Make Jan yours</b>
        <button className="Q-link" onClick={() => update({ jan: {} })}>Back to Jan's defaults</button>
      </div>
      <div className="Q-jan-colors">
        {JAN_COLORS.map(([k, label]) => (
          <label key={k} className="Q-jan-color">
            <input type="color" value={color(k)} onChange={(e) => set({ colors: { ...(jan.colors || {}), [k]: e.target.value } })} aria-label={label} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div className="Q-jan-fonts">
        {fontSelect('heading', 'Titles', 'Manrope', ['sans', 'serif'])}
        {fontSelect('body', 'Text', 'Manrope', ['sans', 'serif'])}
        {fontSelect('numbers', 'Numbers', 'IBM Plex Mono', ['mono', 'sans'])}
      </div>
      {toggle('aligned', 'Ingredients beside their steps', 'Each step shows, next to it, the ingredients it uses and how much — the recipe reads as one table.')}
      {toggle('season', 'Season of the recipe', 'A year strip under the title: the months its fresh ingredients are in season where you live.')}
      {toggle('peek', 'Coming steps in chef mode', 'The next steps show faintly under the current one, to plan ahead.')}
      {janOption(settings, 'season') && (
        <div className="Q-set-row">
          <div><div className="Q-set-label">Your region, for the seasons</div><div className="Q-set-help">Empty: guessed from this device ({tz || 'unknown'}).</div></div>
          <input className="Q-inline-input" style={{ maxWidth: 220 }} value={jan.region || ''} placeholder={tz} onChange={(e) => set({ region: e.target.value })} />
        </div>
      )}
    </div>
  )
}

// "Hey chef": voice commands anywhere in the app.
const HEY_EXAMPLES = [
  'open chef mode', 'next step', 'go to step 4', 'open the panettone recipe', 'add flan batter to my session',
  'add 200 grams of flour to my shopping list', '10 minute timer', 'pause the timer', 'continue the timer', 'timer off',
  'measure my timing', 'stop measuring', 'double the recipe', 'read the ingredients', 'what’s 54 plus 100',
  'divide 2345 into 5450', '20 percent of 340', 'how long should I bake this for?', 'create a recipe for baguette',
  'what’s the origin of vanilla', 'open my shopping list',
]
function HeyChefSettings() {
  const { settings, update } = useSettings()
  const st = useHeyChef()
  const hey = settings.heyChef || {}
  const set = (patch) => update({ heyChef: { ...hey, ...patch } })
  if (!heyChefSupported()) {
    return (
      <section className="Q-set-sec">
        <h3>Hey chef</h3>
        <p className="Q-set-help">Voice commands need a browser that can listen (Chrome, Edge, Safari). This one cannot.</p>
      </section>
    )
  }
  return (
    <section className="Q-set-sec">
      <h3>Hey chef</h3>
      <label className="Q-set-row Q-set-check">
        <div><div className="Q-set-label">Listening now</div><div className="Q-set-help">Say “Hey chef” and what you need. Also the microphone at the top of the app.</div></div>
        <input type="checkbox" className="Q-switch" checked={!!st.on} onChange={(e) => setHeyChef({ on: e.target.checked })} />
      </label>
      <label className="Q-set-row Q-set-check">
        <div><div className="Q-set-label">Listen from the start</div><div className="Q-set-help">Turns Hey chef on whenever the app opens on this device.</div></div>
        <input type="checkbox" className="Q-switch" checked={!!hey.auto} onChange={(e) => set({ auto: e.target.checked })} />
      </label>
      <label className="Q-set-row Q-set-check">
        <div><div className="Q-set-label">Answer out loud</div><div className="Q-set-help">Hey chef says its answers; otherwise they only show on screen.</div></div>
        <input type="checkbox" className="Q-switch" checked={hey.speak !== false} onChange={(e) => set({ speak: e.target.checked })} />
      </label>
      <div className="Q-set-row">
        <div><div className="Q-set-label">Language</div><div className="Q-set-help">The language you speak to it in (“Hey chef” in English, “Oye chef” in Spanish…).</div></div>
        <select className="Q-select" value={hey.lang || 'auto'} onChange={(e) => set({ lang: e.target.value })}>
          {HEY_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <details className="Q-hey-examples">
        <summary>What you can say</summary>
        <ul>{HEY_EXAMPLES.map((x) => <li key={x}>“Hey chef, {x}”</li>)}</ul>
        <p className="Q-set-help">Anything else is answered by the AI, with the recipe on screen in mind. In chef mode, “next”, “back”, “repeat” and “step 4” work without “Hey chef”.</p>
      </details>
    </section>
  )
}
