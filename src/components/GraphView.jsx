import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Force-directed map of the vault: every recipe is a node, every [[wikilink]] an edge.
 * Unresolved links render as hollow "ghost" nodes so you can see what you've referenced
 * but not written yet. Simulation is plain velocity-Verlet on a canvas — with a vault of
 * a few hundred recipes the O(n²) repulsion pass is far cheaper than pulling in a lib.
 */
export default function GraphView({ recipes, index, selId, onOpen, onClose }) {
  const canvasRef = useRef(null)
  const stateRef = useRef(null)
  const [showOrphans, setShowOrphans] = useState(true)
  const [showGhosts, setShowGhosts] = useState(true)
  const [hoverLabel, setHoverLabel] = useState(null)

  const { nodes, edges } = useMemo(() => {
    const nodeList = []
    const nodeIndex = new Map()
    const add = (id, label, kind) => {
      if (nodeIndex.has(id)) return nodeIndex.get(id)
      const n = {
        id, label, kind, deg: 0,
        x: (Math.random() - 0.5) * 400,
        y: (Math.random() - 0.5) * 400,
        vx: 0, vy: 0,
      }
      nodeIndex.set(id, n)
      nodeList.push(n)
      return n
    }
    for (const r of recipes) add(r.id, r.title || 'Untitled', 'recipe')

    const edgeList = []
    for (const r of recipes) {
      for (const l of index.linksOut.get(r.id) || []) {
        if (l.toId) {
          const a = nodeIndex.get(r.id), b = nodeIndex.get(l.toId)
          if (a && b) { edgeList.push({ a, b, ghost: false }); a.deg++; b.deg++ }
        } else {
          const gid = 'ghost:' + l.target.toLowerCase()
          const g = add(gid, l.target, 'ghost')
          const a = nodeIndex.get(r.id)
          edgeList.push({ a, b: g, ghost: true }); a.deg++; g.deg++
        }
      }
    }
    return { nodes: nodeList, edges: edgeList }
  }, [recipes, index])

  const visible = useMemo(() => {
    const ok = (n) => (n.kind === 'ghost' ? showGhosts : (showOrphans || n.deg > 0))
    const vNodes = nodes.filter(ok)
    const set = new Set(vNodes.map((n) => n.id))
    return { nodes: vNodes, edges: edges.filter((e) => set.has(e.a.id) && set.has(e.b.id)) }
  }, [nodes, edges, showOrphans, showGhosts])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const view = { scale: 1, ox: 0, oy: 0 }
    let alpha = 1
    let raf = 0
    let dragNode = null
    let panning = false
    let last = { x: 0, y: 0 }
    let downAt = null
    stateRef.current = { view }

    function resize() {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      view.ox = rect.width / 2
      view.oy = rect.height / 2
    }
    resize()
    window.addEventListener('resize', resize)

    const toScreen = (n) => ({ x: n.x * view.scale + view.ox, y: n.y * view.scale + view.oy })
    const radius = (n) => (n.kind === 'ghost' ? 4 : 5 + Math.min(9, n.deg * 1.6))

    function nodeAt(px, py) {
      for (let i = visible.nodes.length - 1; i >= 0; i--) {
        const n = visible.nodes[i]
        const s = toScreen(n)
        const r = radius(n) + 5
        if ((px - s.x) ** 2 + (py - s.y) ** 2 <= r * r) return n
      }
      return null
    }

    function step() {
      const ns = visible.nodes
      // repulsion
      for (let i = 0; i < ns.length; i++) {
        const a = ns[i]
        for (let j = i + 1; j < ns.length; j++) {
          const b = ns[j]
          let dx = b.x - a.x, dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.01 }
          const d = Math.sqrt(d2)
          const f = 1600 / d2
          const fx = (dx / d) * f, fy = (dy / d) * f
          a.vx -= fx; a.vy -= fy
          b.vx += fx; b.vy += fy
        }
      }
      // springs
      for (const e of visible.edges) {
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y
        const d = Math.hypot(dx, dy) || 0.01
        const f = (d - 90) * 0.02
        const fx = (dx / d) * f, fy = (dy / d) * f
        e.a.vx += fx; e.a.vy += fy
        e.b.vx -= fx; e.b.vy -= fy
      }
      // gravity toward origin + integrate
      for (const n of ns) {
        n.vx -= n.x * 0.006
        n.vy -= n.y * 0.006
        if (n === dragNode) { n.vx = 0; n.vy = 0; continue }
        n.vx *= 0.82; n.vy *= 0.82
        n.x += n.vx * alpha
        n.y += n.vy * alpha
      }
      alpha = Math.max(0.12, alpha * 0.995)
    }

    function draw() {
      const rect = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, rect.width, rect.height)
      ctx.lineWidth = 1
      for (const e of visible.edges) {
        const A = toScreen(e.a), B = toScreen(e.b)
        ctx.strokeStyle = e.ghost ? 'rgba(110,100,92,.22)' : 'rgba(31,58,77,.30)'
        if (e.ghost) ctx.setLineDash([3, 3]); else ctx.setLineDash([])
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
      }
      ctx.setLineDash([])
      for (const n of visible.nodes) {
        const s = toScreen(n)
        const r = radius(n)
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        if (n.kind === 'ghost') {
          ctx.fillStyle = '#FFFFFF'; ctx.fill()
          ctx.strokeStyle = '#B9AFA2'; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([])
        } else {
          ctx.fillStyle = n.id === selId ? '#BC6C2C' : '#1F3A4D'
          ctx.fill()
        }
        if (view.scale > 0.55 || n.id === selId) {
          ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
          ctx.fillStyle = n.kind === 'ghost' ? '#8A8075' : '#221C18'
          ctx.textAlign = 'center'
          const label = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label
          ctx.fillText(label, s.x, s.y + r + 12)
        }
      }
    }

    function loop() { step(); draw(); raf = requestAnimationFrame(loop) }
    loop()

    function pos(e) {
      const rect = canvas.getBoundingClientRect()
      const t = e.touches ? e.touches[0] : e
      return { x: t.clientX - rect.left, y: t.clientY - rect.top }
    }
    function onDown(e) {
      const p = pos(e)
      downAt = { ...p, t: Date.now() }
      const hit = nodeAt(p.x, p.y)
      if (hit) { dragNode = hit; alpha = Math.max(alpha, 0.7) } else { panning = true }
      last = p
    }
    function onMove(e) {
      const p = pos(e)
      if (dragNode) {
        dragNode.x = (p.x - view.ox) / view.scale
        dragNode.y = (p.y - view.oy) / view.scale
        alpha = Math.max(alpha, 0.5)
      } else if (panning) {
        view.ox += p.x - last.x
        view.oy += p.y - last.y
      } else {
        const hit = nodeAt(p.x, p.y)
        canvas.style.cursor = hit ? 'pointer' : 'grab'
        setHoverLabel(hit ? hit.label + (hit.kind === 'ghost' ? '  (not created yet)' : '') : null)
      }
      last = p
    }
    function onUp(e) {
      // A press that neither moved nor lingered is a click: open that recipe.
      if (downAt && Date.now() - downAt.t < 350) {
        const p = pos(e.changedTouches ? { touches: e.changedTouches } : e) || last
        const moved = Math.hypot((p.x || last.x) - downAt.x, (p.y || last.y) - downAt.y)
        if (moved < 5) {
          const hit = nodeAt(downAt.x, downAt.y)
          if (hit && hit.kind === 'recipe') { onOpen(hit.id); onClose() }
        }
      }
      dragNode = null; panning = false; downAt = null
    }
    function onWheel(e) {
      e.preventDefault()
      const p = pos(e)
      const k = Math.exp(-e.deltaY * 0.0015)
      const ns = Math.min(3, Math.max(0.15, view.scale * k))
      view.ox = p.x - (p.x - view.ox) * (ns / view.scale)
      view.oy = p.y - (p.y - view.oy) * (ns / view.scale)
      view.scale = ns
    }

    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('touchstart', onDown, { passive: true })
    canvas.addEventListener('touchmove', onMove, { passive: true })
    canvas.addEventListener('touchend', onUp)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('touchstart', onDown)
      canvas.removeEventListener('touchmove', onMove)
      canvas.removeEventListener('touchend', onUp)
    }
  }, [visible, selId, onOpen, onClose])

  const linked = visible.edges.filter((e) => !e.ghost).length

  return (
    <div className="V-graph-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="V-graph">
        <div className="V-graph-head">
          <span className="V-graph-title">🕸 Graph view</span>
          <span className="V-graph-stats">{visible.nodes.length} nodes · {linked} links</span>
          <label className="V-graph-opt"><input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} /> Orphans</label>
          <label className="V-graph-opt"><input type="checkbox" checked={showGhosts} onChange={(e) => setShowGhosts(e.target.checked)} /> Unresolved</label>
          <button className="btn ghost xs" onClick={onClose}>✕ Close</button>
        </div>
        <div className="V-graph-canvas-wrap">
          <canvas ref={canvasRef} className="V-graph-canvas" />
          {hoverLabel && <div className="V-graph-hover">{hoverLabel}</div>}
          {!visible.nodes.length && (
            <div className="V-graph-empty">
              Nothing to plot yet. Link recipes with <code>[[Recipe name]]</code> in their notes or steps.
            </div>
          )}
        </div>
        <div className="V-graph-foot">Drag to pan · scroll to zoom · drag a node to move it · click a node to open it</div>
      </div>
    </div>
  )
}
