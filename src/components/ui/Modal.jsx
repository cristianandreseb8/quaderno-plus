import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ title, icon: Icon, onClose, children, footer, width = 640, hidden = false, className = '' }) {
  useEffect(() => {
    if (hidden) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose, hidden])

  return (
    <div className="Q-modal-overlay" style={hidden ? { display: 'none' } : undefined} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={`Q-modal ${className}`} style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="Q-modal-head">
          {Icon && <Icon size={18} className="Q-modal-ico" />}
          <h2>{title}</h2>
          <button className="Q-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="Q-modal-body">{children}</div>
        {footer && <div className="Q-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
