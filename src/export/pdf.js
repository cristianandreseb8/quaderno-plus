import { calcPct, getTotalGrams, isFlour, parseIng, parseSections, toGrams } from '../lib/recipeCalc.js'
import { parseTabs } from '../lib/notesData.js'

export async function exportPDF(recipe, pctOpts = null, exportNotes = false, originalThumbnail = null) {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const M = 18, PW = 210, CW = PW - M * 2
  let y = 0
  function ck(n = 12) { if (y + n > 279) { doc.addPage(); y = M } }
  doc.setFillColor(31, 58, 77); doc.rect(0, 0, PW, 4, 'F'); y = 14
  const thumb = originalThumbnail || recipe.thumbnail
  if (thumb) { try { doc.addImage(thumb, 'JPEG', PW - M - 28, 8, 28, 28, '', 'FAST') } catch (_) { /* unsupported image format */ } }
  const titleW = thumb ? CW - 34 : CW
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(31, 58, 77)
  const tl = doc.splitTextToSize(recipe.title || 'Recipe', titleW); doc.text(tl, M, y); y += tl.length * 9
  doc.setDrawColor(188, 108, 44); doc.setLineWidth(1.5); doc.line(M, y, M + 28, y); y += 7
  const meta = [recipe.category && `Category: ${recipe.category}`, recipe.time && `Time: ${recipe.time}`, recipe.servings && `Yield: ${recipe.servings}`].filter(Boolean)
  if (meta.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 100, 92); doc.text(meta.join('   ·   '), M, y); y += 9 }
  if (thumb) y = Math.max(y, 42)
  if (pctOpts?.appliedScaleLabel) {
    doc.setFillColor(234, 242, 238); doc.rect(M, y, CW, 6, 'F')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(45, 106, 79)
    doc.text(`⚖ Scaled — ${pctOpts.appliedScaleLabel}`, M + 2, y + 4.5); y += 8
  }
  const sections = parseSections(recipe.ingredients || [])
  y += 3; doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(31, 58, 77); doc.text('INGREDIENTS', M, y); y += 6
  sections.forEach((sec) => {
    if (sec.name) { ck(12); y += 2; doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(9.5); doc.setTextColor(188, 108, 44); doc.text(sec.name, M, y); y += 6 }
    const pctData = pctOpts?.showPct ? calcPct(sec.items, pctOpts.pctMode, pctOpts.pctBase) : null
    sec.items.forEach((ing, idx) => {
      ck(7)
      const mm = ing.match(/^([\d.,]+\s*[^\s]+)\s{2,}(.+)$/) || ing.match(/^([\d.,]+\s*[a-zA-Z%]+)\s+(.+)$/)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(34, 28, 24)
      if (mm) {
        doc.setFont('courier', 'normal'); doc.text(mm[1].trim(), M, y)
        doc.setFont('helvetica', 'normal')
        const ls = doc.splitTextToSize(mm[2].trim(), CW - 38); doc.text(ls, M + 36, y)
        if (pctData && pctData[idx].pct !== null) {
          doc.setFont('courier', 'normal'); doc.setFontSize(9)
          doc.setTextColor(pctData[idx].isBase ? 188 : 110, pctData[idx].isBase ? 108 : 100, pctData[idx].isBase ? 44 : 92)
          doc.text(pctData[idx].pct.toFixed(1) + '%', PW - M, y, { align: 'right' })
          doc.setTextColor(34, 28, 24); doc.setFontSize(10)
        }
        y += ls.length * 5 + 1
      } else {
        const ls = doc.splitTextToSize(`· ${ing}`, CW); doc.text(ls, M, y); y += ls.length * 5 + 1
      }
    })
    const sg = sec.items.reduce((s, i) => { const p = parseIng(i); return s + toGrams(p.qty, p.unit) }, 0)
    if (sec.name && sg > 0) { doc.setFont('courier', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110, 100, 92); doc.text(`Subtotal: ${sg.toFixed(0)} g`, PW - M, y, { align: 'right' }); y += 6 }
  })
  const tg = getTotalGrams(recipe.ingredients || [])
  if (tg > 0) { doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(31, 58, 77); doc.text(`Total: ${tg.toFixed(0)} g`, PW - M, y, { align: 'right' }); y += 8 }
  if (recipe.steps?.length) {
    ck(12); y += 3; doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(31, 58, 77); doc.text('METHOD', M, y); y += 6
    recipe.steps.forEach((step, i) => {
      ck(10)
      const ls = doc.splitTextToSize(step, CW - 14)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(188, 108, 44); doc.text(String(i + 1).padStart(2, '0') + '.', M, y)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(34, 28, 24); doc.text(ls, M + 14, y); y += ls.length * 5.5 + 3
    })
  }
  if (recipe.notes) {
    ck(18); y += 3
    const nl = doc.splitTextToSize(recipe.notes, CW - 9)
    const bh = nl.length * 5.5 + 10
    doc.setFillColor(251, 239, 225); doc.setDrawColor(188, 108, 44); doc.setLineWidth(0.2); doc.rect(M, y, CW, bh, 'FD')
    doc.setFillColor(188, 108, 44); doc.rect(M, y, 2.5, bh, 'F')
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); doc.setTextColor(110, 100, 92); doc.text(nl, M + 5, y + 7); y += bh
  }
  if (exportNotes) {
    const tabs = parseTabs(recipe.notes_pad).filter((t) => t.content.trim())
    if (tabs.length) {
      ck(16); y += 5; doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(31, 58, 77); doc.text('NOTES', M, y); y += 6
      tabs.forEach((tab) => {
        if (tab.name !== 'General') { ck(8); doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(9); doc.setTextColor(91, 58, 140); doc.text(tab.name, M, y); y += 5 }
        const lines = tab.content.split('\n')
        lines.forEach((line) => { ck(6); const ls = doc.splitTextToSize(line || ' ', CW); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(110, 100, 92); doc.text(ls, M, y); y += ls.length * 5 })
        y += 3
      })
    }
  }
  const total = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(180, 170, 160)
    doc.text('Quaderno+', M, 292)
    doc.text(`${new Date().toLocaleDateString()}  ·  ${p}/${total}`, PW - M, 292, { align: 'right' })
    doc.setFillColor(31, 58, 77); doc.rect(0, 294, PW, 2, 'F')
  }
  doc.save((recipe.title || 'recipe').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.pdf')
}
