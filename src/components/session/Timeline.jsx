import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronUp, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { LANES, clock } from './useSessionPlan.js'

const HOUR = 3600000
const LEVELS = [2, 3, 5, 8, 12, 18, 28, 44, 70, 110, 170, 260] // pixels per hour
const ZOOM = 'qdplus_tl_zoom'
const TICKS = [1, 2, 3, 4, 6, 12, 24]
const short = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s }
const span = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` }

// Every recipe on one horizontal line of time, from now: hands-on work solid, waits light, time
// the food would wait for you hatched, and your sleep and off-shift hours shaded. Zoom out for the
// whole picture (Fit), in for the detail; scroll sideways. A step opens its task.
export default function Timeline({ entries, plan, now, onPick, onHide }) {
  const scroller = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const [zoom, setZoomState] = useState(() => { try { const z = localStorage.getItem(ZOOM); return z && z !== 'fit' ? +z : 'fit' } catch (_) { return 'fit' } })
  const setZoom = (z) => { setZoomState(z); try { localStorage.setItem(ZOOM, String(z)) } catch (_) { /* ignore */ } }

  const NAME = width && width < 520 ? 78 : 124
  const total = Math.max(plan.total, 2 * HOUR)
  const fitPph = width ? Math.max(0.5, (width - NAME - 14) / (total / HOUR)) : 20
  const pph = zoom === 'fit' ? fitPph : zoom
  const zoomIn = () => setZoom(LEVELS.find((l) => l > pph * 1.05) ?? LEVELS[LEVELS.length - 1])
  const zoomOut = () => { const l = [...LEVELS].reverse().find((x) => x < pph / 1.05); setZoom(l == null || l <= fitPph * 1.02 ? 'fit' : l) }
  // Ctrl + wheel (a pinch on a trackpad) zooms too.
  const zoomRef = useRef({})
  zoomRef.current = { zoomIn, zoomOut }
  useEffect(() => {
    const el = scroller.current
    if (!el) return undefined
    const on = (e) => { if (!e.ctrlKey) return; e.preventDefault(); if (e.deltaY < 0) zoomRef.current.zoomIn(); else zoomRef.current.zoomOut() }
    el.addEventListener('wheel', on, { passive: false })
    return () => el.removeEventListener('wheel', on)
  }, [])

  const x = (ms) => (ms / HOUR) * pph
  const trackW = x(total) + 14
  // Hour marks far enough apart to read; midnight shows the day.
  const every = TICKS.find((h) => h * pph >= 52) ?? 24
  const ticks = []
  const first = new Date(now); first.setMinutes(0, 0, 0)
  for (let t = first.getTime() + HOUR; t <= now + total; t += HOUR) {
    const d = new Date(t)
    if (d.getHours() === 0) ticks.push({ at: t - now, label: d.toLocaleDateString([], { weekday: 'short', day: 'numeric' }), day: true })
    else if (d.getHours() % every === 0) ticks.push({ at: t - now, label: clock(t) })
  }
  const clip = (xs) => xs.filter(([s]) => s < total).map(([s, e]) => [s, Math.min(e, total)])
  const sleep = clip(plan.bands?.sleep || [])
  const off = clip(plan.bands?.off || [])

  return (
    <section className="Q-tl" aria-label="Timeline">
      <div className="Q-tl-bar">
        <b>Timeline</b>
        <span className="range">now → {plan.total > 0 ? `${new Date(now + plan.total).toLocaleDateString([], { weekday: 'short' })} ${clock(now + plan.total)}` : 'done'}</span>
        <span className="sp" />
        <span className="Q-tl-legend" aria-hidden="true"><i className="work" />work<i className="wait" />waiting{sleep.length + off.length > 0 && <><i className="rest" />asleep · off</>}</span>
        <button type="button" className="Q-icon-btn" onClick={zoomOut} title="Zoom out" aria-label="Zoom out"><ZoomOut size={16} /></button>
        <button type="button" className="Q-icon-btn" onClick={zoomIn} title="Zoom in" aria-label="Zoom in"><ZoomIn size={16} /></button>
        <button type="button" className={`Q-icon-btn${zoom === 'fit' ? ' on' : ''}`} onClick={() => setZoom('fit')} title="Everything at once" aria-label="Fit everything" aria-pressed={zoom === 'fit'}><Maximize2 size={15} /></button>
        <button type="button" className="Q-icon-btn" onClick={onHide} title="Hide the timeline" aria-label="Hide the timeline"><ChevronUp size={16} /></button>
      </div>
      <div className="Q-tl-scroll" ref={scroller}>
        <div className="Q-tl-inner" style={{ width: NAME + trackW, '--name-w': `${NAME}px` }}>
          <div className="Q-tl-axis" style={{ width: trackW }}>
            <span className="now">Now</span>
            {ticks.filter((t) => x(t.at) >= 44).map((t) => <span key={t.at} className={t.day ? 'day' : ''} style={{ left: x(t.at) }}>{t.label}</span>)}
          </div>
          <div className="Q-tl-rows">
            <div className="Q-tl-bands" aria-hidden="true" style={{ width: trackW }}>
              {off.map(([s, e]) => <i key={`o${s}`} className="off" style={{ left: x(s), width: Math.max(1, x(e - s)) }} />)}
              {sleep.map(([s, e]) => <i key={`s${s}`} className="sleep" style={{ left: x(s), width: Math.max(1, x(e - s)) }} />)}
              {ticks.filter((t) => t.day).map((t) => <i key={`d${t.at}`} className="midnight" style={{ left: x(t.at) }} />)}
            </div>
            {entries.map((e, ri) => (
              <div key={e.raw.id} className="Q-tl-row" style={{ '--lane': LANES[ri % LANES.length] }}>
                <div className="Q-tl-name" title={e.raw.title}>{e.raw.title}</div>
                <div className="Q-tl-track" style={{ width: trackW }}>
                  {plan.items.filter((it) => it.ri === ri).map((it) => {
                    const w = x(it.end - it.start)
                    const work = x(it.workEnd - it.start)
                    return [
                      it.sat > 0 && <i key={`sat${it.key}`} className="Q-tl-sat" style={{ left: x(it.start - it.sat), width: x(it.sat) }} title={`Waits ${span(it.sat)} for you`} />,
                      <button
                        key={String(it.key)} type="button" className={`Q-tl-step${it.wait ? ' has-wait' : ''}`} style={{ left: x(it.start), width: Math.max(3, w) }}
                        onClick={() => onPick(it.rid, it.key)}
                        title={`${it.n}. ${it.text}\n${clock(now + it.start)} · ${span(it.workEnd - it.start)} hands-on${it.wait ? ` + ${span(it.wait)} waiting` : ''}${it.sat ? `\nWaits ${span(it.sat)} for you before it` : ''}`}
                        aria-label={`${e.raw.title}, step ${it.n} at ${clock(now + it.start)}: ${it.text}`}
                      >
                        <i className="work" style={{ width: Math.max(2, Math.min(w, work)) }} />
                        {w >= 16 && <span className="lbl">{it.n}{w >= 70 ? ` ${short(it.text, Math.floor(w / 7))}` : ''}</span>}
                      </button>,
                    ]
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
