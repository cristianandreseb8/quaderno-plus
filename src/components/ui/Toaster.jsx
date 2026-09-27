import { useEffect, useState } from 'react'
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react'

// Tiny global toast bus: any module can call toast() without threading props or context.
const listeners = new Set()
let nextId = 1

export function toast(message, { type = 'info', duration, action } = {}) {
  const t = { id: nextId++, message: String(message), type, action, duration: duration ?? (type === 'error' ? 7000 : 3600) }
  listeners.forEach((l) => l(t))
}
toast.error = (message, opts) => toast(message, { ...opts, type: 'error' })
toast.success = (message, opts) => toast(message, { ...opts, type: 'success' })

const ICONS = { info: Info, success: CircleCheck, error: TriangleAlert }

export default function Toaster() {
  const [items, setItems] = useState([])

  useEffect(() => {
    const onToast = (t) => {
      setItems((p) => [...p.slice(-3), t])
      setTimeout(() => { setItems((p) => p.filter((x) => x.id !== t.id)) }, t.duration)
    }
    listeners.add(onToast)
    return () => { listeners.delete(onToast) }
  }, [])

  const dismiss = (id) => setItems((p) => p.filter((x) => x.id !== id))

  return (
    <div className="Q-toasts" role="status" aria-live="polite">
      {items.map((t) => {
        const Icon = ICONS[t.type] || Info
        return (
          <div key={t.id} className={`Q-toast ${t.type}`}>
            <Icon size={16} className="Q-toast-icon" />
            <span className="Q-toast-msg">{t.message}</span>
            {t.action && <button className="Q-toast-action" onClick={() => { t.action.onClick(); dismiss(t.id) }}>{t.action.label}</button>}
            <button className="Q-toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} /></button>
          </div>
        )
      })}
    </div>
  )
}
