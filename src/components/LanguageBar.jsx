import { useEffect, useRef, useState } from 'react'
import { DEFAULT_LANGUAGES, FLAG_CHOICES, LANG_NAMES } from '../lib/i18n.js'

/**
 * Flag switcher for the whole app. The list of flags is the team's own — you add the
 * languages the people in the kitchen actually read, and nothing else is offered.
 */
export default function LanguageBar({ languages, current, onPick, onSaveLanguages, busy, progress }) {
  const [managing, setManaging] = useState(false)
  const [draft, setDraft] = useState(languages)
  const ref = useRef(null)

  useEffect(() => { setDraft(languages) }, [languages])
  useEffect(() => {
    if (!managing) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setManaging(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [managing])

  function addLang(code, flag) {
    if (draft.some((l) => l.code === code && l.flag === flag)) return
    setDraft([...draft, { code, flag, label: LANG_NAMES[code] || code }])
  }
  function save() { onSaveLanguages(draft.length ? draft : DEFAULT_LANGUAGES); setManaging(false) }

  return (
    <span className="LB" ref={ref}>
      {languages.map((l) => (
        <button
          key={l.code + l.flag}
          className={`LB-flag${current === l.code ? ' active' : ''}`}
          title={l.label}
          disabled={busy}
          onClick={() => onPick(l.code)}
        >{l.flag}</button>
      ))}
      <button className="LB-manage" title="Manage languages" onClick={() => setManaging((v) => !v)}>⚙</button>

      {busy && (
        <span className="LB-busy">
          {progress ? `Translating ${progress.done}/${progress.total}…` : 'Translating…'}
        </span>
      )}

      {managing && (
        <div className="LB-panel">
          <div className="LB-panel-h">Languages your team reads</div>
          <div className="LB-current">
            {draft.map((l, i) => (
              <span key={l.code + l.flag + i} className="LB-chip">
                {l.flag} {l.label}
                <button onClick={() => setDraft(draft.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
            {!draft.length && <span className="LB-empty">None — add at least one.</span>}
          </div>
          <div className="LB-panel-h">Add</div>
          <div className="LB-choices">
            {FLAG_CHOICES.map(([code, flag], i) => (
              <button key={code + flag + i} title={LANG_NAMES[code]} onClick={() => addLang(code, flag)}>{flag}</button>
            ))}
          </div>
          <div className="LB-panel-foot">
            <button className="H-btn primary" onClick={save}>Save</button>
            <button className="H-btn" onClick={() => { setDraft(languages); setManaging(false) }}>Cancel</button>
          </div>
          <div className="LB-hint">
            Each phrase is translated once and stored, so switching language afterwards is free.
          </div>
        </div>
      )}
    </span>
  )
}
