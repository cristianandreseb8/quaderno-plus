import { useState } from 'react'
import { regionOf, seasonLabel, southern, useSeason } from '../lib/season.js'

const LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const MONTH = (m) => new Date(2026, m - 1, 1).toLocaleString(undefined, { month: 'short' })
const span = (ms) => (ms.length >= 12 ? 'all year' : `${MONTH(ms[0])}–${MONTH(ms[ms.length - 1])}`)

// The year under the recipe's title: the months it is in season, and — tapped — which fresh
// ingredients decide it.
export default function Season({ recipe, regionSetting, enabled }) {
  const region = regionOf(regionSetting)
  const { data, loading } = useSeason(recipe, region, enabled)
  const [open, setOpen] = useState(false)
  if (!enabled || (!data && !loading)) return null
  const now = new Date().getMonth() + 1
  return (
    <div className={`Q-season${open ? ' open' : ''}`}>
      <button type="button" className="Q-season-bar" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="When its fresh ingredients are in season">
        <span className="lbl">{loading && !data ? 'Season…' : seasonLabel(data.months, southern(region))}</span>
        <span className="months" aria-hidden="true">
          {LETTERS.map((l, i) => (
            <i key={i} className={`${data?.months.includes(i + 1) ? 'on' : ''}${now === i + 1 ? ' now' : ''}`}>{l}</i>
          ))}
        </span>
      </button>
      {open && data && (
        <div className="Q-season-more">
          {data.note && <p>{data.note}</p>}
          {data.fresh.length > 0
            ? <ul>{[...data.fresh].sort((a, b) => a.months.length - b.months.length).map((x) => <li key={x.name}><b>{x.name}</b> {span([...x.months].sort((a, b) => a - b))}</li>)}</ul>
            : <p>No seasonal produce: it can be made all year.</p>}
          <small>Region: {region}</small>
        </div>
      )}
    </div>
  )
}
