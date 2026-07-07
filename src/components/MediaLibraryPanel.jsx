import { useEffect, useRef, useState } from 'react'
import { uid } from '../lib/recipeCalc.js'
import { compressImage, parseMediaLibrary, readFileAsBase64 } from '../lib/media.js'
import { MAX_AUDIO_BYTES, MAX_VIDEO_CAP } from '../lib/constants.js'

export default function MediaLibraryPanel({ recipeId, mediaRaw, onSave }) {
  const [items, setItems] = useState(() => parseMediaLibrary(mediaRaw))
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const [player, setPlayer] = useState(null) // {type,src,name}
  const fileRef = useRef(null)

  useEffect(() => { setItems(parseMediaLibrary(mediaRaw)) }, [recipeId])

  async function handleFiles(files) {
    setErr(''); setUploading(true)
    try {
      const newItems = []
      for (const f of Array.from(files)) {
        const isImg = f.type.startsWith('image/')
        const isAudio = f.type.startsWith('audio/')
        const isVideo = f.type.startsWith('video/')
        if (!isImg && !isAudio && !isVideo) { setErr('Only images, audio, and video supported.'); continue }
        if (isAudio && f.size > MAX_AUDIO_BYTES) { setErr(`Audio max ~2 min (file too large: ${(f.size / 1024 / 1024).toFixed(1)}MB)`); continue }
        if (isVideo && f.size > MAX_VIDEO_CAP) { setErr(`Video max 30 MB. Please compress before uploading.`); continue }
        if (isImg) {
          const compressed = await compressImage(f, 1200, 0.8)
          newItems.push({ id: uid(), type: 'image', src: compressed.url, name: f.name, date: new Date().toISOString() })
        } else {
          const b64 = await readFileAsBase64(f)
          newItems.push({ id: uid(), type: isAudio ? 'audio' : 'video', src: b64, name: f.name, date: new Date().toISOString(), mime: f.type })
        }
      }
      const updated = [...items, ...newItems]
      setItems(updated)
      await onSave(JSON.stringify(updated))
    } catch (e) {
      setErr('Upload failed: ' + e.message)
    } finally {
      setUploading(false)
    }
  }

  async function remove(id) {
    const updated = items.filter((i) => i.id !== id)
    setItems(updated)
    await onSave(JSON.stringify(updated))
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.18em', color: 'var(--navy)' }}>
          Media Library — {items.length} file{items.length !== 1 ? 's' : ''}
        </span>
        <label className="Q-media-upload-btn">
          {uploading ? 'Uploading…' : '＋ Add media'}
          <input ref={fileRef} type="file" multiple accept="image/*,audio/*,video/*" style={{ display: 'none' }} disabled={uploading} onChange={(e) => handleFiles(e.target.files)} />
        </label>
      </div>
      {err && <div className="Q-err" style={{ marginBottom: 8 }}>{err}</div>}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
        Photos · Audio ≤ 2 min · Video ≤ 30 MB (3 min approx)
      </div>
      {items.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '32px 0', fontSize: 13 }}>No media yet. Add photos, audio recordings, or videos.</div>}
      <div className="Q-media-grid">
        {items.map((item) => (
          <div key={item.id} className="Q-media-card" onClick={() => item.type !== 'image' && setPlayer(item)}>
            {item.type === 'image' && <img src={item.src} className="Q-media-thumb" alt={item.name} onClick={() => setPlayer(item)} />}
            {item.type === 'audio' && <div className="Q-media-audio"><span style={{ fontSize: 24 }}>🎙</span><span style={{ fontSize: 10, color: 'var(--muted)' }}>Audio</span></div>}
            {item.type === 'video' && <div className="Q-media-video"><span style={{ fontSize: 24 }}>🎬</span><span style={{ fontSize: 10 }}>Video</span></div>}
            <div className="Q-media-label">{item.name.length > 16 ? item.name.slice(0, 13) + '…' : item.name}</div>
            <button className="Q-media-rm" onClick={(e) => { e.stopPropagation(); remove(item.id) }}>×</button>
          </div>
        ))}
      </div>
      {player && (
        <div className="Q-media-player-wrap" onClick={() => setPlayer(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {player.type === 'image' && <img src={player.src} style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 8 }} alt="" />}
            {player.type === 'audio' && <audio controls autoPlay src={player.src} />}
            {player.type === 'video' && <video controls autoPlay style={{ maxWidth: '90vw', maxHeight: '80vh' }} src={player.src} />}
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'rgba(255,255,255,.7)' }}>{player.name}</div>
            <button className="btn ghost xs" onClick={() => setPlayer(null)}>✕ Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
