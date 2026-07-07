import { getTotalGrams, isFlour, parseIng, parseSections, toGrams } from '../lib/recipeCalc.js'
import { calcMacros } from '../lib/macros.js'

export async function exportXLS(recipe, pctOpts = null) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const rows = [
    [`QUADERNO+ — ` + (recipe.title || 'Recipe')], [],
    ['Category', recipe.category || ''], ['Time', recipe.time || ''], ['Yield', recipe.servings || ''], [],
    [pctOpts?.showPct ? "INGREDIENTS (Baker's %)" : 'INGREDIENTS'],
  ]
  const sections = parseSections(recipe.ingredients || [])
  const flourRows = []
  let curRow = rows.length + 1
  sections.forEach((sec) => {
    if (sec.name) { rows.push(['── ' + sec.name + ' ──', '', '', '']); curRow++ }
    sec.items.forEach((ing) => {
      const p = parseIng(ing)
      const g = toGrams(p.qty, p.unit)
      rows.push([p.name, p.qty || '', p.unit || '', g > 0 ? g : ''])
      if (isFlour(p.name)) flourRows.push(curRow)
      curRow++
    })
    const sg = sec.items.reduce((s, i) => { const p = parseIng(i); return s + toGrams(p.qty, p.unit) }, 0)
    if (sec.name && sg > 0) { rows.push(['Subtotal: ' + sec.name, '', '', sg]); curRow++ }
  })
  const tg = getTotalGrams(recipe.ingredients || [])
  if (tg > 0) rows.push(['TOTAL', '', '', tg])
  rows.push([], ['METHOD'])
  ;(recipe.steps || []).forEach((s, i) => rows.push([(i + 1) + '.', s]))
  if (recipe.notes) { rows.push([], ["Baker's Notes"]); rows.push([recipe.notes]) }
  const ws1 = XLSX.utils.aoa_to_sheet(rows)
  ws1['!cols'] = [{ wch: 32 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, ws1, 'Recipe')

  const flatItems = sections.flatMap((s) => s.items)
  const calcRows = [
    ["Baker's Calculator — " + (recipe.title || '')],
    ['Edit grams in column B → percentages update automatically.'], [],
    ['Ingredient', 'Grams', "Baker's %", 'Note'],
  ]
  flatItems.forEach((ing) => {
    const p = parseIng(ing)
    const g = toGrams(p.qty, p.unit)
    calcRows.push([p.name, g > 0 ? g : 0, '', isFlour(p.name) ? '← flour base' : ''])
  })
  const ws2 = XLSX.utils.aoa_to_sheet(calcRows)
  ws2['!cols'] = [{ wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, ws2, "Baker's Calc")

  const m = calcMacros(recipe.ingredients)
  const macroRows = [
    ['I+D — Macros & Parameters', ''], ['Recipe', recipe.title || ''], ['Total batch', m.total + 'g'], [''],
    ['MACRO PARAMETERS', 'Per 100g of batch'],
    ['Total fat', m.fatP + '%'], ['Total water / hydration', m.hydration + '%'], ["Baker's hydration", m.bakersHydration + '%'],
    ['Total sugar', m.sugarP + '%'], ["Salt (baker's %)", m.saltP + '%'], [''],
    ['NUTRITIONAL (estimate)', 'Per batch'],
    ['Fat', m.fat + 'g'], ['Water', m.water + 'g'], ['Sugar', m.sugar + 'g'], ['Protein', m.protein + 'g'], ['Carbs', m.carbs + 'g'], ['Calories (kcal)', m.cal],
  ]
  const ws3 = XLSX.utils.aoa_to_sheet(macroRows)
  ws3['!cols'] = [{ wch: 28 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(wb, ws3, 'I+D Macros')

  XLSX.writeFile(wb, (recipe.title || 'recipe').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.xlsx')
}
