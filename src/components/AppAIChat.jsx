import { useEffect, useRef, useState } from 'react'
import { askAppAssistant } from '../lib/ai.js'
import { useVoiceInput } from '../lib/voice.js'

const CHIPS = ['Add 3 French pastry recipes', 'Search for brioche', 'Delete the recipe named…', 'Create a recipe for sourdough bread', 'List all recipes with category']

function parseAppActions(text) {
  const rx = /<APP_ACTION>([\s\S]*?)<\/APP_ACTION>/g
  let m; const acts = []
  while ((m = rx.exec(text)) !== null) { try { acts.push(JSON.parse(m[1])) } catch (_) { /* malformed action tag */ } }
  return { clean: text.replace(/<APP_ACTION>[\s\S]*?<\/APP_ACTION>/g, '').trim(), actions: acts }
}

export default function AppAIChat({ recipes, onAction, onClose }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef(null)
  const voice = useVoiceInput((t) => setInput((p) => p + (p ? ' ' : '') + t), true)

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages])

  async function send() {
    if (!input.trim() || loading) return
    const msg = { role: 'user', content: input.trim() }
    const hist = [...messages, msg]; setMessages(hist); setInput(''); setLoading(true)
    try {
      const r = await askAppAssistant(hist, recipes)
      const { clean, actions } = parseAppActions(r?.text || '')
      setMessages((p) => [...p, { role: 'assistant', content: r?.text || '', clean, hasActions: actions.length > 0 }])
      for (const act of actions) await onAction(act)
    } catch (e) {
      setMessages((p) => [...p, { role: 'assistant', content: 'Error: ' + e.message, clean: 'Error: ' + e.message, hasActions: false }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="Q-app-ai-header">
        <div className="Q-app-ai-title">🌐 App Assistant</div>
        <button className="btn ghost xs" onClick={onClose}>✕ Close</button>
      </div>
      <div className="Q-app-ai-msgs">
        {messages.length === 0 && (
          <div style={{ padding: '16px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🌐</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ai)', marginBottom: 5 }}>Quaderno+ — App Assistant</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 12 }}>Search, create, batch-import, delete recipes. Use natural language.</div>
            <div className="Q-quick-chips" style={{ justifyContent: 'center' }}>{CHIPS.map((c) => <button key={c} className="Q-chip" onClick={() => setInput(c)}>{c}</button>)}</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`Q-chat-msg ${m.role}`} style={{ maxWidth: '94%' }}>
            {m.clean || m.content}
            {m.hasActions && <div className="Q-chat-action-badge">✓ Done</div>}
          </div>
        ))}
        {loading && <div className="Q-chat-msg assistant"><div className="Q-chat-typing"><span /><span /><span /></div></div>}
        <div ref={endRef} />
      </div>
      <div className="Q-app-ai-input">
        <textarea
          style={{ flex: 1, border: '1px solid var(--rule)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', color: 'var(--ink)', resize: 'none', background: '#fff' }}
          value={input} onChange={(e) => setInput(e.target.value)} rows={2} disabled={loading}
          placeholder="Ask anything… (Enter to send)"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <select value={voice.lang} onChange={(e) => voice.setLang(e.target.value)} style={{ border: '1px solid var(--rule)', borderRadius: 5, padding: '2px 5px', fontSize: 10, fontFamily: 'var(--mono)', background: '#fff', color: 'var(--ink)' }}>
            {voice.VOICE_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <button className={`Q-voice-btn${voice.recording ? ' recording' : ''}`} onClick={voice.recording ? voice.stop : voice.start}>{voice.recording ? '⏹' : '🎙'}</button>
          <button className="btn ai xs" onClick={send} disabled={loading || !input.trim()}>↑</button>
        </div>
      </div>
    </>
  )
}
