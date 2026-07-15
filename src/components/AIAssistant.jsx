import { useEffect, useRef, useState } from 'react'
import { ts } from '../lib/recipeCalc.js'
import { askAssistant } from '../lib/ai.js'
import { useVoiceInput } from '../lib/voice.js'
import { EXPIRY_LABELS, EXPIRY_OPTS } from '../lib/constants.js'

const CHIPS = ['Scale to 2 kg', 'Double recipe', 'Translate to Spanish', 'What is the hydration?', 'Best proofing temperature?', 'Add mixing tip']

export default function AIAssistant({ recipe, onAction, onRequestSaveNote }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expiry, setExpiry] = useState('24 h')
  const endRef = useRef(null)
  const voice = useVoiceInput((t) => setInput((p) => p + (p ? ' ' : '') + t), true)
  const CONV_KEY = `qdplus_conv_${recipe.id}`

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(CONV_KEY) || 'null')
      if (s && s.exp > Date.now()) { setMessages(s.msgs || []); setExpiry(s.expiryLabel || '24 h') }
    } catch (_) { /* corrupt or missing cache */ }
  }, [recipe.id])
  useEffect(() => {
    if (!messages.length) return
    try {
      localStorage.setItem(CONV_KEY, JSON.stringify({
        msgs: messages.map((m) => ({ role: m.role, content: m.content, clean: m.clean, hasActions: m.hasActions })),
        exp: Date.now() + (EXPIRY_OPTS[expiry] || EXPIRY_OPTS['24 h']),
        expiryLabel: expiry,
      }))
    } catch (_) { /* storage full or unavailable */ }
  }, [messages, expiry, recipe.id])
  // Block body (no implicit return): some in-app browsers return a non-undefined value from
  // scrollIntoView, which a concise-body effect would hand back to React as a bogus cleanup fn.
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    if (!input.trim() || loading) return
    const msg = { role: 'user', content: input.trim() }
    const hist = [...messages, msg]; setMessages(hist); setInput(''); setLoading(true)
    try {
      const r = await askAssistant(hist, recipe)
      const text = r?.text || ''
      const actionRx = /<ACTION>([\s\S]*?)<\/ACTION>/g
      let m; const acts = []
      while ((m = actionRx.exec(text)) !== null) { try { acts.push(JSON.parse(m[1])) } catch (_) { /* malformed action tag */ } }
      const clean = text.replace(/<ACTION>[\s\S]*?<\/ACTION>/g, '').trim()
      setMessages((p) => [...p, { role: 'assistant', content: text, clean, hasActions: acts.length > 0 }])
      acts.forEach((a) => onAction(a))
    } catch (e) {
      setMessages((p) => [...p, { role: 'assistant', content: 'Error: ' + e.message, clean: 'Error: ' + e.message, hasActions: false }])
    } finally {
      setLoading(false)
    }
  }

  function clearConv() { setMessages([]); try { localStorage.removeItem(CONV_KEY) } catch (_) { /* storage unavailable */ } }
  async function saveAsNote() {
    const content = [`AI Conversation — ${ts()}`, ...messages.map((m) => `${m.role === 'user' ? 'You' : 'AI'}: ${m.clean || m.content}`)].join('\n\n')
    onRequestSaveNote(content)
  }

  return (
    <div className="Q-assistant">
      <div className="Q-conv-toolbar">
        <span>Keep for:</span>
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)} style={{ border: '1px solid var(--rule)', borderRadius: 5, padding: '3px 6px', fontSize: 11, fontFamily: 'var(--mono)' }}>
          {EXPIRY_LABELS.map((l) => <option key={l}>{l}</option>)}
        </select>
        {messages.length > 0 && <><button className="btn xs ghost" onClick={saveAsNote}>Save as note</button><button className="btn xs ghost" onClick={clearConv}>Clear</button></>}
      </div>
      {messages.length === 0 && (
        <div className="Q-assistant-welcome">
          <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ai)', marginBottom: 5 }}>AI Recipe Assistant</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 12 }}>Ask anything or give instructions to modify this recipe.</div>
          <div className="Q-quick-chips">{CHIPS.map((c) => <button key={c} className="Q-chip" onClick={() => setInput(c)}>{c}</button>)}</div>
        </div>
      )}
      <div className="Q-chat-wrap">
        {messages.map((m, i) => (
          <div key={i} className={`Q-chat-msg ${m.role}`}>
            {m.clean || m.content}
            {m.hasActions && <div className="Q-chat-action-badge">✓ Applied</div>}
          </div>
        ))}
        {loading && <div className="Q-chat-msg assistant"><div className="Q-chat-typing"><span /><span /><span /></div></div>}
        <div ref={endRef} />
      </div>
      <div className="Q-chat-input-area">
        <textarea
          className="Q-chat-input" value={input} onChange={(e) => setInput(e.target.value)} rows={2} disabled={loading}
          placeholder="Ask or instruct… (Enter to send, Shift+Enter for newline)"
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
    </div>
  )
}
