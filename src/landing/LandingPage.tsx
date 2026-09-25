import { useEffect, useState, type ReactNode } from 'react'
import { LandingDemo } from './LandingDemo'
import { LandingPreviewChart } from './LandingPreviewChart'
import { SAMPLE_BENCHMARK, SAMPLE_MONTHS, SAMPLE_PORTFOLIO, samplePercent } from './landingSample'
import './landingPage.css'

export function LandingPage() {
  useEffect(() => {
    document.body.classList.add('landing-page-body')
    document.documentElement.classList.add('landing-page-scroll')
    return () => {
      document.body.classList.remove('landing-page-body')
      document.documentElement.classList.remove('landing-page-scroll')
    }
  }, [])

  useEffect(() => {
    const page = document.querySelector('.landing-site')
    if (!page || !('IntersectionObserver' in window)) return

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -32px 0px' })

    page.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element))
    page.classList.add('lp-motion-ready')
    return () => observer.disconnect()
  }, [])

  return <div className="landing-site"><LiveDesk /></div>
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
          <a href="#a-capabilities">Explore</a>
          <a href="#a-workflow">How it works</a>
          <a href="#a-privacy">Privacy</a>
        </nav>
      </header>

      <section className="a-hero lp-container">
        <div className="a-hero-copy">
          <span className="lp-kicker"><i /> Your portfolio, in focus</span>
          <h1>Know what you own. <em>See what moves.</em></h1>
          <p>Bring your holdings together, follow their price history, and understand today's moves in a private portfolio workspace.</p>
          <div className="lp-actions">
            <a className="lp-button lp-button--primary" href="/app">Open Finverse <ArrowIcon /></a>
            <a className="lp-text-link" href="#a-capabilities">Explore the workspace <span aria-hidden="true">↓</span></a>
          </div>
          <span className="a-hero-note">No account required <i /> Your data stays in this browser</span>
        </div>
        <div className="a-product-stage">
          <div className="a-stage-glow" />
          <LandingDemo />
        </div>
      </section>

      <div className="a-workflow-band" aria-label="Finverse workflow">
        <div className="lp-container"><span>01 / Import holdings</span><span>02 / Read the portfolio</span><span>03 / Follow what changes</span><strong>FINVERSE / LOCAL</strong></div>
      </div>

      <section className="a-capabilities lp-container" id="a-capabilities">
        <div className="lp-section-heading" data-reveal>
          <span className="lp-kicker">The workspace</span>
          <h2>Start with the total.<br /><em>Follow every change.</em></h2>
          <p>Start with the whole portfolio, then follow a move to the holding, chart, or market story behind it.</p>
        </div>
        <div className="a-feature-grid">
          <article className="a-feature a-feature--wide" data-reveal>
            <div><span>01 · Insights</span><h3>See what moved and what weighs most.</h3><p>Trace daily contributors, explore allocation, and compare your portfolio with a market benchmark.</p></div>
            <InsightShot />
          </article>
          <article className="a-feature" data-reveal>
            <div><span>02 · Monitor</span><h3>Follow the stories around your holdings.</h3><p>Filter portfolio news by holding and scan the sources behind each headline.</p></div>
            <MonitorShot />
          </article>
          <article className="a-feature" data-reveal>
            <div><span>03 · Risk and performance</span><h3>Read return alongside risk.</h3><p>Compare a current-holdings backcast with tracked daily snapshots. Check concentration and drawdown beside the returns.</p></div>
            <RiskPerformanceShot />
          </article>
          <article className="a-feature a-feature--wide a-feature--history" data-reveal>
            <div><span>04 · Holding history</span><h3>Follow a holding through time.</h3><p>Choose an equity or mutual fund and inspect its price or NAV history across multiple ranges.</p></div>
            <HistoryShot />
          </article>
          <article className="a-feature" data-reveal>
            <div><span>05 · Research</span><h3>One place to start digging.</h3><p>Each holding gets a dossier with links to company pages, charts, and news.</p></div>
            <ResearchShot />
          </article>
          <article className="a-feature" data-reveal>
            <div><span>06 · Your folios</span><h3>Bring files in. Take your data out.</h3><p>Import multiple spreadsheets as separate folios. Undo the last import or export a backup.</p></div>
            <FolioShot />
          </article>
        </div>
      </section>

      <section className="a-workflow lp-container" id="a-workflow" data-reveal>
        <div><span className="lp-kicker">A simple starting point</span><h2>From holdings file to a clearer read.</h2></div>
        <ol>
          <li><span>01</span><div><strong>Import your holdings</strong><p>Add equity, ETF, or mutual fund files. Finverse keeps each import as a folio.</p></div></li>
          <li><span>02</span><div><strong>Check the whole picture</strong><p>Review value, P&amp;L, allocation, and the positions driving today's move.</p></div></li>
          <li><span>03</span><div><strong>Go deeper when you need to</strong><p>Open history, insights, the market wire, or a holding's research links.</p></div></li>
        </ol>
      </section>

      <section className="a-privacy lp-container" id="a-privacy" data-reveal>
        <div>
          <span className="lp-kicker">Local-first by design</span>
          <h2>Your holdings stay in your browser.</h2>
        </div>
        <p>Finverse has no account system or portfolio backend. Your holdings are stored locally. External market data is optional, and providers receive instrument identifiers when you turn it on.</p>
        <a className="lp-button lp-button--outline" href="/app">Enter the workspace <ArrowIcon /></a>
      </section>

      <LandingFooter />
    </main>
  )
}

function BrowserFrame({ children, label, className = '' }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div className={`product-shot ${className}`} role="group" aria-label={`${label} in-app preview`}>
      <div className="shot-chrome"><span><i /><i /><i /></span><strong>{label}</strong><small>ILLUSTRATIVE PREVIEW</small></div>
      {children}
    </div>
  )
}

const PREVIEW_HISTORY = [2420, 2480, 2460, 2590, 2550, 2630, 2670, 2610, 2750, 2790, 2870, 2984]

function InsightShot() {
  const [range, setRange] = useState<'3M' | '1Y'>('1Y')
  const start = range === '3M' ? -4 : 0
  return (
    <BrowserFrame label="Insights · Benchmark Race">
      <div className="shot-insights">
        <div className="shot-chart-head"><div><span>Portfolio vs NIFTY 50</span><strong>Sample backcast</strong></div><div className="shot-chart-ranges" role="group" aria-label="Benchmark preview range">{(['3M', '1Y'] as const).map((option) => <button key={option} type="button" className={range === option ? 'is-active' : ''} aria-pressed={range === option} onClick={() => setRange(option)}>{option}</button>)}</div></div>
        <LandingPreviewChart key={range} label="Sample portfolio and NIFTY 50 comparison" months={SAMPLE_MONTHS.slice(start)} series={[{ label: 'Portfolio', color: '#6875f5', values: SAMPLE_PORTFOLIO.slice(start) }, { label: 'NIFTY 50', color: '#f2b33d', values: SAMPLE_BENCHMARK.slice(start) }]} formatValue={samplePercent} />
        <div className="shot-chart-legend"><span><i className="dot-indigo" />Portfolio <strong>+31.8%</strong></span><span><i className="dot-benchmark" />NIFTY 50 <strong>+14.2%</strong></span></div>
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
          <div className="risk-performance-score"><strong>4</strong><span>positions at 10%+</span></div>
          <div className="risk-meter"><i style={{ width: '72%' }} /></div>
          <ul>
            <li><span>Largest holding</span><strong>30.6%</strong></li>
            <li><span>Top three weight</span><strong>78.5%</strong></li>
            <li><span>Priced holdings</span><strong className="shot-up">4 / 4</strong></li>
          </ul>
        </section>
        <section className="risk-performance-panel risk-performance-panel--story">
          <div className="risk-performance-head"><span>Performance story</span><i>BACKCAST</i></div>
          <div className="performance-value"><strong>+19.8%</strong><span>value over invested capital</span></div>
          <LandingPreviewChart label="Sample value and invested capital history" months={SAMPLE_MONTHS} series={[{ label: 'Value', color: '#36d881', values: [2.3, 2.35, 2.4, 2.43, 2.49, 2.56, 2.59, 2.66, 2.75, 2.81, 2.96, 3.12] }, { label: 'Invested', color: '#f1b446', values: [2.43, 2.45, 2.48, 2.5, 2.52, 2.54, 2.56, 2.58, 2.59, 2.6, 2.6, 2.6] }]} formatValue={(value) => `₹${value.toFixed(2)}L`} compact />
          <div className="performance-legend"><span><i />Value</span><span><i />Invested</span></div>
        </section>
      </div>
    </BrowserFrame>
  )
}

function MonitorShot() {
  return (
    <BrowserFrame label="Monitor" className="product-shot--compact">
      <div className="shot-monitor">
        <div className="shot-monitor-head"><div><span>Market wire</span><strong>Stories near your holdings</strong></div><i>SAMPLE</i></div>
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

function HistoryShot() {
  const [range, setRange] = useState<'1M' | '3M' | '1Y'>('1Y')
  const start = range === '1M' ? -2 : range === '3M' ? -4 : 0
  return (
    <BrowserFrame label="Overview · Holding history" className="product-shot--history">
      <div className="shot-history">
        <div className="shot-history-top"><div><span>PRICE HISTORY / EQUITY</span><strong>RELIANCE</strong><small>See how a holding moved over time</small></div><div className="shot-history-ranges" role="group" aria-label="Holding history preview range">{(['1M', '3M', '1Y'] as const).map((option) => <button type="button" key={option} className={range === option ? 'is-active' : ''} aria-pressed={range === option} onClick={() => setRange(option)}>{option}</button>)}</div></div>
        <LandingPreviewChart key={range} label="Sample RELIANCE price history" months={SAMPLE_MONTHS.slice(start)} series={[{ label: 'Price', color: '#4bbbd1', values: PREVIEW_HISTORY.slice(start) }]} formatValue={(value) => `₹${value.toLocaleString('en-IN')}`} />
      </div>
    </BrowserFrame>
  )
}

function ResearchShot() {
  return (
    <BrowserFrame label="Research · Holding dossier" className="product-shot--research">
      <div className="shot-research">
        <div className="shot-research-top"><span className="shot-research-mark">R</span><div><strong>RELIANCE</strong><small>Reliance Industries · NSE</small></div><i>EQUITY</i></div>
        <div className="shot-research-links"><span>Company profile <i>↗</i></span><span>Financials <i>↗</i></span><span>Price chart <i>↗</i></span><span>News <i>↗</i></span></div>
        <div className="shot-research-foot"><span>One dossier for every holding</span><strong>RESEARCH / 04</strong></div>
      </div>
    </BrowserFrame>
  )
}

function FolioShot() {
  return (
    <BrowserFrame label="Monitor · Your folios" className="product-shot--folio">
      <div className="shot-folio">
        <div className="shot-folio-heading"><span>YOUR FOLIOS</span><strong>2 files · 4 holdings</strong></div>
        <div className="shot-folio-row"><i>01</i><div><strong>Equity holdings.csv</strong><small>3 holdings · Equity</small></div><span>IMPORTED</span></div>
        <div className="shot-folio-row"><i>02</i><div><strong>Mutual funds.xlsx</strong><small>1 holding · Mutual fund</small></div><span>IMPORTED</span></div>
        <div className="shot-folio-actions"><span>+ Import holdings</span><span>Export CSV</span><span>Backup JSON</span></div>
      </div>
    </BrowserFrame>
  )
}

function LandingFooter() {
  return (
    <footer className="lp-footer lp-container">
      <div className="lp-footer-brand"><Brand compact /><span>Local-first portfolio workspace</span></div>
      <small className="lp-footer-meta">© 2026 Finverse · Private by design</small>
      <div className="lp-footer-credit">
        <small>Built by AY-Karma</small>
        <a href="https://github.com/AY-Karma" target="_blank" rel="noreferrer">GitHub <ArrowIcon /></a>
      </div>
    </footer>
  )
}
