// Turn a pasted video link into something the recipe can play inline. Unknown sites still
// get a tidy "open" card, so any link can be kept with the recipe.

function seconds(t) {
  if (!t) return 0
  if (/^\d+$/.test(t)) return Number(t)
  const m = String(t).match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/)
  return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0
}

export function parseVideo(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  let u
  try { u = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text) } catch (_) { return null }
  const host = u.hostname.replace(/^www\.|^m\./, '')
  const path = u.pathname

  if (host === 'youtu.be' || host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
    let id = host === 'youtu.be' ? path.slice(1) : u.searchParams.get('v')
    const m = path.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/)
    if (!id && m) id = m[1]
    id = (id || '').split(/[/?&]/)[0]
    if (!id) return null
    const start = seconds(u.searchParams.get('t') || u.searchParams.get('start'))
    return { provider: 'YouTube', embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0${start ? `&start=${start}` : ''}`, vertical: path.startsWith('/shorts/'), url: text }
  }
  if (host.endsWith('vimeo.com')) {
    const id = path.match(/(\d{5,})/)?.[1]
    return id ? { provider: 'Vimeo', embed: `https://player.vimeo.com/video/${id}`, vertical: false, url: text } : null
  }
  if (host.endsWith('instagram.com')) {
    const m = path.match(/^\/(p|reel|reels|tv)\/([\w-]+)/)
    return m ? { provider: 'Instagram', embed: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed`, vertical: true, url: text } : null
  }
  if (host.endsWith('tiktok.com')) {
    const id = path.match(/\/video\/(\d+)/)?.[1]
    return id ? { provider: 'TikTok', embed: `https://www.tiktok.com/embed/v2/${id}`, vertical: true, url: text } : { provider: 'TikTok', embed: null, url: text }
  }
  if (host.endsWith('facebook.com') || host === 'fb.watch') {
    return { provider: 'Facebook', embed: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(text)}&show_text=false`, vertical: false, url: text }
  }
  if (host.endsWith('dailymotion.com') || host === 'dai.ly') {
    const id = host === 'dai.ly' ? path.slice(1) : path.match(/\/video\/([\w]+)/)?.[1]
    return id ? { provider: 'Dailymotion', embed: `https://www.dailymotion.com/embed/video/${id}`, vertical: false, url: text } : null
  }
  if (host.endsWith('loom.com')) {
    const id = path.match(/\/(?:share|embed)\/([\w]+)/)?.[1]
    return id ? { provider: 'Loom', embed: `https://www.loom.com/embed/${id}`, vertical: false, url: text } : null
  }
  if (/\.(mp4|webm|mov|m4v|ogg)$/i.test(path)) return { provider: 'Video', file: u.href, vertical: false, url: text }
  return { provider: host, embed: null, url: text }
}

export const newVideo = (url) => ({ id: Math.random().toString(36).slice(2, 10), url: String(url).trim() })

// Videos can be grouped under titles, like the parts of a recipe: a { section } entry heads the
// videos after it. As editor lines: a link per row, "## Title" for a section.
export const newVideoSection = (title) => ({ id: Math.random().toString(36).slice(2, 10), section: String(title).trim() })
export const isVideoSection = (v) => !!v && !v.url && typeof v.section === 'string'
// A link (with or without https://), not a title someone typed.
export const looksLikeLink = (text) => /^https?:\/\//i.test(String(text).trim()) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(String(text).trim())
export const videosToLines = (videos) => (videos || []).map((v) => (isVideoSection(v) ? `## ${v.section}` : v.url))
export function linesToVideos(lines, before = []) {
  return (lines || []).map((l) => String(l).trim()).filter((l) => l && l !== '##').map((l) => {
    // A row that is not a link is a title too ("Shaping" as much as "## Shaping").
    const title = /^##?\s+/.test(l) ? l.replace(/^##?\s*/, '') : looksLikeLink(l) ? null : l
    if (title != null) return (before || []).find((v) => isVideoSection(v) && v.section === title) || newVideoSection(title)
    return (before || []).find((v) => v.url === l) || newVideo(l)
  })
}
