import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function RiskHelp({ id, label, open, onOpenChange, children }: {
  id: string; label: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode
}) {
  const button = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLSpanElement>(null)
  const pinned = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const clearClose = () => clearTimeout(closeTimer.current)
  const close = () => { clearClose(); pinned.current = false; onOpenChange(false) }
  const show = () => { clearClose(); onOpenChange(true) }
  const leave = () => {
    clearClose()
    closeTimer.current = setTimeout(() => {
      if (!pinned.current && document.activeElement !== button.current) onOpenChange(false)
    }, 150)
  }

  useLayoutEffect(() => {
    if (!open) { pinned.current = false; setPosition(null); return clearClose }
    let frame = 0
    const update = () => {
      if (!button.current || !popover.current) return
      const anchor = button.current.getBoundingClientRect()
      const box = popover.current.getBoundingClientRect()
      const edge = 12
      const below = anchor.bottom + 8
      const above = anchor.top - box.height - 8
      const top = below + box.height <= innerHeight - edge ? below : above >= edge ? above
        : Math.max(edge, Math.min(below, innerHeight - box.height - edge))
      const width = document.documentElement.clientWidth || innerWidth
      const left = Math.max(edge, Math.min(anchor.left - 8, width - box.width - edge))
      setPosition(current => current?.left === left && current.top === top ? current : { left, top })
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update) }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !button.current?.contains(event.target) && !popover.current?.contains(event.target)) close()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    if (popover.current) observer?.observe(popover.current)
    update()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      clearClose()
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open, onOpenChange])

  return <>
    <button ref={button} type="button" className="risk-help" aria-label={`Explain how ${label} is calculated and rated`}
      aria-expanded={open} aria-describedby={open ? id : undefined} aria-controls={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={close}
      onClick={() => { if (pinned.current) close(); else { pinned.current = true; show() } }}>i</button>
    {open && createPortal(<span ref={popover} id={id} role="tooltip" className="risk-help-popover risk-help-popover--floating"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
      onMouseEnter={clearClose} onMouseLeave={leave}>{children}</span>, document.body)}
  </>
}
