// The amount column, as wide as the longest amount in the list (counted in characters of the
// monospaced amount font), so the names line up and a long unit ("0.47 cucharaditas") never runs
// into them. The CSS turns --qty-n into a width and caps it; past the cap the unit wraps under
// the number.
export function qtyCol(qtys) {
  const n = qtys.reduce((m, q) => Math.max(m, String(q || '').trim().length), 0)
  return { '--qty-n': Math.min(Math.max(n, 3), 20) }
}
