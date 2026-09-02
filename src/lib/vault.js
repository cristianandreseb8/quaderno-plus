// Obsidian-style "vault" layer over the recipe collection: wikilinks between recipes,
// inline #tags, nested folders, backlinks, and the fuzzy matching the switcher/palette use.
// Links and inline tags are *derived* from recipe text on every index build — the source of
// truth stays the recipe itself, so there is no link table to keep in sync.

export const FOLDER_SEP = '/'

// [[Recipe]] or [[Recipe|shown text]]. The target may not exist yet (an "unresolved" link,
// which Obsidian still tracks and shows greyed out).
const WIKILINK_SRC = '\\[\\[([^\\]|]+)(?:\\|([^\\]]+))?\\]\\]'

// #tag, #nested/tag. Requires a letter/digit right after # so markdown "## Section" headers
// (used by the recipe format for dough sections) never register as tags.
const TAG_SRC = '(^|[\\s(,;:¡¿"\'])#([\\p{L}\\p{N}][\\p{L}\\p{N}_\\-/]*)'

export function normalizeKey(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function extractLinks(text) {
  const rx = new RegExp(WIKILINK_SRC, 'g')
  const out = []
  let m
  while ((m = rx.exec(String(text || ''))) !== null) {
    const target = m[1].trim()
    if (target) out.push({ target, alias: (m[2] || '').trim() || null, index: m.index, raw: m[0] })
  }
  return out
}

export function extractTags(text) {
  const rx = new RegExp(TAG_SRC, 'gu')
  const out = []
  let m
  while ((m = rx.exec(String(text || ''))) !== null) {
    const tag = m[2].replace(/[/_-]+$/, '').toLowerCase()
    // Must contain a letter: "#1"/"#2024" in prose like "step #1" are not tags (same rule Obsidian uses).
    if (tag && /\p{L}/u.test(tag)) out.push(tag)
  }
  return out
}

// Every piece of free text on a recipe that can carry links/tags and should be searchable.
export function recipeText(r) {
  return [
    r.title || '',
    r.notes || '',
    ...(r.ingredients || []),
    ...(r.steps || []),
    r.notes_pad || '',
  ].join('\n')
}

// A recipe's tags = the explicit tags[] column plus any #tags written inline in its text.
export function tagsOf(r) {
  const set = new Set((r.tags || []).map((t) => String(t).toLowerCase()))
  for (const t of extractTags(recipeText(r))) set.add(t)
  return [...set]
}

// "a/b/c" -> ["a", "a/b", "a/b/c"] so a parent folder counts everything beneath it.
export function ancestorPaths(path) {
  const parts = String(path || '').split(FOLDER_SEP).map((p) => p.trim()).filter(Boolean)
  const out = []
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(0, i + 1).join(FOLDER_SEP))
  return out
}

// Same idea for nested tags: #bread/sourdough also counts under #bread.
export function tagAncestors(tag) {
  return ancestorPaths(tag)
}

function snippetAround(text, index, len = 90) {
  const start = Math.max(0, index - Math.floor(len / 2))
  const raw = text.slice(start, start + len).replace(/\s+/g, ' ').trim()
  return (start > 0 ? '…' : '') + raw + (start + len < text.length ? '…' : '')
}

/**
 * Builds every index the vault UI needs in a single pass.
 * Returns resolved/unresolved links, backlinks with context, tag and folder counts.
 */
export function buildVaultIndex(recipes) {
  const list = recipes || []
  const byId = new Map()
  const byTitle = new Map()
  for (const r of list) {
    byId.set(r.id, r)
    const key = normalizeKey(r.title)
    if (key && !byTitle.has(key)) byTitle.set(key, r)
  }

  const linksOut = new Map()      // id -> [{ target, alias, toId|null }]
  const backlinks = new Map()     // id -> [{ fromId, fromTitle, context }]
  const unresolved = new Map()    // normalized target -> { label, from: [ids] }
  const tagsById = new Map()      // id -> string[]
  const tagCounts = new Map()     // tag (incl. ancestors) -> count
  const folderCounts = new Map()  // folder path (incl. ancestors) -> count

  for (const r of list) {
    const text = recipeText(r)

    // --- links ---
    const outs = []
    for (const l of extractLinks(text)) {
      const hit = byTitle.get(normalizeKey(l.target))
      const toId = hit && hit.id !== r.id ? hit.id : null
      outs.push({ ...l, toId })
      if (toId) {
        if (!backlinks.has(toId)) backlinks.set(toId, [])
        backlinks.get(toId).push({ fromId: r.id, fromTitle: r.title, context: snippetAround(text, l.index) })
      } else if (!hit) {
        const key = normalizeKey(l.target)
        if (!unresolved.has(key)) unresolved.set(key, { label: l.target, from: [] })
        unresolved.get(key).from.push(r.id)
      }
    }
    linksOut.set(r.id, outs)

    // --- tags ---
    const tags = tagsOf(r)
    tagsById.set(r.id, tags)
    const counted = new Set()
    for (const t of tags) {
      for (const anc of tagAncestors(t)) {
        if (counted.has(anc)) continue
        counted.add(anc)
        tagCounts.set(anc, (tagCounts.get(anc) || 0) + 1)
      }
    }

    // --- folders ---
    const folder = String(r.folder || '').trim()
    if (folder) {
      for (const anc of ancestorPaths(folder)) folderCounts.set(anc, (folderCounts.get(anc) || 0) + 1)
    }
  }

  return { byId, byTitle, linksOut, backlinks, unresolved, tagsById, tagCounts, folderCounts }
}

// Nested {name, path, count, children[]} tree for the folder pane.
// `extraPaths` lets caller-created folders show up even before any recipe lives in them.
export function buildFolderTree(recipes, extraPaths = []) {
  const root = { name: '', path: '', children: new Map(), count: 0 }
  const ensure = (folder, counts) => {
    const parts = String(folder || '').split(FOLDER_SEP).map((p) => p.trim()).filter(Boolean)
    let node = root
    const acc = []
    for (const part of parts) {
      acc.push(part)
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path: acc.join(FOLDER_SEP), children: new Map(), count: 0 })
      }
      node = node.children.get(part)
      if (counts) node.count++
    }
  }
  for (const r of recipes || []) {
    const folder = String(r.folder || '').trim()
    if (folder) ensure(folder, true)
  }
  for (const p of extraPaths) ensure(p, false)
  const toArray = (node) => [...node.children.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ name: c.name, path: c.path, count: c.count, children: toArray(c) }))
  return toArray(root)
}

// Nested tag tree, same shape as the folder tree, built from the tag counts.
export function buildTagTree(tagCounts) {
  const root = { children: new Map() }
  for (const tag of [...tagCounts.keys()].sort()) {
    const parts = tag.split(FOLDER_SEP).filter(Boolean)
    let node = root
    let acc = []
    for (const part of parts) {
      acc.push(part)
      const path = acc.join(FOLDER_SEP)
      if (!node.children.has(part)) node.children.set(part, { name: part, path, children: new Map() })
      node = node.children.get(part)
    }
  }
  const toArray = (node) => [...node.children.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ name: c.name, path: c.path, count: tagCounts.get(c.path) || 0, children: toArray(c) }))
  return toArray(root)
}

/**
 * Subsequence fuzzy match, scored so that consecutive runs and word-start hits win —
 * this is what makes the quick switcher feel like Obsidian's rather than a plain substring filter.
 * Returns null when the query isn't a subsequence at all.
 */
export function fuzzyMatch(query, text) {
  const q = String(query || '').toLowerCase().trim()
  const t = String(text || '')
  const lower = t.toLowerCase()
  if (!q) return { score: 0, positions: [] }
  let score = 0
  let ti = 0
  let prevHit = -2
  const positions = []
  for (const ch of q) {
    if (ch === ' ') continue
    const found = lower.indexOf(ch, ti)
    if (found === -1) return null
    let pts = 1
    if (found === prevHit + 1) pts += 5                                   // consecutive
    if (found === 0) pts += 8                                             // matches the very start
    else if (/[\s/_\-([]/.test(t[found - 1])) pts += 6                    // start of a word
    score += pts
    positions.push(found)
    prevHit = found
    ti = found + 1
  }
  if (positions.length) {
    // Penalise how far the match is smeared across the text, so "gngr" prefers
    // "Ginger Ale" over a stray subsequence in "Galletas de Chocolate Negro".
    const span = positions[positions.length - 1] - positions[0] + 1
    score -= Math.max(0, span - positions.length) * 0.8
  }
  score -= Math.max(0, t.length - q.length) * 0.05 // prefer tighter targets
  return { score, positions }
}

export function fuzzySearch(query, items, getText, limit = 50) {
  const q = String(query || '').trim()
  if (!q) return items.slice(0, limit).map((item) => ({ item, score: 0, positions: [] }))
  const out = []
  for (const item of items) {
    const hit = fuzzyMatch(q, getText(item))
    if (hit) out.push({ item, ...hit })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}

// Full-text search across every field, returning the matching lines as snippets
// (Obsidian's search pane shows each hit in context, not just the note name).
export function searchRecipes(query, recipes, limit = 60) {
  const q = String(query || '').toLowerCase().trim()
  if (!q) return []
  const results = []
  for (const r of recipes || []) {
    const hits = []
    const push = (field, line) => {
      const idx = String(line).toLowerCase().indexOf(q)
      if (idx !== -1 && hits.length < 4) hits.push({ field, line: String(line), idx })
    }
    push('title', r.title || '')
    push('category', r.category || '')
    for (const ing of r.ingredients || []) push('ingredient', ing)
    for (const st of r.steps || []) push('step', st)
    if (r.notes) push('note', r.notes)
    if (r.notes_pad) push('note', r.notes_pad)
    for (const t of tagsOf(r)) push('tag', '#' + t)
    if (hits.length) {
      const titleHit = String(r.title || '').toLowerCase().includes(q)
      results.push({ recipe: r, hits, score: (titleHit ? 100 : 0) + hits.length })
    }
  }
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

// Splits text into plain segments and [[wikilink]] segments for rendering.
export function segmentWikilinks(text) {
  const rx = new RegExp(WIKILINK_SRC, 'g')
  const segs = []
  let last = 0
  let m
  const s = String(text || '')
  while ((m = rx.exec(s)) !== null) {
    if (m.index > last) segs.push({ type: 'text', value: s.slice(last, m.index) })
    segs.push({ type: 'link', target: m[1].trim(), label: (m[2] || m[1]).trim() })
    last = m.index + m[0].length
  }
  if (last < s.length) segs.push({ type: 'text', value: s.slice(last) })
  return segs
}
