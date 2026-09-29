// Link previews for shared recipes. A shared link — /?r=<id> for a public recipe, /?invite=<token>
// for an invite — opens the app as usual, with the recipe's title, a line about it and its photo in
// the page's head: what WhatsApp, iMessage, Slack… show, since they read the HTML without running
// the app. With &img=1 it answers the photo itself (the app keeps it in the database).
const SUPABASE = 'https://blqcppmjejtnvoqlhshp.supabase.co'
// The public (anon) key, the same one the app ships with; the database only returns what a link
// already opens (see supabase/migrations/20260929_recipe_preview.sql).
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJscWNwcG1qZWp0bnZvcWxoc2hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDc3NTIsImV4cCI6MjA5ODk4Mzc1Mn0.uxFYd7kTc7tl1v6C7e3OzBgSdlFNxx8scGrD6MzQw8U'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

async function preview(id, token) {
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) return null
  if (!id && !/^[A-Za-z0-9]{32,80}$/.test(token || '')) return null
  const res = await fetch(`${SUPABASE}/rest/v1/rpc/recipe_preview`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(id ? { p_id: id } : { p_token: token }),
  })
  if (!res.ok) return null
  const rows = await res.json()
  return rows?.[0] || null
}

const html = (page) => new Response(page, {
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' },
})

export default async (req) => {
  const url = new URL(req.url)
  const id = url.searchParams.get('r')
  const token = id ? null : url.searchParams.get('invite')
  const p = id || token ? await preview(id, token).catch(() => null) : null
  const photo = /^data:(image\/[a-z+.-]+);base64,(.+)$/is.exec(p?.thumbnail || '')

  if (url.searchParams.has('img')) {
    if (!photo) return Response.redirect(new URL('/icon-512.png', url.origin), 302)
    return new Response(Buffer.from(photo[2], 'base64'), {
      headers: { 'Content-Type': photo[1], 'Cache-Control': 'public, max-age=3600' },
    })
  }

  const page = await fetch(new URL('/index.html', url.origin)).then((r) => r.text())
  if (!p) return html(page)
  const link = `${url.origin}/?${id ? `r=${id}` : `invite=${token}`}`
  const about = [p.category, p.servings, p.owner_name && `by ${p.owner_name}`].filter(Boolean).join(' · ')
  const description = token ? `${about ? about + ' — ' : ''}shared with you on Quaderno+` : about || 'A recipe on Quaderno+'
  const image = photo
    ? `${url.origin}/.netlify/functions/share?img=1&${id ? `r=${id}` : `invite=${token}`}&v=${p.thumbnail.length}`
    : `${url.origin}/icon-512.png`
  const tags = [
    ['og:type', 'article'], ['og:site_name', 'Quaderno+'], ['og:title', p.title], ['og:description', description],
    ['og:url', link], ['og:image', image], ...(photo ? [['og:image:type', photo[1]]] : []), ['og:image:alt', p.title],
  ].map(([k, v]) => `<meta property="${k}" content="${esc(v)}" />`)
  tags.push(
    `<meta name="twitter:card" content="${photo ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(p.title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  )
  const out = page
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)} · Quaderno+</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    .replace('</head>', `    ${tags.join('\n    ')}\n  </head>`)
  return html(out)
}
