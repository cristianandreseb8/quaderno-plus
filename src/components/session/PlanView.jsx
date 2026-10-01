import { useEffect, useMemo, useState } from 'react'
import { Pause, Play, RotateCcw, Timer as TimerIcon } from 'lucide-react'
import { planSession } from '../../lib/planner.js'
import { clockElapsed, clockRunning, fmtSpan, fmtWatch, useStepStats } from '../../lib/timing.js'
import { clockPause, clockReset, clockResume, clockStart } from '../../lib/session.js'

// Time from the start of the plan, as h:mm ("0:06", "17:02").
const hm = (ms) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` }

// The session as one plan: its clock, a timeline of every recipe's steps — hands-on work and the
// waits that run by themselves — and what to start when. Times are the ones learned from your own
// cooking where there are any, the ones written in the steps otherwise.
export default function PlanView({ session, recipesById, library, change, onOpenReport }) {
  const entries = (session?.recipes || []).map((e) => ({ recipe: recipesById.get(e.id), factor: e.factor })).filter((e) => e.recipe)
  const stats = useStepStats(entries.map((e) => e.recipe.id).concat(library.map((r) => r.id)).slice(0, 400))
  const plan = useMemo(() => planSession(entries, library, stats), [entries.map((e) => e.recipe.id + e.recipe.updated_at).join(','), stats, library])
  const [now, setNow] = useState(Date.now())
  const running = clockRunning(session?.clock)
  useEffect(() => { if (!running) return undefined; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [running])
  const elapsed = clockElapsed(session?.clock, now)
  const learnedCount = plan.items.filter((it) => it.learned).length

  const scale = plan.total > 0 ? 100 / plan.total : 0
  const hours = Math.ceil(plan.total / 3600000)
  const tickEvery = plan.total > 6 * 3600000 ? 2 : 1
  return (
    <div className="Q-plan">
      <div className="Q-sess-head">
        <div>
          <h1>Plan</h1>
          <p>{entries.length ? `${fmtSpan(plan.total)} in all · ${fmtSpan(plan.sequential)} one after another` : 'Add recipes to the session to plan them'}</p>
        </div>
        <div className="Q-textbtns"><button onClick={onOpenReport}>Time report</button></div>
      </div>

      <div className="Q-plan-clock">
        <TimerIcon size={16} />
        <b>{fmtWatch(elapsed)}</b>
        <span>{!session?.clock?.start ? 'Session clock' : running ? 'cooking' : session.clock.end ? 'finished' : 'paused'}</span>
        <span className="sp" />
        {!session?.clock?.start && <button className="btn primary sm" onClick={() => change(clockStart())}><Play size={13} /> Start</button>}
        {running && <button className="btn ghost sm" onClick={() => change(clockPause())}><Pause size={13} /> Pause</button>}
        {session?.clock?.paused_at && <button className="btn primary sm" onClick={() => change(clockResume())}><Play size={13} /> Resume</button>}
        {session?.clock?.start && <button className="Q-icon-btn" title="Reset the clock" aria-label="Reset the clock" onClick={() => { if (window.confirm('Reset the session clock?')) change(clockReset()) }}><RotateCcw size={14} /></button>}
      </div>

      {plan.tips.length > 0 && (
        <ul className="Q-plan-tips">
          {plan.tips.map((t, i) => <li key={i}><span>{t.at ? `at ${hm(t.at)}` : 'Now'}</span>{t.text}</li>)}
        </ul>
      )}

      {plan.items.length > 0 && (
        <div className="Q-plan-gantt">
          <div className="Q-plan-axis">
            {Array.from({ length: Math.floor(hours / tickEvery) + 1 }, (_, h) => h * tickEvery).map((h) => (
              <span key={h} style={{ left: `${Math.min(100, h * 3600000 * scale)}%` }}>{h} h</span>
            ))}
          </div>
          {entries.map((e, ri) => (
            <div key={e.recipe.id} className="Q-plan-row">
              <div className="Q-plan-name">{e.recipe.title}</div>
              <div className="Q-plan-lane">
                {plan.items.filter((it) => it.ri === ri).map((it, k) => (
                  <span key={k} className="Q-plan-step" style={{ left: `${it.start * scale}%`, width: `${Math.max(0.6, (it.end - it.start) * scale)}%` }} title={`${it.sub ? it.sub + ' · ' : ''}${it.text}\n${fmtSpan(it.workEnd - it.start)} hands-on${it.wait ? ` + ${fmtSpan(it.wait)} waiting` : ''}${it.learned ? ' (your time)' : ''}`}>
                    <i className="work" style={{ width: `${((it.workEnd - it.start) / Math.max(1, it.end - it.start)) * 100}%` }} />
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="Q-plan-legend"><span><i className="work" />hands-on</span><span><i className="wait" />waiting</span>{learnedCount > 0 && <span>{learnedCount} of {plan.items.length} steps use your own times</span>}</div>
        </div>
      )}

      {plan.items.length > 0 && <div className="Q-plan-listhead"><span>Start (h:mm from the beginning)</span><span>Hands-on + wait</span></div>}
      {plan.items.length > 0 && (
        <ol className="Q-plan-list">
          {plan.items.map((it, k) => (
            <li key={k}>
              <span className="at">{hm(it.start)}</span>
              <span className="what"><b>{it.title}</b>{it.sub ? ` · ${it.sub}` : ''} — {it.text}</span>
              <span className="dur">{fmtSpan(it.workEnd - it.start)}{it.wait ? ` + ${fmtSpan(it.wait)} wait` : ''}{it.learned && <em> · yours</em>}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
