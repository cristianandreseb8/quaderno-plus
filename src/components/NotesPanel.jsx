import { useEffect, useRef, useState } from 'react'
import { uid, ts } from '../lib/recipeCalc.js'
import { parseTabs, serializeTabs } from '../lib/notesData.js'
import { useVoiceInput } from '../lib/voice.js'
import { aiSuggestNotes } from '../lib/ai.js'
import MediaLibraryPanel from './MediaLibraryPanel.jsx'

export default function NotesPanel({ recipe, onSave, onSaveMedia, onAddNote }) {
  const [tabs, setTabs] = useState(() => parseTabs(recipe.notes_pad))
  const [activeIdx, setActiveIdx] = useState(0)
  const [activeSection, setActiveSection] = useState('notes') // 'notes' | 'media'
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const timer = useRef(null)

  useEffect(() => { setTabs(parseTabs(recipe.notes_pad)); setActiveIdx(0) }, [recipe.id])
  useEffect(() => { if (onAddNote) onAddNote.current = appendNote }, [tabs, activeIdx])

  function appendNote(content) {
    setTabs((prev) => {
      const next = prev.map((t, i) => (i === activeIdx ? { ...t, content: t.content + (t.content ? '\n\n' : '') + content } : t))
      save(next)
      return next
    })
  }

  function save(t) {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setSaving(true)
      try { await onSave(serializeTabs(t)) } finally { setSaving(false) }
    }, 1200)
  }

  const voice = useVoiceInput((transcript) => {
    const entry = `[${ts()}]\n${transcript}`
    setTabs((prev) => {
      const next = prev.map((t, i) => (i === activeIdx ? { ...t, content: t.content + (t.content ? '\n\n' : '') + entry } : t))
      save(next)
      return next
    })
  }, true)

  function updateContent(val) {
    setTabs((prev) => {
      const next = prev.map((t, i) => (i === activeIdx ? { ...t, content: val } : t))
      save(next)
      return next
    })
  }
  function addTab() {
    const newTab = { id: uid(), name: 'New Tab', content: '' }
    const next = [...tabs, newTab]
    setTabs(next); setActiveIdx(next.length - 1); save(next)
  }
  function renameTab(idx) {
    const name = prompt('Tab name:', tabs[idx].name)
    if (name && name.trim()) {
      setTabs((prev) => { const next = prev.map((t, i) => (i === idx ? { ...t, name: name.trim() } : t)); save(next); return next })
    }
  }
  function removeTab(idx) {
    if (tabs.length === 1) { alert('Cannot remove the only tab.'); return }
    if (!confirm(`Remove tab "${tabs[idx].name}"?`)) return
    const next = tabs.filter((_, i) => i !== idx)
    setTabs(next); setActiveIdx(Math.min(activeIdx, next.length - 1)); save(next)
  }
  async function aiSuggest() {
    setAiLoading(true)
    try {
      const r = await aiSuggestNotes(recipe, tabs[activeIdx]?.content || '')
      const t = r?.text || ''
      appendNote('✨ AI Suggestions:\n' + t)
    } catch (e) {
      alert('AI suggest failed: ' + e.message)
    } finally {
      setAiLoading(false)
    }
  }

  const activeTab = tabs[activeIdx] || tabs[0]

  return (
    <div className="Q-notes-panel">
      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '2px solid var(--rule)' }}>
        {[['notes', '📝 Notes'], ['media', '🖼 Media']].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setActiveSection(k)}
            style={{
              fontFamily: 'var(--sans)', fontSize: 12.5, fontWeight: 600, background: 'none', border: 'none', padding: '8px 14px', cursor: 'pointer',
              color: activeSection === k ? 'var(--navy)' : 'var(--muted)',
              borderBottom: activeSection === k ? '2px solid var(--amber)' : '2px solid transparent', marginBottom: -2,
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {activeSection === 'notes' && (
        <>
          <div className="Q-notes-tabs-row">
            {tabs.map((t, i) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button className={`Q-notes-tab${i === activeIdx ? ' active' : ''}`} onClick={() => setActiveIdx(i)}>{t.name}</button>
                {i === activeIdx && (
                  <button onClick={() => renameTab(i)} title="Rename" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--muted)', padding: '0 3px', lineHeight: 1, marginLeft: -2 }}>✏</button>
                )}
              </div>
            ))}
            <button className="Q-notes-tab-add" onClick={addTab} title="Add tab">＋</button>
          </div>
          <div className="Q-notes-toolbar">
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.18em', color: 'var(--navy)' }}>📝 {activeTab?.name}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {saving && <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>saving…</span>}
              {voice.recording && <span className="Q-recording-pill">🔴 Recording…</span>}
              {tabs.length > 1 && <button className="btn danger xs" onClick={() => removeTab(activeIdx)}>Remove tab</button>}
              <select value={voice.lang} onChange={(e) => voice.setLang(e.target.value)} style={{ border: '1px solid var(--rule)', borderRadius: 5, padding: '2px 5px', fontSize: 10, fontFamily: 'var(--mono)', background: '#fff', color: 'var(--ink)' }}>
                {voice.VOICE_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <button className={`Q-voice-btn${voice.recording ? ' recording' : ''}`} onClick={voice.recording ? voice.stop : voice.start} title="Voice note">{voice.recording ? '⏹' : '🎙'}</button>
              <button className="btn xs ai" onClick={aiSuggest} disabled={aiLoading}>{aiLoading ? '…' : '✨ AI'}</button>
            </div>
          </div>
          {voice.recording && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>🔴 Recording… tap ⏹ to stop. Transcribed + timestamp added.</div>}
          <textarea
            className="Q-notes-textarea"
            value={activeTab?.content || ''}
            onChange={(e) => updateContent(e.target.value)}
            placeholder={`${activeTab?.name} for ${recipe.title}…\n\n🎙 Mic → transcribes with smart baking term correction + timestamp\n✨ AI → suggestions based on this recipe`}
          />
        </>
      )}
      {activeSection === 'media' && <MediaLibraryPanel recipeId={recipe.id} mediaRaw={recipe.media_library || ''} onSave={onSaveMedia} />}
    </div>
  )
}
