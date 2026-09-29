import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Modal from './ui/Modal.jsx'
import { toast } from './ui/Toaster.jsx'
import { VISIBILITY, createShare, inviteLink, listShares, mailInvite, recipeLink, removeShare, setVisibility } from '../lib/sharing.js'

const LEVELS = [
  ['private', VISIBILITY.private, 'Only you can see this recipe.'],
  ['shared', VISIBILITY.shared, 'Only the people you invite. Each invite is a personal link for one person.'],
  ['public', VISIBILITY.public, 'Listed in public recipes: anyone can find and open it, even without an account.'],
]

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`) } catch (_) { window.prompt('Copy this link:', text) }
}
// The phone's own share sheet (WhatsApp, Messages…). The link shows the recipe's title and photo.
const canShare = typeof navigator !== 'undefined' && !!navigator.share
async function shareSheet(title, url) {
  try { await navigator.share({ title, text: title, url }) } catch (e) { if (e?.name !== 'AbortError') copy(url, 'Link') }
}

export default function ShareModal({ recipe, fromName, onClose, onVisibility }) {
  const [level, setLevel] = useState(recipe.visibility || 'private')
  const [shares, setShares] = useState([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listShares(recipe.id).then(setShares).catch((e) => toast.error(e.message)).finally(() => setLoading(false))
  }, [recipe.id])

  async function pick(v) {
    if (v === level) return
    const prev = level
    setLevel(v)
    try { await setVisibility(recipe.id, v); onVisibility(v) } catch (e) { setLevel(prev); toast.error('Could not change: ' + e.message) }
  }
  async function invite() {
    setBusy(true)
    try {
      const s = await createShare(recipe.id, label || 'Invite')
      setShares((p) => [...p, s]); setLabel('')
      if (level !== 'shared') await pick('shared')
      await copy(inviteLink(s.token), 'Invite link')
    } catch (e) {
      toast.error('Could not create the invite: ' + e.message)
    } finally {
      setBusy(false)
    }
  }
  async function revoke(s) {
    if (!window.confirm(`Stop sharing with ${s.label || 'this person'}?`)) return
    try { await removeShare(s.id); setShares((p) => p.filter((x) => x.id !== s.id)) } catch (e) { toast.error(e.message) }
  }

  return (
    <Modal title="Share recipe" onClose={onClose} width={560} className="Q-share">
      <p className="Q-share-title">{recipe.title}</p>
      <div className="Q-seg Q-share-seg">
        {LEVELS.map(([k, l]) => <button key={k} type="button" className={level === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>)}
      </div>
      <p className="Q-set-help">{LEVELS.find(([k]) => k === level)[2]}</p>

      {level === 'public' && (
        <div className="Q-share-box">
          <code>{recipeLink(recipe.id, recipe)}</code>
          {canShare && <button className="btn ghost sm" onClick={() => shareSheet(recipe.title, recipeLink(recipe.id, recipe))}>Share…</button>}
          <button className="btn primary sm" onClick={() => copy(recipeLink(recipe.id, recipe), 'Link')}>Copy link</button>
        </div>
      )}

      {level === 'shared' && (
        <>
          <div className="Q-share-add">
            <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') invite() }} placeholder="Name or email of the person" />
            <button className="btn primary sm" onClick={invite} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : 'Invite'}</button>
          </div>
          {loading && <div className="Q-msg">Loading…</div>}
          {!loading && shares.length === 0 && <p className="Q-dim">No one yet. Each invite gives one person a link to open this recipe.</p>}
          {shares.length > 0 && (
            <ul className="Q-share-list">
              {shares.map((s) => (
                <li key={s.id}>
                  <div>
                    <b>{s.label || 'Invite'}</b>
                    <span>{s.user_id ? 'Has access' : 'Invite not opened yet'}</span>
                  </div>
                  {!s.user_id && canShare && <button className="Q-link" onClick={() => shareSheet(recipe.title, inviteLink(s.token))}>Share…</button>}
                  {!s.user_id && <button className="Q-link" onClick={() => copy(inviteLink(s.token), 'Invite link')}>Copy link</button>}
                  {!s.user_id && <button className="Q-link" onClick={() => mailInvite(s.label, recipe.title, inviteLink(s.token), fromName)}>Email</button>}
                  <button className="Q-link danger" onClick={() => revoke(s)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {level !== 'private' && <p className="Q-share-note">The link shows the recipe's title and photo in WhatsApp, Messages and other apps.</p>}
      <p className="Q-share-note">People you share with can view, scale, use baker's %, translate and export. Only you can change or delete the recipe.</p>
    </Modal>
  )
}
