import { Suspense, lazy, useEffect, useState } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import { dbLoadOne, dbLoadPublic } from '../lib/db.js'
import { recipePath } from '../lib/sharing.js'
import AuthScreen from './AuthScreen.jsx'
import { TimerDock, TimersButton } from './Timers.jsx'

const RecipeView = lazy(() => import('./RecipeView.jsx'))
const isPhone = () => window.matchMedia('(max-width: 760px)').matches

// Browsing without an account: everyone's public recipes, read-only. Scaling, baker's % and
// export work; anything that saves asks the guest to sign in.
export default function GuestBrowser({ openId, onSignIn }) {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState(openId || null)
  const [full, setFull] = useState({})
  const [missing, setMissing] = useState(false)

  // The address bar names the open recipe, so it can be shared from the browser with its preview.
  useEffect(() => {
    const want = recipePath(selId)
    if (window.location.pathname + window.location.search !== want) window.history.replaceState(null, '', want)
  }, [selId])
  useEffect(() => { document.title = full[selId]?.title ? `${full[selId].title} · Quaderno+` : 'Quaderno+' }, [selId, full])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      dbLoadPublic({ q })
        .then((rows) => {
          if (cancelled) return
          setList(rows)
          if (!openId && !isPhone()) setSelId((cur) => cur || rows[0]?.id || null)
        })
        .catch(() => { if (!cancelled) setList([]) })
    }, q ? 300 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q])

  useEffect(() => {
    if (!selId || full[selId]) return undefined
    let cancelled = false
    dbLoadOne(selId)
      .then((r) => {
        if (cancelled) return
        if (r.visibility !== 'public') throw new Error('not public')
        setFull((p) => ({ ...p, [r.id]: r }))
      })
      .catch(() => {
        if (cancelled) return
        if (selId === openId) setMissing(true)
        setSelId(null)
      })
    return () => { cancelled = true }
  }, [selId])

  if (missing) {
    return (
      <AuthScreen
        reason="This recipe is private or no longer exists. Sign in to open recipes shared with you."
        onCancel={() => setMissing(false)} cancelLabel="Browse public recipes"
      />
    )
  }

  const sel = selId ? full[selId] : null
  const noop = () => {}
  return (
    <div className="Q" data-open={selId ? '1' : '0'} data-side="1">
      <header className="Q-top">
        <div className="Q-brand">Quaderno<b>+</b></div>
        <div className="Q-top-right">
          <TimersButton />
          <button className="btn primary sm" onClick={onSignIn}>Sign in</button>
        </div>
      </header>
      <div className="Q-body">
        <aside className="Q-side">
          <div className="Q-side-tools">
            <div className="Q-search">
              <Search size={15} className="Q-search-ico" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search public recipes" aria-label="Search public recipes" />
              {q && <button className="Q-search-x" onClick={() => setQ('')} aria-label="Clear search"><X size={14} /></button>}
            </div>
          </div>
          <div className="Q-side-meta"><span>{list ? `${list.length} public ${list.length === 1 ? 'recipe' : 'recipes'}` : 'Loading…'}</span></div>
          <div className="Q-list">
            {!list && Array.from({ length: 6 }).map((_, i) => <div key={i} className="Q-list-skel"><i /><div><b /><s /></div></div>)}
            {list && !list.length && <div className="Q-msg">{q ? 'No public recipes match.' : 'No public recipes yet.'}</div>}
            {(list || []).map((r) => (
              <div
                key={r.id} className="Q-list-item" role="button" tabIndex={0} aria-selected={r.id === selId}
                onClick={() => setSelId(r.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelId(r.id) } }}
              >
                {r.thumbnail ? <img src={r.thumbnail} className="Q-list-thumb" alt="" loading="lazy" /> : <div className="Q-list-thumb ph">{(r.title || '?').trim().charAt(0).toUpperCase()}</div>}
                <div className="Q-list-txt">
                  <h4>{r.title}</h4>
                  <span>{[r.owner?.display_name && `by ${r.owner.display_name}`, r.category].filter(Boolean).join(' · ')}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="Q-guest-note">You're browsing as a guest. <button className="Q-link" onClick={onSignIn}>Sign in</button> to keep recipes, make collections and cook in sessions.</p>
        </aside>
        <main className="Q-main">
          <div className="Q-pane">
            {selId && <button className="Q-back-btn" onClick={() => setSelId(null)}><ArrowLeft size={16} /> Recipes</button>}
            {selId && !sel && <div className="Q-view-loading"><div /><div /><div /></div>}
            {sel && (
              <Suspense fallback={<div className="Q-msg">Loading…</div>}>
                <RecipeView
                  key={sel.id} recipe={sel} guest canEdit={false} ownerName={sel.owner?.display_name}
                  onEdit={noop} onDelete={noop} onUpdate={noop} allRecipes={list || []} onOpenRecipe={setSelId} onCopy={onSignIn} onSaveVariant={onSignIn}
                />
              </Suspense>
            )}
            {!selId && list && list.length > 0 && !isPhone() && <div className="Q-msg">Choose a recipe.</div>}
          </div>
        </main>
      </div>
      <TimerDock />
    </div>
  )
}
