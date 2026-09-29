import { useEffect, useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { isVideoSection, looksLikeLink, newVideo, newVideoSection, parseVideo } from '../lib/video.js'
import { toast } from './ui/Toaster.jsx'

function Player({ video }) {
  const v = parseVideo(video.url)
  if (!v) return null
  if (v.file) return <video className="Q-video-file" src={v.file} controls preload="metadata" />
  if (!v.embed) {
    return (
      <a className="Q-video-link" href={v.url} target="_blank" rel="noopener noreferrer">
        <span>{v.provider}</span><ExternalLink size={14} />
      </a>
    )
  }
  return (
    <div className={`Q-video-frame${v.vertical ? ' vertical' : ''}`}>
      <iframe
        src={v.embed} title={`${v.provider} video`} loading="lazy" allowFullScreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}

// Videos kept with a recipe — YouTube, Vimeo, Instagram, TikTok, … played right in the page, under
// titles when they are grouped ("Shaping", "Baking"). Typing a title instead of a link starts one.
export default function VideoBlock({ videos, onChange, adding, onAddingDone }) {
  const [url, setUrl] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])
  const isTitle = url.trim() && !looksLikeLink(url)

  function add() {
    const text = url.trim()
    if (!text) return
    if (isTitle) {
      onChange([...(videos || []), newVideoSection(text)])
    } else {
      if (!parseVideo(text)) { toast.error('That does not look like a link.'); return }
      onChange([...(videos || []), newVideo(text)])
    }
    setUrl(''); onAddingDone?.()
  }

  return (
    <div className="Q-videos">
      {(videos || []).map((v) => (isVideoSection(v) ? (
        <div key={v.id} className="Q-sec-h Q-video-sec">
          <span>{v.section}</span>
          {onChange && <button className="Q-video-sec-rm" onClick={() => onChange(videos.filter((x) => x.id !== v.id))} aria-label={`Remove the title ${v.section}`} title="Remove this title (the videos stay)"><X size={13} /></button>}
        </div>
      ) : (
        <div key={v.id} className="Q-video">
          <Player video={v} />
          {onChange && <button className="Q-video-rm" onClick={() => { if (window.confirm('Remove this video from the recipe?')) onChange(videos.filter((x) => x.id !== v.id)) }} aria-label="Remove video"><X size={14} /></button>}
        </div>
      )))}
      {onChange && (adding || !(videos || []).length) && (
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
