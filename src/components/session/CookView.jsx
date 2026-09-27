import { useMemo } from 'react'
import { numberSteps, parseSections, scaleRecipe, splitIngLine } from '../../lib/recipeCalc.js'
import { setFactor, toggleProgress } from '../../lib/session.js'
import FactorMenu from './FactorMenu.jsx'
import Blocks from '../ui/Blocks.jsx'
import VideoBlock from '../VideoBlock.jsx'
import { useSettings } from '../../lib/settings.js'

// The recipe as it is cooked in this session: scaled to the chosen batches, with ticks that
// follow the process (weighed ingredients, finished steps) and are saved as you go.
export default function CookView({ recipe, entry, progress, change, onOpenRecipe, onRemove, onVideos }) {
  const { settings } = useSettings()
  const split = settings.layout === 'split'
  const videos = Array.isArray(recipe.videos) ? recipe.videos : []
  const factor = Number(entry.factor) || 1
  const view = useMemo(() => (factor === 1 ? recipe : scaleRecipe(recipe, factor)), [recipe, factor])
  const sections = useMemo(() => parseSections(view.ingredients || []), [view])
  const ing = new Set(progress?.ing || [])
  const done = new Set(progress?.steps || [])
  const all = numberSteps(view.steps)
  const steps = all.map((st, i) => ({ ...st, i })).filter((st) => st.text && !st.header)
  const nextStep = steps.find(({ i }) => !done.has(i))?.i
  const doneCount = steps.filter(({ i }) => done.has(i)).length

  return (
    <div className="Q-cook">
      <div className="Q-sess-head">
        <div>
          <h1>{recipe.title}</h1>
          <p>
            {steps.length ? `${doneCount} of ${steps.length} steps done` : 'No method written'}
            {recipe.servings ? ` · ${recipe.servings}${factor !== 1 ? ` × ${+factor.toFixed(2)}` : ''}` : ''}
          </p>
        </div>
        <div className="Q-textbtns">
          <FactorMenu factor={factor} onChange={(v) => change(setFactor(recipe.id, v))} onRemove={onRemove} />
          <button onClick={onOpenRecipe}>Full recipe</button>
        </div>
      </div>
      {steps.length > 0 && <div className="Q-meter"><i style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>}

      <Blocks blocks={[
        {
          id: 'ingredients', title: 'Mise en place', summary: `${ing.size} of ${sections.reduce((n, sec) => n + sec.items.length, 0)} ready`,
          content: sections.map((sec, si) => (
            <div key={si}>
              {sec.name && <div className="Q-sec-h"><span>{sec.name}</span></div>}
              <ul className="Q-ings">
                {sec.items.map((line, ii) => {
                  const raw = sec.rawIndices[ii]
                  const d = splitIngLine(line)
                  return (
                    <li key={ii} className={`Q-ing-row${ing.has(raw) ? ' checked' : ''}${d.ref ? ' ref' : ''}`} onClick={() => change(toggleProgress(recipe.id, 'ing', raw))}>
                      <span className="Q-ing-check" aria-hidden="true" />
                      <span className="Q-ing-qty">{d.qty}</span><span className="Q-ing-name">{d.name}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )),
        },
        steps.length > 0 && {
          id: 'method', title: 'Method', summary: `${doneCount} of ${steps.length}`,
          content: (
            <ol className="Q-steps Q-cook-steps">
              {all.map((st, i) => {
                if (!st.text) return null
                if (st.header) return <li key={i} className="Q-step-h">{st.text}</li>
                return (
                  <li
                    key={i} data-n={st.n} className={`${done.has(i) ? 'done' : ''}${i === nextStep ? ' next' : ''}`}
                    onClick={() => change(toggleProgress(recipe.id, 'steps', i))}
                  >
                    {st.text}
                  </li>
                )
              })}
            </ol>
          ),
        },
        videos.length > 0 && { id: 'video', title: videos.length > 1 ? 'Videos' : 'Video', content: <VideoBlock videos={videos} onChange={onVideos} /> },
        view.notes && { id: 'notes', title: 'Notes', content: <div className="Q-baker-note">{view.notes}</div> },
      ].filter(Boolean)} split={split}
      />
    </div>
  )
}
