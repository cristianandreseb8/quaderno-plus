import { useState } from 'react'
import Menu, { MenuItem, MenuLabel, MenuSep } from '../ui/Menu.jsx'

const PRESETS = [0.5, 1, 1.5, 2, 3, 4]

// "×2" pill: how many batches of this recipe the session makes. Everything downstream —
// shopping quantities and the cooking view — scales from it.
export default function FactorMenu({ factor, onChange, onRemove, align = 'end' }) {
  const [custom, setCustom] = useState('')
  const f = Number(factor) || 1
  return (
    <Menu
      align={align} width={200}
      trigger={(p) => (
        <button type="button" className="Q-factor" onClick={(e) => { e.stopPropagation(); p.toggle() }} title="Batches">
          ×{+f.toFixed(2)}
        </button>
      )}
    >
      <MenuLabel>Batches</MenuLabel>
      {PRESETS.map((v) => <MenuItem key={v} checked={v === f} onClick={() => onChange(v)}>×{v}</MenuItem>)}
      <div className="Q-factor-custom" onClick={(e) => e.stopPropagation()}>
        <input
          type="number" min="0.1" step="0.1" placeholder="Other…" value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && parseFloat(custom) > 0) { onChange(parseFloat(custom)); setCustom('') } }}
        />
      </div>
      {onRemove && (<><MenuSep /><MenuItem danger onClick={onRemove}>Remove from session</MenuItem></>)}
    </Menu>
  )
}
