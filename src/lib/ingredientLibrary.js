import { supabase } from './supabase.js'

export async function libLoad() {
  try {
    const { data, error } = await supabase.from('ingredient_library').select('*').order('name')
    if (error) throw error
    return data || []
  } catch (e) {
    console.error('libLoad:', e)
    return []
  }
}

export async function libUpsert(item) {
  try {
    const now = new Date().toISOString()
    if (item.id) {
      const { error } = await supabase.from('ingredient_library').update({ ...item, updated_at: now }).eq('id', item.id)
      if (error) throw error
    } else {
      const { data, error } = await supabase.from('ingredient_library').insert({ ...item, updated_at: now }).select()
      if (error) throw error
      return data && data[0]
    }
  } catch (e) {
    console.error('libUpsert:', e)
  }
}

export async function libDelete(id) {
  try {
    const { error } = await supabase.from('ingredient_library').delete().eq('id', id)
    if (error) throw error
  } catch (e) {
    console.error('libDelete:', e)
  }
}

export function libFindMatch(name, libData) {
  if (!libData || !libData.length) return null
  const nm = (name || '').toLowerCase().trim()
  return libData.find((lib) => {
    const cn = (lib.canonical_name || '').toLowerCase()
    const ln = (lib.name || '').toLowerCase()
    if (nm === cn || nm === ln) return true
    if (nm.length > 3 && (cn.includes(nm) || nm.includes(cn))) return true
    if (nm.length > 3 && (ln.includes(nm) || nm.includes(ln))) return true
    const aliases = lib.aliases || []
    return aliases.some((a) => { const al = a.toLowerCase(); return nm === al || (nm.length > 3 && (al.includes(nm) || nm.includes(al))) })
  })
}
