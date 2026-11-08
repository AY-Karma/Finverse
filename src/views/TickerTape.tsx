import { useEffect, useRef, type ReactNode } from 'react'

const CYCLE_MS = 48_000

export function TickerTape({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const firstGroup = useRef<HTMLDivElement>(null)
  const paused = useRef({ pointer: false, focus: false })

  useEffect(() => {
    const strip = track.current!, group = firstGroup.current!, container = viewport.current!
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let frame = 0, last: number | null = null, elapsed = 0, width = 0
    let active = true
    const draw = () => { strip.style.transform = `translateX(${-width * elapsed / CYCLE_MS}px)` }
    const measure = () => {
      strip.style.setProperty('--ticker-min-width', `${container.clientWidth}px`)
      width = group.getBoundingClientRect().width
      draw()
    }
    const tick = (now: number) => {
      if (last !== null && !paused.current.pointer && !paused.current.focus) elapsed = (elapsed + Math.min(Math.max(now - last, 0), 64)) % CYCLE_MS
      last = now
      draw()
      frame = requestAnimationFrame(tick)
    }
    const resume = () => {
      cancelAnimationFrame(frame)
      last = null
      if (motion?.matches) { elapsed = 0; draw(); return }
      if (document.visibilityState !== 'hidden') { measure(); frame = requestAnimationFrame(tick) }
    }
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resize?.observe(group)
    resize?.observe(container)
    window.addEventListener('resize', measure)
    document.addEventListener('visibilitychange', resume)
    motion?.addEventListener('change', resume)
    void document.fonts?.ready.then(() => { if (active) measure() })
    measure()
    resume()
    return () => {
      active = false
      cancelAnimationFrame(frame)
      resize?.disconnect()
      window.removeEventListener('resize', measure)
      document.removeEventListener('visibilitychange', resume)
      motion?.removeEventListener('change', resume)
    }
  }, [])

  return <div className="tiker-wrap enter d3">
    <div className="ticker" ref={viewport} role="region" aria-label="Market indices quick view" tabIndex={0}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') paused.current.pointer = true }}
      onPointerLeave={() => { paused.current.pointer = false }}
      onPointerDown={() => { paused.current.pointer = true }}
      onPointerUp={() => { paused.current.pointer = false }}
      onPointerCancel={() => { paused.current.pointer = false }}
      onFocus={() => { paused.current.focus = true }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) paused.current.focus = false }}>
      <div className="ticker-track" ref={track}>
        <div className="ticker-group" ref={firstGroup}>{children}</div>
        <div className="ticker-group" aria-hidden="true">{children}</div>
      </div>
    </div>
  </div>
}
