import { useMemo } from 'react'
import { fmtQty, parseIng, parseSections } from '../lib/recipeCalc.js'
import { KNOWN_UNITS } from '../lib/ingredientLibrary.js'
import { LinkedText } from './VaultPanels.jsx'

// Only real weight/volume units count as mass. The app-wide toGrams() falls back to
// returning the bare number for anything it doesn't know, which is fine for rough totals
// but ruinous here: "1 large pineapple" would become 1 g and blow the scale column up
// to five figures.
const MASS_UNITS = { g: 1, gr: 1, gram: 1, grams: 1, gramo: 1, gramos: 1, kg: 1000, kilo: 1000, kilos: 1000, mg: 0.001, lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592, oz: 28.3495, ounce: 28.3495, ounces: 28.3495 }
const VOLUME_UNITS = { ml: 1, cl: 10, dl: 100, l: 1000, lt: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000, litro: 1000, litros: 1000 }

function massOf(qty, unit) {
  if (qty == null) return null
  const u = String(unit || '').toLowerCase()
  if (MASS_UNITS[u] != null) return qty * MASS_UNITS[u]
  if (VOLUME_UNITS[u] != null) return qty * VOLUME_UNITS[u] // water-density approximation, as elsewhere in the app
  return null
}

// parseIng treats whatever word follows the number as the unit, so "2 cinnamon sticks"
// parses as 2 × "cinnamon". Anything not in the known-unit list belongs to the name.
function displayParts(raw) {
  const p = parseIng(raw)
  if (p.qty == null) return { qty: null, unit: '', name: String(raw).trim() }
  const u = String(p.unit || '').toLowerCase()
  if (u && !KNOWN_UNITS.has(u)) return { qty: p.qty, unit: '', name: `${p.unit} ${p.name}`.trim() }
  return { qty: p.qty, unit: p.unit, name: p.name }
}

/**
 * Professional-cookbook presentation of a recipe, modelled on the Modernist Cuisine
 * chef-volume layout: component overview with weights, then a table per component with a
 * scaling column, then the preparation.
 *
 * The scaling column follows that book's convention — within a component the first
 * weighable ingredient is 100% and everything else is expressed against it, which is what
 * lets you re-scale a component from any single ingredient you happen to have.
 */
export default function ChefView({ recipe, checked, onToggle, onClearChecks, highlightedSteps, resolveLink, onOpenRecipe, onCreateFromLink }) {
  const components = useMemo(() => {
    const secs = parseSections(recipe.ingredients || [])
    return secs.map((sec) => {
      const items = sec.items.map((raw, i) => {
        const p = displayParts(raw)
        return { raw, ...p, grams: massOf(p.qty, p.unit), rawIdx: sec.rawIndices[i] }
      })
      // The first weighable ingredient is the 100% reference for the component.
      const base = items.find((it) => it.grams > 0)?.grams || 0
      const total = items.reduce((s, it) => s + (it.grams || 0), 0)
      return { name: sec.name, items, base, total }
    })
  }, [recipe])

  const grandTotal = components.reduce((s, c) => s + c.total, 0)
  const named = components.filter((c) => c.name)
  // The reference layout's subtitle is a run-through of the components; derive the same.
  const subtitle = named.length > 1 ? named.map((c) => c.name).join(' · ') : ''

  return (
    <div className="CF">
      {/* Title, category, time, yield and source are already in the page header above —
          this block only adds what that header doesn't carry. */}
      {(subtitle || grandTotal > 0 || checked.size > 0) && (
        <header className="CF-head">
          {subtitle && <div className="CF-sub">{subtitle}</div>}
          <div className="CF-head-row">
            {grandTotal > 0 && <span className="CF-batch">Total batch <strong>{fmtQty(grandTotal)} g</strong></span>}
            {checked.size > 0 && (
              <button className="CF-clear" onClick={onClearChecks}>clear {checked.size} checked</button>
            )}
          </div>
        </header>
      )}

      {named.length > 1 && (
        <>
          <h2 className="CF-h">Order of preparation</h2>
          <table className="CF-table">
            <thead>
              <tr>
                <th>Component</th>
                <th className="num">Items</th>
                <th className="num">Amount</th>
                <th className="num">Share</th>
              </tr>
            </thead>
            <tbody>
              {components.map((c, i) => (
                <tr key={i}>
                  <td>{c.name || <span className="CF-dim">Main</span>}</td>
                  <td className="num">{c.items.length}</td>
                  <td className="num">{c.total > 0 ? `${fmtQty(c.total)} g` : '—'}</td>
                  <td className="num">{grandTotal > 0 && c.total > 0 ? `${((c.total / grandTotal) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
              <tr className="CF-total-row">
                <td>Total</td>
                <td className="num">{components.reduce((s, c) => s + c.items.length, 0)}</td>
                <td className="num">{grandTotal > 0 ? `${fmtQty(grandTotal)} g` : '—'}</td>
                <td className="num">{grandTotal > 0 ? '100%' : '—'}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {components.map((c, ci) => (
        <section className="CF-comp" key={ci}>
          <div className="CF-comp-head">
            <h3>{c.name || 'Ingredients'}</h3>
            {c.total > 0 && <span className="CF-yield">Makes {fmtQty(c.total)} g</span>}
          </div>
          <table className="CF-ing">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th className="num">Amount</th>
                <th className="num">Scale</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((it) => {
                const isCk = checked.has(it.rawIdx)
                const pct = c.base > 0 && it.grams ? (it.grams / c.base) * 100 : null
                return (
                  <tr
                    key={it.rawIdx} className={isCk ? 'checked' : ''}
                    onClick={() => onToggle(it.rawIdx)}
                  >
                    <td className="CF-ing-name">{it.name}</td>
                    <td className="num CF-ing-qty">
                      {it.qty != null ? `${fmtQty(it.qty)}${it.unit ? ' ' + it.unit : ''}` : <span className="CF-dim">to taste</span>}
                    </td>
                    <td className="num CF-ing-pct">{pct != null ? `${pct.toFixed(pct >= 100 ? 0 : 1)}%` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}

      {(recipe.steps || []).length > 0 && (
        <>
          <h2 className="CF-h">Preparation</h2>
          <ol className="CF-steps">
            {recipe.steps.map((s, i) => (
              <li key={i} className={highlightedSteps.has(i) ? 'highlighted' : ''}>
                <LinkedText text={s} resolve={resolveLink} onOpen={onOpenRecipe} onCreate={onCreateFromLink} />
              </li>
            ))}
          </ol>
        </>
      )}

      {recipe.notes && (
        <>
          <h2 className="CF-h">Notes</h2>
          <div className="CF-notes">
            <LinkedText text={recipe.notes} resolve={resolveLink} onOpen={onOpenRecipe} onCreate={onCreateFromLink} />
          </div>
        </>
      )}
    </div>
  )
}
