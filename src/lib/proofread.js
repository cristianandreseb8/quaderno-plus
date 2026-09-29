import { isSectionHeader, linkOf, numberSteps } from './recipeCalc.js'

// Spelling and grammar check for the recipe editor: which texts go to the AI, and how each
// correction is shown (a word-level diff) before the cook accepts it.

// Every text of a recipe, with an id the AI hands back with its correction.
export function proofreadItems({ title, ingredients, steps, notes }) {
  const items = []
  if (String(title || '').trim()) items.push({ id: 'title', text: title })
  // Lines that use another recipe ("350 g  [[Pâte brisée|id]]") have nothing to correct.
  const worth = (t) => String(t).trim() && String(t).trim() !== '##' && !linkOf(t)
  ;(ingredients || []).forEach((t, i) => { if (worth(t)) items.push({ id: `ing${i}`, text: t }) })
  ;(steps || []).forEach((t, i) => { if (worth(t)) items.push({ id: `step${i}`, text: t }) })
  if (String(notes || '').trim()) items.push({ id: 'notes', text: notes })
  return items
}

// A human label for an id: "Title", "Ingredient", "Section", "Step 5", "Notes".
export function itemLabel(id, { ingredients, steps } = {}) {
  if (id === 'title') return 'Title'
  if (id === 'notes') return 'Notes'
  const m = /^(ing|step)(\d+)$/.exec(id)
  if (!m) return id
  const i = +m[2]
  const list = (m[1] === 'ing' ? ingredients : steps) || []
  if (isSectionHeader(list[i] || '')) return 'Section'
  if (m[1] === 'ing') return 'Ingredient'
  return `Step ${numberSteps(steps)[i]?.n || i + 1}`
}

// Words, numbers, single punctuation marks and runs of spaces, so a changed accent or comma
// marks only that word or mark.
const tokens = (s) => String(s).match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || []

// Word-level diff: [{ op: '=' | '-' | '+', text }] with neighbouring parts of one kind merged.
export function wordDiff(a, b) {
  const A = tokens(a), B = tokens(b)
  const n = A.length, m = B.length
  // Very long notes: show the whole text replaced rather than build a huge table.
  if (n * m > 3e6) return [{ op: '-', text: String(a) }, { op: '+', text: String(b) }]
  // Longest common subsequence, filled from the end so the walk below goes forward.
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  }
  const out = []
  const push = (op, text) => {
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += text
    else out.push({ op, text })
  }
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('=', A[i]); i++; j++ }
    else if (L[i + 1][j] >= L[i][j + 1]) push('-', A[i++])
    else push('+', B[j++])
  }
  while (i < n) push('-', A[i++])
  while (j < m) push('+', B[j++])
  // Deletions before insertions within a changed stretch, so "harína → harina" reads in order.
  for (let k = 0; k < out.length - 1; k++) {
    if (out[k].op === '+' && out[k + 1].op === '-') [out[k], out[k + 1]] = [out[k + 1], out[k]]
  }
  return out
}
