import Modal from './ui/Modal.jsx'
import { THEMES, TEXT_SIZES, useSettings } from '../lib/settings.js'
import { LANGS } from '../lib/constants.js'
import { INSTALL_HELP, useInstall } from '../lib/install.js'

function ThemeCard({ theme, active, onPick }) {
  const [bg, surface, accent, ink] = theme.colors
  return (
    <button type="button" className={`Q-theme-card${active ? ' active' : ''}`} onClick={onPick} aria-pressed={active}>
      <div className={`Q-theme-prev font-${theme.font}`} style={{ background: bg, color: ink }}>
        <div className="Q-theme-prev-side" style={{ background: surface }}>
          <i style={{ background: accent }} /><i /><i />
        </div>
        <div className="Q-theme-prev-main">
          <b>Brioche</b>
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

export default function SettingsModal({ onClose, uncategorizedCount, categorizing, onAutoCategorize, recipeCount }) {
  const { settings, update } = useSettings()
  const install = useInstall()

  return (
    <Modal title="Settings" onClose={onClose} width={760}>
      <section className="Q-set-sec">
        <h3>Template</h3>
        <p className="Q-set-help">Changes colours and typography across the whole app. Saved on this device.</p>
        <div className="Q-theme-grid">
          {THEMES.map((t) => <ThemeCard key={t.id} theme={t} active={settings.theme === t.id} onPick={() => update({ theme: t.id })} />)}
        </div>
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
