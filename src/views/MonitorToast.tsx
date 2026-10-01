import { useEffect, useRef, useState } from 'react'
import './monitorToast.css'

type ToastProps = { message: string; revision?: number }
type Toast = { message: string; closing: boolean; revision: number }
const DISPLAY_MS = 4_000
const EXIT_MS = 240

export function MonitorToast({ message, revision = 0 }: ToastProps) {
  const [toast, setToast] = useState<Toast | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearTimers() {
    if (dismissTimer.current !== null) clearTimeout(dismissTimer.current)
    if (removeTimer.current !== null) clearTimeout(removeTimer.current)
  }

  function dismiss() {
    clearTimers()
    setToast((current) => current ? { ...current, closing: true } : null)
    removeTimer.current = setTimeout(() => setToast(null), EXIT_MS)
  }

  useEffect(() => {
    clearTimers()
    const text = message.trim()
    setToast(text ? { message: text, closing: false, revision } : null)
    if (text) {
      dismissTimer.current = setTimeout(() => {
        setToast((current) => current ? { ...current, closing: true } : null)
        removeTimer.current = setTimeout(() => setToast(null), EXIT_MS)
      }, DISPLAY_MS)
    }
    return clearTimers
  }, [message, revision])

  if (!toast) return null

  return <div key={`${toast.revision}:${toast.message}`} className={`mp-toast${toast.closing ? ' mp-toast--closing' : ''}`}>
    <span className="mp-toast-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
    </span>
    <p className="mp-toast-message" role="status" aria-live="polite" aria-atomic="true">{toast.message}</p>
    <button className="mp-toast-dismiss" type="button" aria-label="Dismiss message" onClick={dismiss}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button>
  </div>
}
