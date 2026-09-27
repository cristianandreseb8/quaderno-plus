import { useEffect, useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { newVideo, parseVideo } from '../lib/video.js'
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

// Videos kept with a recipe — YouTube, Vimeo, Instagram, TikTok, … played right in the page.
export default function VideoBlock({ videos, onChange, adding, onAddingDone }) {
  const [url, setUrl] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  function add() {
    const v = parseVideo(url)
    if (!v) { toast.error('That does not look like a link.'); return }
    onChange([...(videos || []), newVideo(url)])
    setUrl(''); onAddingDone?.()
  }

  return (
    <div className="Q-videos">
      {(videos || []).map((v) => (
        <div key={v.id} className="Q-video">
          <Player video={v} />
          <button className="Q-video-rm" onClick={() => { if (window.confirm('Remove this video from the recipe?')) onChange(videos.filter((x) => x.id !== v.id)) }} aria-label="Remove video"><X size={14} /></button>
        </div>
      ))}
      {(adding || !(videos || []).length) && (
        <div className="Q-video-add">
          <input
            ref={inputRef} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube, Vimeo, Instagram or TikTok link"
            onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setUrl(''); onAddingDone?.() } }}
          />
          <button className="btn primary sm" onClick={add} disabled={!url.trim()}>Add</button>
        </div>
      )}
    </div>
  )
}
