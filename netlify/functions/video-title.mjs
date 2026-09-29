// The title of a video link, for the recipe's video list: asked once from the site's public
// oEmbed service (YouTube, Vimeo, TikTok, Dailymotion, Loom), then saved with the recipe.
// Only those services are called — never the address someone pasted.
const OEMBED = [
  [/(^|\.)youtube\.com$|^youtu\.be$|(^|\.)youtube-nocookie\.com$/, (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`],
  [/(^|\.)vimeo\.com$/, (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`],
  [/(^|\.)tiktok\.com$/, (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`],
  [/(^|\.)dailymotion\.com$|^dai\.ly$/, (u) => `https://www.dailymotion.com/services/oembed?format=json&url=${encodeURIComponent(u)}`],
  [/(^|\.)loom\.com$/, (u) => `https://www.loom.com/v1/oembed?url=${encodeURIComponent(u)}`],
]

const json = (body, maxAge = 86400) => new Response(JSON.stringify(body), {
  headers: { 'Content-Type': 'application/json', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
})

export default async (req) => {
  const raw = (new URL(req.url).searchParams.get('url') || '').trim().slice(0, 500)
  let u
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) } catch (_) { return json({ title: null }, 0) }
  const host = u.hostname.replace(/^www\.|^m\./, '')
  const hit = OEMBED.find(([rx]) => rx.test(host))
  if (!hit) return json({ title: null })
  // YouTube's oEmbed does not take /shorts/ links; the same video as a watch link does.
  const shorts = /^\/shorts\/([\w-]{6,})/.exec(u.pathname)
  const link = shorts ? `https://www.youtube.com/watch?v=${shorts[1]}` : u.href
  try {
    const res = await fetch(hit[1](link), { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuadernoPlus/1.0)' }, signal: AbortSignal.timeout(6000) })
    if (!res.ok) return json({ title: null }, 3600)
    const data = await res.json()
    return json({ title: String(data.title || '').trim().slice(0, 200) || null, author: data.author_name || null })
  } catch (_) {
    return json({ title: null }, 0)
  }
}
