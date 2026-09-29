import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { fmtQty, isRefLine, isSectionHeader, linkOf, parseIng, stripLinks } from './recipeCalc.js'
import { linkFactor, resolveLink } from './links.js'
import { isUnitWord } from './grams.js'

// ── Shopping list aggregation ───────────────────────────────────────────────
// Metric units collapse to one base unit so "1 kg flour" and "250 g flour" add up;
// anything else (tsp, pcs, "large") stays its own line to avoid wrong sums.
const TO_BASE = { g: ['g', 1], gr: ['g', 1], kg: ['g', 1000], mg: ['g', 0.001], ml: ['ml', 1], cl: ['ml', 10], dl: ['ml', 100], l: ['ml', 1000] }

const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

export function itemKey(name, unit) { return `${normName(name)}|${unit || ''}` }

// Some recipes mark the stage in the ingredient name — "water (1st dough)", "water (final
// dough)". A trailing "(…)" that repeats across several lines of the same recipe is such a
// stage label and is dropped so the shopping list sums the ingredient; a one-off "(…)" is a
// real spec ("Blend T45 (p/l 0.50)") and stays.
const TRAILING = /\s*\(([^()]+)\)\s*$/
function stageLabels(lines) {
  const counts = new Map()
  for (const line of lines) {
    const m = String(parseIng(line).name).match(TRAILING)
    if (m) { const k = m[1].trim().toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1) }
  }
  return new Set([...counts].filter(([, n]) => n >= 2).map(([k]) => k))
}

// Short, readable recipe tag for the "comes from" hint: the title's first word or two.
export function shortTitle(title) {
  const words = String(title || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)
  return (words[0] || '').length > 3 ? words[0] : words.slice(0, 2).join(' ')
}

export function buildShoppingList(sessionRecipes, recipesById) {
  const map = new Map()
  // A recipe's lines; a linked recipe ("350 g  [[Pâte brisée|id]]") adds its own ingredients,
  // in the amount used — not a line to buy.
  const collect = (r, f, seen, add) => {
    // Reference lines ("→ first dough") are made in this recipe, not bought.
    const lines = (r.ingredients || []).filter((line) => String(line).trim() && !isSectionHeader(line) && !isRefLine(line))
    for (const line of lines) {
      const sub = linkOf(line) && resolveLink(linkOf(line), recipesById)
      if (sub && !seen.has(sub.id) && seen.size < 6) collect(sub, f * linkFactor(line, sub), new Set([...seen, sub.id]), add)
      else add(r, f, line, lines)
    }
  }
  for (const { id, factor } of sessionRecipes) {
    const top = recipesById.get(id)
    if (!top) continue
    const perRecipe = new Map() // recipe → { f, lines } — stage labels are read per recipe
    collect(top, Number(factor) || 1, new Set([top.id]), (r, f, line, lines) => {
      const k = `${r.id}|${f}`
      if (!perRecipe.has(k)) perRecipe.set(k, { r, f, lines, own: [] })
      perRecipe.get(k).own.push(line)
    })
    for (const { r, f, lines: all, own } of perRecipe.values()) addLines(r, f, all, own)
  }
  function addLines(r, f, all, lines) {
    const stages = stageLabels(all)
    for (const line of lines) {
      const p = parseIng(line)
      // "1 vanilla bean" is one "vanilla bean", not 1 "vanilla" of bean.
      if (p.unit && p.unit !== '%' && !isUnitWord(p.unit)) { p.name = `${p.unit} ${p.name}`; p.unit = '' }
      const [unit, mult] = TO_BASE[p.unit] || [p.unit, 1]
      let name = p.qty == null ? stripLinks(line).trim() : p.name
      const m = name.match(TRAILING)
      if (m && stages.has(m[1].trim().toLowerCase())) name = name.replace(TRAILING, '')
      const key = itemKey(name, p.qty == null ? '' : unit)
      const cur = map.get(key) || { key, name, unit: p.qty == null ? '' : unit, qty: null, recipes: [] }
      if (p.qty != null) cur.qty = (cur.qty || 0) + p.qty * mult * f
      if (!cur.recipes.includes(r.title)) cur.recipes.push(r.title)
      map.set(key, cur)
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export function formatQty(qty, unit) {
  if (qty == null) return ''
  return `${fmtQty(qty)}${unit ? ' ' + unit : ''}`
}

// ── Persistence ─────────────────────────────────────────────────────────────
const EMPTY = { recipes: [], shopping: { have: {}, qty: {}, extra: [] }, progress: {} }

function normalize(row) {
  return {
    ...row,
    recipes: Array.isArray(row?.recipes) ? row.recipes : [],
    shopping: { have: {}, qty: {}, extra: [], ...(row?.shopping || {}) },
    progress: row?.progress || {},
  }
}

async function loadActive() {
  const { data, error } = await supabase.from('cook_sessions').select('*').eq('status', 'active').order('updated_at', { ascending: false }).limit(1)
  if (error) throw error
  return data?.[0] ? normalize(data[0]) : null
}

// One active session at a time. Saves are debounced, and the session is re-read whenever the
// app regains focus, so ticking items on the phone at the shop shows up on the kitchen laptop.
export function useSession(onError) {
  const [session, setSession] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const pending = useRef(null)
  const timer = useRef(null)
  const creating = useRef(null)
  const saving = useRef(null)
  const errRef = useRef(onError)
  useEffect(() => { errRef.current = onError }, [onError])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const s = pending.current
    if (!s?.id) return
    pending.current = null
    saving.current = supabase.from('cook_sessions')
      .update({ recipes: s.recipes, shopping: s.shopping, progress: s.progress, name: s.name || '', updated_at: new Date().toISOString() })
      .eq('id', s.id)
      .then(({ error }) => { if (error) errRef.current?.('Could not save the session: ' + error.message) })
    await saving.current
    saving.current = null
  }, [])

  const refresh = useCallback(async () => {
    if (pending.current) return // local edits win until they are saved
    try {
      if (saving.current) await saving.current
      const s = await loadActive()
      if (!pending.current) setSession(s)
    } catch (e) {
      errRef.current?.('Could not load the session: ' + e.message)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    refresh()
    const onFocus = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    const onLeave = () => { flush() }
    window.addEventListener('pagehide', onLeave)
    return () => {
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onLeave)
    }
  }, [refresh, flush])

  const ensure = useCallback(async () => {
    if (session?.id) return session
    if (!creating.current) {
      creating.current = supabase.from('cook_sessions').insert([{ ...EMPTY }]).select().single()
        .then(({ data, error }) => { if (error) throw error; return normalize(data) })
        .finally(() => { creating.current = null })
    }
    return creating.current
  }, [session])

  // Apply a pure change to the session, render it at once and save shortly after.
  const change = useCallback(async (fn) => {
    let base
    try { base = await ensure() } catch (e) { errRef.current?.('Could not start a session: ' + e.message); return }
    setSession((prev) => {
      const next = normalize(fn(normalize(prev?.id === base.id ? prev : base)))
      pending.current = next
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, 500)
      return next
    })
  }, [ensure, flush])

  const finish = useCallback(async () => {
    if (!session?.id) return
    await flush()
    const { error } = await supabase.from('cook_sessions').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', session.id)
    if (error) { errRef.current?.('Could not finish the session: ' + error.message); return }
    setSession(null)
  }, [session, flush])

  return { session, loaded, change, finish }
}

// ── Pure updaters (used with change()) ──────────────────────────────────────
export const addRecipe = (id, factor = 1) => (s) => (s.recipes.some((x) => x.id === id) ? s : { ...s, recipes: [...s.recipes, { id, factor }] })
export const removeRecipe = (id) => (s) => {
  const progress = { ...s.progress }
  delete progress[id]
  return { ...s, recipes: s.recipes.filter((x) => x.id !== id), progress }
}
export const setFactor = (id, factor) => (s) => ({ ...s, recipes: s.recipes.map((x) => (x.id === id ? { ...x, factor } : x)) })
export const toggleHave = (item) => (s) => {
  const have = { ...s.shopping.have }
  if (have[item.key]) delete have[item.key]
  else have[item.key] = { name: item.name, qty: item.qty, unit: item.unit, at: new Date().toISOString() }
  return { ...s, shopping: { ...s.shopping, have } }
}
export const setQtyOverride = (key, text) => (s) => {
  const qty = { ...s.shopping.qty }
  if (text == null || text === '') delete qty[key]; else qty[key] = text
  return { ...s, shopping: { ...s.shopping, qty } }
}
export const addExtra = (text, id = Math.random().toString(36).slice(2, 10), more = {}) => (s) => ({ ...s, shopping: { ...s.shopping, extra: [...s.shopping.extra, { id, text, have: false, ...more }] } })
export const updateExtra = (id, patch) => (s) => ({ ...s, shopping: { ...s.shopping, extra: s.shopping.extra.map((e) => (e.id === id ? { ...e, ...patch } : e)) } })
export const toggleExtra = (id) => (s) => ({ ...s, shopping: { ...s.shopping, extra: s.shopping.extra.map((e) => (e.id === id ? { ...e, have: !e.have } : e)) } })
export const removeExtra = (id) => (s) => ({ ...s, shopping: { ...s.shopping, extra: s.shopping.extra.filter((e) => e.id !== id) } })
export const toggleProgress = (recipeId, kind, idx) => (s) => {
  const cur = s.progress[recipeId] || { ing: [], steps: [] }
  const list = cur[kind] || []
  const nextList = list.includes(idx) ? list.filter((i) => i !== idx) : [...list, idx]
  return { ...s, progress: { ...s.progress, [recipeId]: { ...cur, [kind]: nextList } } }
}
export const clearProgress = (recipeId, kind) => (s) => ({
  ...s, progress: { ...s.progress, [recipeId]: { ...(s.progress[recipeId] || { ing: [], steps: [] }), [kind]: [] } },
})
export const resetTicks = () => (s) => ({ ...s, shopping: { ...s.shopping, have: {}, extra: s.shopping.extra.map((e) => ({ ...e, have: false })) }, progress: {} })
