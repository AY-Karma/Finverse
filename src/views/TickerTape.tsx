import type { ReactNode } from 'react'

export function TickerTape({ children }: { children: ReactNode }) {
  return <div className="tiker-wrap enter d3"><section className="ticker" aria-label="Market indices quick view">{children}</section></div>
}
