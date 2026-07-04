import { useEffect } from 'react'
import { useApp } from '../store/appStore'
import type { Toast } from '../types'

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useApp((s) => s.dismissToast)
  useEffect(() => {
    const t = setTimeout(() => dismissToast(toast.id), 6500)
    return () => clearTimeout(t)
  }, [toast.id, dismissToast])
  return (
    <div className={`toast ${toast.kind}`} onClick={() => dismissToast(toast.id)}>
      {toast.text}
    </div>
  )
}

export default function Toasts() {
  const toasts = useApp((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <ToastItem toast={t} key={t.id} />
      ))}
    </div>
  )
}
