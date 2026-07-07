import { useState } from 'react'
import { calcMacros } from '../lib/macros.js'

const COLORS = ['#1F3A4D', '#BC6C2C', '#2D6A4F', '#5B3A8C', '#1A6B6B']
const PARAMS = [
  { k: 'fatP', label: 'Total fat %', max: 50 },
  { k: 'hydration', label: 'Hydration %', max: 100 },
  { k: 'bakersHydration', label: "Baker's hydration %", max: 120 },
  { k: 'sugarP', label: 'Sugar %', max: 40 },
  { k: 'saltP', label: "Salt (baker's %) %", max: 4 },
]

export default function ComparePanel({ recipes, onClose }) {
  const [sel, setSel] = useState([])
  const selected = recipes.filter((r) => sel.includes(r.id))
  const allMacros = selected.map((r) => ({ r, m: calcMacros(r.ingredients) }))

  return (
    <div className="Q-compare-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="Q-compare-panel">
        <div className="Q-compare-header">
          <span style={{ fontFamily: 'var(--serif)', fontSize: 17, color: 'var(--navy)', flex: 1 }}>⚖ Recipe Comparison</span>
          <button className="btn ghost xs" onClick={onClose}>✕ Close</button>
        </div>
        <div className="Q-compare-body">
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--muted)', marginBottom: 7 }}>Select recipes to compare</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {recipes.slice(0, 20).map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSel((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: 'var(--mono)', transition: 'all .15s',
                    border: `1.5px solid ${sel.includes(r.id) ? COLORS[sel.indexOf(r.id) % COLORS.length] : 'var(--rule)'}`,
                    background: sel.includes(r.id) ? COLORS[sel.indexOf(r.id) % COLORS.length] + '22' : '#fff',
                    color: sel.includes(r.id) ? COLORS[sel.indexOf(r.id) % COLORS.length] : 'var(--muted)',
                  }}
                >
                  {r.title}
                </button>
              ))}
            </div>
          </div>
          {selected.length >= 2 && (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                {selected.map((r, i) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: COLORS[i % COLORS.length] }} />
                    {r.title}
                  </div>
                ))}
              </div>
              {PARAMS.map((param) => (
                <div key={param.k} style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--navy)', marginBottom: 5 }}>{param.label}</div>
                  {allMacros.map(({ r, m }, i) => {
                    const v = m[param.k] || 0
                    const pct = Math.min(100, (v / param.max) * 100)
                    return (
                      <div key={r.id} style={{ marginBottom: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>
                          <span>{r.title}</span>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: COLORS[i % COLORS.length] }}>{v}%</span>
                        </div>
                        <div className="ID-compare-bar">
                          <div className="ID-compare-fill" style={{ width: pct + '%', background: COLORS[i % COLORS.length] }} />
                        </div>
                      </div>
                    )
                  })}
                  {allMacros.length >= 2 && (() => {
                    const vals = allMacros.map((x) => x.m[param.k] || 0)
                    const max = Math.max(...vals), min = Math.min(...vals), diff = Math.round((max - min) * 10) / 10
                    if (diff === 0) return <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>✓ Identical</div>
                    const maxR = allMacros[vals.indexOf(max)].r
                    return <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>↕ {diff}% difference · highest: <strong>{maxR.title}</strong></div>
                  })()}
                </div>
              ))}
              <div style={{ marginTop: 16, borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--navy)', marginBottom: 8 }}>Batch size</div>
                {allMacros.map(({ r, m }, i) => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dotted var(--rule)', fontSize: 13 }}>
                    <span style={{ color: COLORS[i % COLORS.length], fontWeight: 600 }}>{r.title}</span>
                    <span style={{ fontFamily: 'var(--mono)' }}>{m.total}g</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {selected.length === 1 && <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 16 }}>Select at least one more recipe to compare.</div>}
          {selected.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 16 }}>Select 2 or more recipes above to see a side-by-side comparison.</div>}
        </div>
      </div>
    </div>
  )
}
