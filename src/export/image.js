import { calcPct, getTotalGrams, parseIng, parseSections, toGrams } from '../lib/recipeCalc.js'
import { loadImage } from '../lib/media.js'
import { parseTabs } from '../lib/notesData.js'

export async function exportImage(recipe, pctOpts = null, exportNotes = false, originalThumbnail = null) {
  const thumb = originalThumbnail || recipe.thumbnail
  const thumbImg = thumb ? await loadImage(thumb) : null
  const W = 1200, M = 68, CW = W - M * 2, DPR = 2, TH = 7000
  const cv = document.createElement('canvas')
  cv.width = W * DPR; cv.height = TH * DPR
  const ctx = cv.getContext('2d'); ctx.scale(DPR, DPR)
  ctx.fillStyle = '#FAF7F0'; ctx.fillRect(0, 0, W, TH)
  let y = 0
  const gl = (text, maxW) => {
    const wds = String(text || '').split(' '); const ls = []; let l = ''
    for (const w of wds) { const t = l ? l + ' ' + w : w; if (ctx.measureText(t).width > maxW && l) { ls.push(l); l = w } else l = t }
    if (l) ls.push(l)
    return ls
  }
  const dt = (text, x, yy, maxW, lh) => { const ls = gl(text, maxW); ls.forEach((l, i) => ctx.fillText(l, x, yy + i * lh)); return ls.length * lh }
  function rr(x, yy, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, yy); ctx.arcTo(x + w, yy, x + w, yy + h, r); ctx.arcTo(x + w, yy + h, x, yy + h, r); ctx.arcTo(x, yy + h, x, yy, r); ctx.arcTo(x, yy, x + w, yy, r); ctx.closePath()
  }
  ctx.fillStyle = '#1F3A4D'; ctx.fillRect(0, 0, W, 10); y = 62
  if (thumbImg) {
    const SZ = 110, TX = W - M - SZ, TY = 16
    ctx.save(); rr(TX, TY, SZ, SZ, 8); ctx.clip(); ctx.drawImage(thumbImg, TX, TY, SZ, SZ); ctx.restore()
    ctx.strokeStyle = 'rgba(230,222,207,.8)'; ctx.lineWidth = 1; rr(TX, TY, SZ, SZ, 8); ctx.stroke()
  }
  ctx.font = 'bold 44px Georgia,serif'; ctx.fillStyle = '#1F3A4D'
  const titleMaxW = thumbImg ? CW - 130 : CW
  y += dt(recipe.title || 'Recipe', M, y, titleMaxW, 56)
  ctx.strokeStyle = '#BC6C2C'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(M, y + 5); ctx.lineTo(M + 110, y + 5); ctx.stroke(); y += 22
  if (thumbImg) y = Math.max(y, 140)
  const mp = [recipe.category, recipe.time && `⏱ ${recipe.time}`, recipe.servings && `⚖ ${recipe.servings}`].filter(Boolean)
  if (mp.length) { ctx.font = '17px -apple-system,sans-serif'; ctx.fillStyle = '#6E645C'; ctx.fillText(mp.join('   ·   '), M, y); y += 34 }
  if (pctOpts?.appliedScaleLabel) { ctx.font = 'bold 14px ui-monospace,monospace'; ctx.fillStyle = '#2D6A4F'; ctx.fillText('⚖ ' + pctOpts.appliedScaleLabel, M, y); y += 24 }
  y += 10; ctx.strokeStyle = '#E6DECF'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke(); y += 28
  const secLbl = (label, off) => {
    ctx.font = 'bold 11px ui-monospace,monospace'; ctx.fillStyle = '#1F3A4D'; ctx.fillText(label, M, y)
    ctx.strokeStyle = '#1F3A4D'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(M + off, y - 3); ctx.lineTo(W - M, y - 3); ctx.stroke(); y += 24
  }
  const sections = parseSections(recipe.ingredients || [])
  secLbl('INGREDIENTS', 112)
  sections.forEach((sec) => {
    if (sec.name) { ctx.font = 'bold italic 17px Georgia,serif'; ctx.fillStyle = '#BC6C2C'; ctx.fillText(sec.name, M, y); y += 28 }
    const pctData = pctOpts?.showPct ? calcPct(sec.items, pctOpts.pctMode, pctOpts.pctBase) : null
    sec.items.forEach((ing, idx) => {
      const mm = ing.match(/^([\d.,]+\s*[^\s]+)\s{2,}(.+)$/) || ing.match(/^([\d.,]+\s*[a-zA-Z%]+)\s+(.+)$/)
      const pct = pctData ? pctData[idx] : null
      const nW = pct?.pct != null ? CW - 320 : CW - 186
      if (mm) {
        ctx.font = '16px ui-monospace,monospace'; ctx.fillStyle = '#6E645C'; ctx.fillText(mm[1].trim(), M, y)
        ctx.font = '17px -apple-system,sans-serif'; ctx.fillStyle = '#221C18'
        const used = dt(mm[2].trim(), M + 186, y, nW, 27)
        if (pct?.pct != null) {
          ctx.font = 'bold 15px ui-monospace,monospace'; ctx.fillStyle = pct.isBase ? '#BC6C2C' : '#6E645C'
          ctx.textAlign = 'right'; ctx.fillText(pct.pct.toFixed(1) + '%', W - M, y); ctx.textAlign = 'left'
        }
        y += Math.max(27, used) + 3
      } else {
        ctx.font = '17px -apple-system,sans-serif'; ctx.fillStyle = '#221C18'; y += dt(`· ${ing}`, M + 10, y, CW - 10, 27) + 3
      }
    })
    const sg = sec.items.reduce((s, i) => { const p = parseIng(i); return s + toGrams(p.qty, p.unit) }, 0)
    if (sec.name && sg > 0) { ctx.font = '12px ui-monospace,monospace'; ctx.fillStyle = '#BC6C2C'; ctx.textAlign = 'right'; ctx.fillText(`Subtotal: ${sg.toFixed(0)} g`, W - M, y); ctx.textAlign = 'left'; y += 18 }
  })
  const tg = getTotalGrams(recipe.ingredients || [])
  if (tg > 0) { ctx.font = 'bold 13px ui-monospace,monospace'; ctx.fillStyle = '#1F3A4D'; ctx.textAlign = 'right'; ctx.fillText(`Total: ${tg.toFixed(0)} g`, W - M, y); ctx.textAlign = 'left'; y += 26 }
  if (recipe.steps?.length) {
    secLbl('METHOD', 76)
    recipe.steps.forEach((step, i) => {
      ctx.font = 'bold 17px -apple-system,sans-serif'; ctx.fillStyle = '#BC6C2C'; ctx.fillText(String(i + 1).padStart(2, '0') + '.', M, y)
      ctx.font = '17px -apple-system,sans-serif'; ctx.fillStyle = '#221C18'; y += Math.max(27, dt(step, M + 46, y, CW - 46, 27)) + 7
    })
  }
  if (recipe.notes) {
    ctx.font = 'italic 15px -apple-system,sans-serif'
    const nl = gl(recipe.notes, CW - 44)
    const bh = nl.length * 27 + 36
    rr(M, y, CW, bh, 8); ctx.fillStyle = '#FBEFE1'; ctx.fill()
    ctx.fillStyle = '#BC6C2C'; ctx.fillRect(M, y, 4, bh)
    ctx.fillStyle = '#6E645C'; nl.forEach((l, i) => ctx.fillText(l, M + 16, y + 24 + i * 27)); y += bh + 20
  }
  if (exportNotes) {
    const tabs = parseTabs(recipe.notes_pad).filter((t) => t.content.trim())
    if (tabs.length) {
      y += 14; ctx.font = 'bold 11px ui-monospace,monospace'; ctx.fillStyle = '#1F3A4D'; ctx.fillText('NOTES', M, y)
      ctx.strokeStyle = '#1F3A4D'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(M + 56, y - 3); ctx.lineTo(W - M, y - 3); ctx.stroke(); y += 22
      tabs.forEach((tab) => {
        if (tab.name !== 'General') { ctx.font = 'bold italic 16px Georgia,serif'; ctx.fillStyle = '#5B3A8C'; ctx.fillText(tab.name, M, y); y += 24 }
        ctx.font = 'italic 15px -apple-system,sans-serif'; ctx.fillStyle = '#6E645C'
        tab.content.split('\n').forEach((line) => { if (line.trim()) { y += dt(line, M + 10, y, CW - 10, 26) } else y += 13 })
      })
    }
  }
  y += 12; ctx.strokeStyle = '#E6DECF'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke(); y += 20
  ctx.font = '12px ui-monospace,monospace'; ctx.fillStyle = '#B0A89F'; ctx.fillText('Quaderno+', M, y)
  ctx.textAlign = 'right'; ctx.fillText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), W - M, y); ctx.textAlign = 'left'
  y += 18; ctx.fillStyle = '#1F3A4D'; ctx.fillRect(0, y, W, 10); y += 10
  const out = document.createElement('canvas')
  out.width = W * DPR; out.height = y * DPR
  out.getContext('2d').drawImage(cv, 0, 0, W * DPR, y * DPR, 0, 0, W * DPR, y * DPR)
  const a = document.createElement('a')
  a.href = out.toDataURL('image/png')
  a.download = (recipe.title || 'recipe').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
}
