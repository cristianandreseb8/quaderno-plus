// The scale a recipe is shown at, kept on the device per recipe — through closing the recipe or
// the app, and signing out — with the scales before it, so a change can be undone.
// A session keeps its own batch size in the database; here only its undo history ("cook:<id>").
const KEY = 'qdplus_scales'
const MAX_PAST = 20
const readAll = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch (_) { return {} } }
const writeAll = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all)) } catch (_) { /* storage unavailable */ } }

// { cur: { factor, label } | null, past: [scale | null, …] }
export function readScale(key) {
  const v = readAll()[key]
  return { cur: v?.cur || null, past: Array.isArray(v?.past) ? v.past : [] }
}
export function writeScale(key, cur, past) {
  const all = readAll()
  if (!cur && !past.length) delete all[key]
  else all[key] = { cur: cur || null, past: past.slice(-MAX_PAST) }
  writeAll(all)
}
// The factor a recipe was last scaled to in the recipe view (a new session starts from it).
export const savedFactor = (id) => Number(readScale(`view:${id}`).cur?.factor) || 1
