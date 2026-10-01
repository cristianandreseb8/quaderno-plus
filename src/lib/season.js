// The season of a recipe ("Jan" template): when its fresh ingredients are in season where the cook
// lives. The AI says, per ingredient, whether it is seasonal produce and its months; the recipe's
// months are the ones every fresh ingredient shares. Kept on the device per ingredient list.
import { useEffect, useState } from 'react'
import { seasonality } from './ai.js'
import { isSectionHeader, isRefLine, linkOf, splitIngLine } from './recipeCalc.js'

const KEY = 'qdplus_seasons'
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch (_) { return {} } }
const write = (all) => {
  try {
    const keep = Object.entries(all).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 120)
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)))
  } catch (_) { /* storage unavailable */ }
}
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (_) { return '' } }
export const regionOf = (setting) => (String(setting || '').trim() || tz() || 'Central Europe')
// Southern hemisphere: the seasons' names turn around.
const SOUTH = /(chile|argentin|uruguay|paraguay|brazil|brasil|sao_paulo|buenos_aires|santiago|montevideo|lima|peru|bolivia|la_paz|australia|new zealand|auckland|sydney|melbourne|perth|johannesburg|south africa|cape_town|maputo|harare|lusaka|antananarivo)/i
export const southern = (region) => SOUTH.test(region)

const names = (ingredients) => (ingredients || [])
  .filter((l) => String(l).trim() && !isSectionHeader(l) && !isRefLine(l) && !linkOf(l))
  .map((l) => splitIngLine(l).name.replace(/\([^)]*\)/g, '').trim()).filter(Boolean)

// { months: [1–12] (all year: 1..12), fresh: [{ name, months }], note }
export function summarize(res) {
  const fresh = (res?.items || []).filter((x) => x.fresh && Array.isArray(x.months) && x.months.length && x.months.length < 12)
  let months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  fresh.forEach((x) => { months = months.filter((m) => x.months.includes(m)) })
  return { months, fresh, note: res?.note || '' }
}

const SEASONS = [['Winter', [12, 1, 2]], ['Spring', [3, 4, 5]], ['Summer', [6, 7, 8]], ['Autumn', [9, 10, 11]]]
// "All year", "Summer", "Spring and summer"… — a season counts when two of its three months fit.
export function seasonLabel(months, south = false) {
  if (months.length === 12) return 'All year'
  if (!months.length) return 'No shared season'
  const flip = { Winter: 'Summer', Summer: 'Winter', Spring: 'Autumn', Autumn: 'Spring' }
  const hits = SEASONS.filter(([, ms]) => ms.filter((m) => months.includes(m)).length >= 2).map(([n]) => (south ? flip[n] : n))
  const order = ['Spring', 'Summer', 'Autumn', 'Winter']
  const sorted = order.filter((n) => hits.includes(n))
  return sorted.length ? sorted.join(' · ') : 'A short season'
}

export function useSeason(recipe, region, enabled) {
  const list = names(recipe?.ingredients)
  const key = `${region}|${list.join('|').toLowerCase()}`
  const [state, setState] = useState(() => (enabled ? read()[key]?.res || null : null))
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!enabled || !list.length) { setState(null); return undefined }
    const hit = read()[key]
    if (hit) { setState(hit.res); return undefined }
    let live = true
    setLoading(true)
    seasonality(list, region)
      .then((res) => { const all = read(); all[key] = { res, at: Date.now() }; write(all); if (live) setState(res) })
      .catch(() => { /* no season shown */ })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [key, enabled])
  return { data: state ? summarize(state) : null, loading }
}
