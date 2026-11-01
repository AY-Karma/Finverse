import type { ReactNode } from 'react'
import './errorScreen.css'

interface Props {
  code: string
  title: string
  description: string
  children: ReactNode
  alert?: boolean
}

export function ErrorScreen({ code, title, description, children, alert = false }: Props) {
  return <main className="error-screen" role={alert ? 'alert' : undefined}>
    <div className="error-screen-inner">
      <header className="error-screen-header">
        <a href="/app" className="error-screen-brand"><img src="/favicon.svg?v=2" width="28" height="28" alt="" />Finverse</a>
      </header>
      <div className="error-screen-body">
        <section className="error-screen-copy">
          <span className="error-screen-code"><span aria-hidden="true" />{code}</span>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className="error-screen-actions">{children}</div>
        </section>
        <div className="error-screen-art" aria-hidden="true">
          <svg viewBox="0 0 480 320" fill="none" focusable="false">
            <g className="error-chart-grid"><path d="M24 48h432M24 112h432M24 176h432M24 240h432M88 24v256M184 24v256M280 24v256M376 24v256" /></g>
            <path className="error-chart-history" d="M24 96 56 80 88 88 120 48 152 64 184 56" />
            <g className="error-chart-candles">
              <g><path d="M216 54v70" /><rect x="209" y="68" width="14" height="38" rx="2" /></g>
              <g><path d="M248 88v76" /><rect x="241" y="104" width="14" height="40" rx="2" /></g>
              <g><path d="M280 126v62" /><rect x="273" y="140" width="14" height="30" rx="2" /></g>
              <g><path d="M312 152v92" /><rect x="305" y="172" width="14" height="52" rx="2" /></g>
              <g><path d="M344 202v64" /><rect x="337" y="216" width="14" height="32" rx="2" /></g>
            </g>
            <path className="error-chart-fall" pathLength="1" d="m184 56 32 32 32 40 32 28 32 44 32 32 32-12" />
            <path className="error-chart-settle" d="M376 220h64" />
            <g className="error-chart-end"><circle cx="440" cy="220" r="13" /><path d="M440 214v7m0 4v1" /></g>
          </svg>
        </div>
      </div>
    </div>
  </main>
}
