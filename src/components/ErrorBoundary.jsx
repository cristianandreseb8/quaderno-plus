import { Component } from 'react'

// Last-resort catch so a render error (e.g. a stale lazy chunk after a redeploy)
// shows a recovery screen instead of unmounting the whole app to a blank page.
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
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center', background: 'var(--paper, #faf6ef)', color: 'var(--ink, #2b2b2b)' }}>
        <div style={{ fontSize: 34 }}>😵</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Something went wrong</div>
        <div style={{ fontSize: 12.5, color: '#8a8378', maxWidth: 420 }}>
          This usually happens after an app update. Reloading fixes it — your recipes are safe.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: '#b7791f', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
        >
          ↻ Reload app
        </button>
      </div>
    )
  }
}
