import { supabase } from './supabase.js'

// Small key/value store for app-level state that isn't a recipe: the home page cover
// media and the list of folders the user created (a folder with no recipes in it yet
// can't be derived from the recipes themselves, so it has to be stored).

export const KEY_HOME_MEDIA = 'home_media'
export const KEY_FOLDERS = 'folders'

export async function loadSettings() {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value')
    if (error) throw error
    const out = {}
    for (const row of data || []) out[row.key] = row.value
    return out
  } catch (e) {
    console.error('loadSettings:', e)
    return {}
  }
}

export async function saveSetting(key, value) {
  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) throw error
    return true
  } catch (e) {
    console.error('saveSetting:', e)
    return false
  }
}

/**
 * Turns whatever the user pasted into something embeddable.
 * YouTube/Vimeo links become iframe embeds; direct media files play/render natively.
 */
export function resolveMedia(rawUrl) {
  const url = String(rawUrl || '').trim()
  if (!url) return null

  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/)
  if (yt) return { kind: 'embed', src: `https://www.youtube.com/embed/${yt[1]}` }

  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vimeo) return { kind: 'embed', src: `https://player.vimeo.com/video/${vimeo[1]}` }

  if (/\.(mp4|webm|ogv|mov)(\?|$)/i.test(url)) return { kind: 'video', src: url }
  if (/^data:image\//i.test(url) || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(url)) return { kind: 'image', src: url }

  // Unknown URL: assume it's an image (covers CDN links without a file extension).
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return { kind: 'image', src: url }
  return null
}
