import { useEffect, type ReactNode } from 'react'
import overviewScreenshot from './assets/overview-user-fullres.png'
import './landingPrototype.css'

export function LandingPage() {
  useEffect(() => {
    document.body.classList.add('landing-prototype-body')
    return () => document.body.classList.remove('landing-prototype-body')
  }, [])

  return <div className="landing-prototype"><LiveDesk /></div>
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`lp-brand${compact ? ' lp-brand--compact' : ''}`} href="/" aria-label="Finverse home">
      <span>₹</span>
      <strong>Finverse</strong>
    </a>
  )
}

function ArrowIcon() {
  return <span aria-hidden="true">↗</span>
}

function LiveDesk() {
  return (
    <main className="landing-page landing-a">
      <header className="a-nav lp-container">
        <Brand />
        <nav aria-label="Landing page">
          <a href="#a-capabilities">Capabilities</a>
          <a href="#a-privacy">Privacy</a>
        </nav>
      </header>

      <section className="a-hero lp-container">
        <div className="a-hero-copy">
          <span className="lp-kicker"><i /> Latest market read, on demand</span>
          <h1>Know where your portfolio stands.</h1>
          <p>Import your holdings, fetch the latest prices, and read value, P&amp;L, allocation, and today's movement in one private workspace.</p>
          <div className="lp-actions">
            <a className="lp-button lp-button--primary" href="/?workspace=1">Open Finverse <ArrowIcon /></a>
            <a className="lp-text-link" href="#a-capabilities">See what it does ↓</a>
          </div>
        </div>
        <div className="a-product-stage">
          <div className="a-stage-glow" />
          <ProductScreenshot src={overviewScreenshot} alt="Finverse Overview showing current value, profit and loss, holdings ledger, and portfolio allocation" className="a-overview-shot" eager />
          <AllocationMini className="a-floating-allocation" />
        </div>
      </section>

      <TickerBand />

      <section className="a-capabilities lp-container" id="a-capabilities">
        <div className="lp-section-heading">
          <span className="lp-kicker">The workspace</span>
          <h2>One screen for the number.<br />The rest for the why.</h2>
          <p>Finverse keeps the daily check quick, then gives you room to inspect exposure, history, research, and the market around your holdings.</p>
        </div>
        <div className="a-feature-grid">
          <article className="a-feature a-feature--wide">
            <div><span>01 · Insights</span><h3>See what moved and what weighs most.</h3><p>Contribution, allocation, concentration, and benchmark comparisons share the same portfolio math.</p></div>
            <InsightShot />
          </article>
          <article className="a-feature">
            <div><span>02 · Monitor</span><h3>Keep the market near your holdings.</h3></div>
            <MonitorShot compact />
          </article>
          <article className="a-feature">
            <div><span>03 · Risk and performance</span><h3>Check the pressure before the story.</h3></div>
            <RiskPerformanceShot />
          </article>
          <article className="a-feature a-feature--alpha">
            <div>
              <span className="a-alpha-tag"><i /> Alpha · In development</span>
              <h3>Portfolio-aware questions are coming next.</h3>
              <p>The Assistant is being developed as an optional layer. Your portfolio remains useful without it.</p>
            </div>
            <AssistantShot compact />
          </article>
        </div>
      </section>

      <section className="a-privacy lp-container" id="a-privacy">
        <div>
          <span className="lp-kicker">Local-first by design</span>
          <h2>Your holdings stay in your browser.</h2>
        </div>
        <p>Finverse has no account system, portfolio backend, or telemetry service. Market providers receive instrument identifiers only when you enable external data. Your AI provider receives context only when you send a prompt.</p>
        <a className="lp-button lp-button--outline" href="/?workspace=1">Enter the workspace <ArrowIcon /></a>
      </section>

      <LandingFooter label="Portfolio workspace" />
    </main>
  )
}

function ProductScreenshot({
  src,
  alt,
  className = '',
  eager = false,
}: {
  src: string
  alt: string
  className?: string
  eager?: boolean
}) {
  return (
    <figure className={`real-product-shot ${className}`}>
      <div className="shot-chrome"><span><i /><i /><i /></span><strong>Finverse workspace</strong><small>LOCAL / READ ONLY</small></div>
      <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} />
    </figure>
  )
}

function BrowserFrame({ children, label, className = '' }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div className={`product-shot ${className}`} aria-label={`${label} in-app preview`} role="img">
      <div className="shot-chrome"><span><i /><i /><i /></span><strong>{label}</strong><small>FINVERSE / LOCAL</small></div>
      {children}
    </div>
  )
}

function InsightShot() {
  return (
    <BrowserFrame label="Insights · Benchmark Race">
      <div className="shot-insights">
        <div className="shot-chart-head"><div><span>Portfolio vs NIFTY 50</span><strong>One year backcast</strong></div><small>1Y⌄</small></div>
        <svg viewBox="0 0 700 260" aria-hidden="true">
          <defs><linearGradient id="area-indigo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6875f5" stopOpacity=".28"/><stop offset="1" stopColor="#6875f5" stopOpacity="0"/></linearGradient></defs>
          {[35, 90, 145, 200].map((y) => <line key={y} x1="38" x2="680" y1={y} y2={y} className="chart-grid" />)}
          <path d="M40 202 C92 190 118 182 152 188 S210 145 252 156 S310 112 350 128 S425 94 470 102 S535 64 575 82 S640 42 678 50 L678 224 L40 224 Z" fill="url(#area-indigo)" />
          <path d="M40 202 C92 190 118 182 152 188 S210 145 252 156 S310 112 350 128 S425 94 470 102 S535 64 575 82 S640 42 678 50" className="chart-line chart-line--portfolio" />
          <path d="M40 202 C115 198 165 170 215 178 S310 157 360 162 S455 132 510 144 S605 111 678 120" className="chart-line chart-line--benchmark" />
          <text x="40" y="245">SEP</text><text x="250" y="245">JAN</text><text x="470" y="245">MAY</text><text x="640" y="245">AUG</text>
        </svg>
        <div className="shot-chart-legend"><span><i className="dot-indigo" />Portfolio <strong>+31.8%</strong></span><span><i className="dot-cyan" />NIFTY 50 <strong>+14.2%</strong></span></div>
      </div>
    </BrowserFrame>
  )
}

function RiskPerformanceShot() {
  return (
    <BrowserFrame label="Insights · Risk and performance" className="product-shot--risk-performance">
      <div className="risk-performance-shot">
        <section className="risk-performance-panel">
          <div className="risk-performance-head"><span>Risk checks</span><i>WATCH</i></div>
          <div className="risk-performance-score"><strong>6</strong><span>positions at 10%+</span></div>
          <div className="risk-meter"><i style={{ width: '72%' }} /></div>
          <ul>
            <li><span>Largest holding</span><strong>17.0%</strong></li>
            <li><span>Top three weight</span><strong>44.5%</strong></li>
            <li><span>Priced holdings</span><strong className="shot-up">8 / 8</strong></li>
          </ul>
        </section>
        <section className="risk-performance-panel risk-performance-panel--story">
          <div className="risk-performance-head"><span>Performance story</span><i>BACKCAST</i></div>
          <div className="performance-value"><strong>+24.9%</strong><span>value over invested capital</span></div>
          <svg viewBox="0 0 300 100" aria-hidden="true">
            <path d="M4 87 C36 84 48 71 77 74 S112 52 140 58 S177 38 201 44 S242 22 296 14" className="performance-line performance-line--value" />
            <path d="M4 88 C54 84 92 78 132 72 S216 59 296 51" className="performance-line performance-line--capital" />
          </svg>
          <div className="performance-legend"><span><i />Value</span><span><i />Invested</span></div>
        </section>
      </div>
    </BrowserFrame>
  )
}

function MonitorShot({ compact = false }: { compact?: boolean }) {
  return (
    <BrowserFrame label="Monitor" className={compact ? 'product-shot--compact' : ''}>
      <div className="shot-monitor">
        <div className="shot-monitor-head"><div><span>Market wire</span><strong>Stories near your holdings</strong></div><i>12 new</i></div>
        {[
          ['INFY', 'IT services demand steadies as deal pipeline expands', 'Economic Times · 18m'],
          ['RELIANCE', 'Energy and retail units set the pace for the quarter', 'Business Standard · 42m'],
          ['MARKET', 'NIFTY closes higher as financials lead', 'Market wire · 1h'],
        ].map(([ticker, title, meta]) => (
          <div className="shot-story" key={title}><span>{ticker}</span><div><strong>{title}</strong><small>{meta}</small></div><i>↗</i></div>
        ))}
      </div>
    </BrowserFrame>
  )
}

function AssistantShot({ compact = false }: { compact?: boolean }) {
  return (
    <BrowserFrame label="Assistant" className={compact ? 'product-shot--compact' : ''}>
      <div className="shot-assistant">
        <div className="shot-user">Where is my concentration risk?</div>
        <div className="shot-answer"><span>FINVERSE</span><p>Your top three holdings make up <strong>48.6%</strong> of current value. RELIANCE is the largest at 19.2%.</p><div className="shot-bars"><i style={{ width: '86%' }} /><i style={{ width: '64%' }} /><i style={{ width: '48%' }} /></div><small>Calculated from the portfolio on file</small></div>
        <div className="shot-prompt"><span>Ask about this portfolio</span><i>↑</i></div>
      </div>
    </BrowserFrame>
  )
}

function AllocationMini({ className = '' }: { className?: string }) {
  return (
    <div className={`allocation-mini ${className}`} role="img" aria-label="Portfolio allocation preview">
      <div><span>Allocation</span><strong>Where value sits</strong></div>
      <div className="allocation-ribbon"><i style={{ width: '34%' }} /><i style={{ width: '24%' }} /><i style={{ width: '18%' }} /><i style={{ width: '14%' }} /><i style={{ width: '10%' }} /></div>
      <ul><li><span>RELIANCE</span><strong>19.2%</strong></li><li><span>INFY</span><strong>15.4%</strong></li><li><span>HDFCBANK</span><strong>13.1%</strong></li></ul>
    </div>
  )
}

function TickerBand() {
  const items = [['NIFTY 50', '24,698.40', '+0.42%'], ['SENSEX', '80,786.54', '+0.36%'], ['RELIANCE', '2,984.20', '+1.18%'], ['INFY', '1,478.60', '-0.24%'], ['USD / INR', '87.42', '+0.08%']]
  return <div className="lp-ticker" aria-label="Illustrative market snapshot"><div>{items.map(([name, value, change]) => <span key={name}><strong>{name}</strong><i>{value}</i><small className={change.startsWith('+') ? 'shot-up' : 'shot-down'}>{change}</small></span>)}</div></div>
}

function LandingFooter({ label }: { label: string }) {
  return (
    <footer className="lp-footer lp-container">
      <div className="lp-footer-brand"><Brand compact /><small>Local-first portfolio workspace</small></div>
      <span>{label}</span>
      <div className="lp-footer-credit">
        <small>Built by AY-Karma</small>
        <a href="https://github.com/AY-Karma" target="_blank" rel="noreferrer">GitHub <ArrowIcon /></a>
      </div>
      <small className="lp-footer-meta">© 2026 Finverse · Private by design</small>
    </footer>
  )
}
