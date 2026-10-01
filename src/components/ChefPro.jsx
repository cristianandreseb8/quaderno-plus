import { useEffect, useRef, useState } from 'react'
import { AlarmClock, ChevronRight, X } from 'lucide-react'
import { fmtSpan, fmtWatch } from '../lib/timing.js'
import { waitOf } from '../lib/planner.js'

// The extras of chef mode Pro (Settings → Chef mode): every step at a glance, the next one, how
// long this one is taking against your usual time, long waits coming up, and the numbers that
// matter picked out in the text. (Voice commands: components/HeyChef.jsx.)

// ── The figures in a step: temperatures, times, amounts ──
const HL = /(\d+(?:[.,]\d+)?\s?(?:[-–]\s?\d+(?:[.,]\d+)?\s?)?(?:°|º)\s?[CF]?)|(\d+(?:[.,]\d+)?(?:\s?[-–]\s?\d+(?:[.,]\d+)?)?\s?(?:h|hrs?|hours?|horas?|ore|heures?|stunden?|std|min|mins|minutes?|minutos?|minuti|minuten|sec|secs|seconds?|seg|segundos?)\b)|(\d+(?:[.,]\d+)?\s?(?:g|gr|kg|ml|cl|dl|l|%)(?![\p{L}]))/giu
export function highlight(text) {
  const out = []
  let last = 0
  for (const m of String(text).matchAll(HL)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const kind = m[1] ? 'temp' : m[2] ? 'time' : 'qty'
    out.push(<mark key={m.index} className={`Q-hl ${kind}`}>{m[0]}</mark>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// ── Time on this step, against the usual; and in chef mode altogether ──
export function StepClock({ since, typical, total }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  const on = now - since
  const over = typical != null && on > typical * 1.5 && on - typical > 60000
  return (
    <div className="Q-chef-clockline">
      <span className={over ? 'over' : ''}>On this step <b>{fmtWatch(on)}</b></span>
      {typical != null && <span>usually <b>{fmtSpan(typical)}</b></span>}
      <span className="sp" />
      <span>Cooking <b>{fmtWatch(now - total)}</b></span>
    </div>
  )
}

// ── The next step, and a long wait coming up ──
export function NextUp({ steps, pos, typicalOf }) {
  const nxt = steps[pos + 1]
  const wait = steps.slice(pos + 1, pos + 5).map((s, k) => ({ s, k: pos + 2 + k, ms: waitOf(s.text) })).find((x) => x.ms >= 30 * 60000)
  if (!nxt && !wait) return null
  const t = nxt && typicalOf(nxt)
  return (
    <div className="Q-chef-next">
      {wait && (
        <div className="Q-chef-ahead"><AlarmClock size={14} /> Coming up — step {wait.k} waits <b>{fmtSpan(wait.ms)}</b>: plan the time around it.</div>
      )}
      {nxt && (
        <div className="Q-chef-nextline">
          <span className="lbl">Next</span>
          <span className="txt">{nxt.srcTitle ? `${nxt.srcTitle} · ` : ''}{nxt.text}</span>
          {t != null && <span className="t">~{fmtSpan(t)}</span>}
        </div>
      )}
    </div>
  )
}

// ── Every step at a glance: jump to any ──
export function StepsRail({ steps, pos, done, onJump, onClose, typicalOf }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.querySelector('.cur')?.scrollIntoView({ block: 'center' }) }, [pos])
  let label = null
  return (
    <aside className="Q-chef-rail" ref={ref} aria-label="All the steps">
      <div className="Q-chef-rail-head"><b>Steps</b><button className="Q-icon-btn" onClick={onClose} aria-label="Close the steps"><X size={16} /></button></div>
      <ol>
        {steps.map((s, k) => {
          const where = [s.srcTitle, s.part].filter(Boolean).join(' · ')
          const head = where && where !== label ? <li className="part" key={`h${k}`}>{where}</li> : null
          label = where || label
          const t = typicalOf(s)
          return [head, (
            <li key={k} className={`${k === pos ? 'cur' : ''}${done.has(s.i) ? ' done' : ''}`}>
              <button type="button" onClick={() => onJump(k)}>
                <span className="n">{done.has(s.i) ? '✓' : k + 1}</span>
                <span className="txt">{s.text}</span>
                {t != null && <span className="t">{fmtSpan(t)}</span>}
                {k === pos && <ChevronRight size={14} />}
              </button>
            </li>
          )]
        })}
      </ol>
    </aside>
  )
}
