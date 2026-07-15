import { Component } from 'react'
import { logClientError } from '../lib/errorLog.js'

// Last-resort catch so a render error shows a recovery screen instead of unmounting
// the whole app to a blank page. Also breaks the crash-restore loop: the app reopens
// the last-viewed recipe on load, so if rendering it crashes, we must clear that
// restore state or every reload lands right back on the crash.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('App crash:', error, info)
    logClientError('ErrorBoundary', error)
    try {
      localStorage.removeItem('qdplus_last_recipe')
    } catch (_) { /* storage may be unavailable */ }
  }

  handleReload = () => {
    try {
      localStorage.removeItem('qdplus_last_recipe')
      sessionStorage.clear()
    } catch (_) { /* storage may be unavailable */ }
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    const err = this.state.error
    const detail = (err?.message || String(err)) + '\n' + String(err?.stack || '').split('\n').slice(0, 4).join('\n')
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center', background: 'var(--paper, #faf6ef)', color: 'var(--ink, #2b2b2b)' }}>
        <div style={{ fontSize: 34 }}>😵</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Something went wrong</div>
        <div style={{ fontSize: 12.5, color: '#8a8378', maxWidth: 420 }}>
          The error was recorded automatically. Reloading returns you to the recipe list — your recipes are safe.
        </div>
        <button
          onClick={this.handleReload}
          style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: '#b7791f', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
        >
          ↻ Reload app
        </button>
        <pre style={{ fontSize: 10, color: '#a8a094', maxWidth: '92vw', overflow: 'auto', whiteSpace: 'pre-wrap', textAlign: 'left', background: 'rgba(0,0,0,0.04)', borderRadius: 6, padding: 10, margin: 0 }}>{detail}</pre>
      </div>
    )
  }
}
