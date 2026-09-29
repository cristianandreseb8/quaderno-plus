import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Play, X } from 'lucide-react'
import { isVideoSection, looksLikeLink, newVideo, newVideoSection, parseVideo } from '../lib/video.js'
import { toast } from './ui/Toaster.jsx'

function Player({ video }) {
  const v = parseVideo(video.url)
  if (!v) return null
  if (v.file) return <video className="Q-video-file" src={v.file} controls autoPlay preload="metadata" />
  if (!v.embed) {
    return (
      <a className="Q-video-link" href={v.url} target="_blank" rel="noopener noreferrer">
        <span>{v.provider}</span><ExternalLink size={14} />
      </a>
    )
  }
  // Opened with a tap on its title, so it starts playing (where the browser allows it).
  const src = /YouTube|Vimeo|Dailymotion|Loom/.test(v.provider) ? `${v.embed}${v.embed.includes('?') ? '&' : '?'}autoplay=1` : v.embed
  return (
    <div className={`Q-video-frame${v.vertical ? ' vertical' : ''}`}>
      <iframe
        src={src} title={`${v.provider} video`} loading="lazy" allowFullScreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}

// Video titles, asked once per link from the sites' public oEmbed (netlify/functions/video-title)
// and kept on the device; a recipe that can be edited keeps them in its videos too.
const TITLES = 'qdplus_video_titles'
const readTitles = () => { try { return JSON.parse(localStorage.getItem(TITLES) || '{}') } catch (_) { return {} } }
const tried = new Set()
function useVideoTitles(videos, onChange) {
  const [titles, setTitles] = useState(readTitles)
  useEffect(() => {
    const missing = (videos || []).filter((v) => v.url && !v.title && !titles[v.url] && !tried.has(v.url))
    if (!missing.length) return undefined
    missing.forEach((v) => tried.add(v.url))
    let live = true
    Promise.all(missing.map((v) => fetch(`/.netlify/functions/video-title?url=${encodeURIComponent(v.url)}`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => [v.url, j?.title || ''])))
      .then((pairs) => {
        const found = pairs.filter(([, t]) => t)
        if (!found.length) return
        const next = { ...readTitles(), ...Object.fromEntries(found) }
        try { localStorage.setItem(TITLES, JSON.stringify(next)) } catch (_) { /* storage full */ }
        if (live) setTitles(next)
        if (onChange) onChange((videos || []).map((v) => (v.url && !v.title && next[v.url] ? { ...v, title: next[v.url] } : v)))
      })
    return () => { live = false }
  }, [videos])
  return titles
}

// Videos kept with a recipe, kept small: one sliding row with just their titles (under the titles
// of their groups, "Shaping", "Baking"); tapping one opens its player below, tapping again closes it.
export default function VideoBlock({ videos, onChange, adding, onAddingDone }) {
  const list = videos || []
  const [url, setUrl] = useState('')
  const [open, setOpen] = useState(null) // id of the video playing
  const [more, setMore] = useState(false) // the row goes on past the right edge
  const inputRef = useRef(null)
  const rowRef = useRef(null)
  const titles = useVideoTitles(list, onChange)
  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  // Fade the right edge only while there is more of the row to slide to.
  useEffect(() => {
    const el = rowRef.current
    if (!el) return undefined
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
    check()
    el.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { el.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [list.length, titles])

  const isTitle = url.trim() && !looksLikeLink(url)
  const perProvider = {}
  const titleOf = (v) => {
    if (v.title || titles[v.url]) return v.title || titles[v.url]
    const provider = parseVideo(v.url)?.provider || 'Video'
    perProvider[provider] = (perProvider[provider] || 0) + 1
    return `${provider} video${perProvider[provider] > 1 ? ` ${perProvider[provider]}` : ''}`
  }
  const labels = Object.fromEntries(list.filter((v) => v.url).map((v) => [v.id, titleOf(v)]))
  const playing = list.find((v) => v.id === open && v.url)

  function add() {
    const text = url.trim()
    if (!text) return
    if (isTitle) {
      onChange([...list, newVideoSection(text)])
    } else {
      if (!parseVideo(text)) { toast.error('That does not look like a link.'); return }
      onChange([...list, newVideo(text)])
    }
    setUrl(''); onAddingDone?.()
  }
  function rename(v) {
    const t = window.prompt('Video title', labels[v.id])
    if (t == null) return
    onChange(list.map((x) => (x.id === v.id ? { ...x, title: t.trim() || undefined } : x)))
  }
  function remove(v) {
    if (!window.confirm(`Remove “${labels[v.id]}” from the recipe?`)) return
    setOpen(null)
    onChange(list.filter((x) => x.id !== v.id))
  }

  return (
    <div className="Q-videos">
      {list.length > 0 && (
        <div className={`Q-vslider${more ? ' more' : ''}`} ref={rowRef}>
          {list.map((v) => (isVideoSection(v) ? (
            <span key={v.id} className="Q-vslider-sec">
              {v.section}
              {onChange && <button onClick={() => onChange(list.filter((x) => x.id !== v.id))} aria-label={`Remove the title ${v.section}`} title="Remove this title (the videos stay)"><X size={11} /></button>}
            </span>
          ) : (
            <button
              key={v.id} type="button" className={`Q-vchip${open === v.id ? ' on' : ''}`}
              onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id} title={labels[v.id]}
            >
              <Play size={12} /><span>{labels[v.id]}</span>
            </button>
          )))}
        </div>
      )}
      {playing && (
        <div className="Q-vopen">
          <Player key={playing.id} video={playing} />
          <div className="Q-vopen-bar">
            <span className="t">{labels[playing.id]}</span>
            <a className="Q-link" href={playing.url} target="_blank" rel="noopener noreferrer">Open <ExternalLink size={12} /></a>
            {onChange && <button className="Q-link" onClick={() => rename(playing)}>Rename</button>}
            {onChange && <button className="Q-link danger" onClick={() => remove(playing)}>Remove</button>}
            <button className="Q-icon-btn" onClick={() => setOpen(null)} aria-label="Close the video"><X size={15} /></button>
          </div>
        </div>
      )}
      {onChange && (adding || !list.length) && (
        <div className="Q-video-add">
          <input
            ref={inputRef} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a video link — or type a title to group the next ones"
            onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setUrl(''); onAddingDone?.() } }}
          />
          <button className="btn primary sm" onClick={add} disabled={!url.trim()}>{isTitle ? 'Add title' : 'Add'}</button>
        </div>
      )}
    </div>
  )
}
