import { useEffect, useRef } from 'react'
import overviewShot from './assets/overview.webp'
import comparisonShot from './assets/comparison.webp'
import exposureShot from './assets/exposure.webp'
import monitorShot from './assets/monitor.webp'
import settingsShot from './assets/settings.webp'
import highlightsShot from './assets/m-highlights.webp'
import './landing.css'

type Shot = { src: string; width: number; height: number; alt: string }

const SHOTS = {
  overview: { src: overviewShot, width: 2288, height: 1000, alt: 'Overview with the holdings ledger and a portfolio performance chart' },
  comparison: { src: comparisonShot, width: 2288, height: 1192, alt: 'Market comparison of a sample portfolio against NIFTY 50' },
  exposure: { src: exposureShot, width: 2288, height: 660, alt: 'Allocation treemap and sector exposure mix' },
  monitor: { src: monitorShot, width: 1452, height: 2000, alt: 'Monitor with market news and the economic calendar' },
  settings: { src: settingsShot, width: 1464, height: 1096, alt: 'Settings with imported portfolio, listing review and recurring SIPs' },
  highlights: { src: highlightsShot, width: 1170, height: 2532, alt: 'Portfolio highlights story on a phone' },
} satisfies Record<string, Shot>

const FEATURES: { id: string; kicker: string; title: string; body: string; points: string[]; shot: Shot; tall?: boolean }[] = [
  {
    id: 'insights', kicker: 'Insights', title: 'Measure yourself against the market.',
    body: 'Run today’s holdings against NIFTY 50 or another index over one month to all available history, with the result stated in plain words.',
    points: ['Compare with Indian and global indices', 'Drawdown, time below peak and yearly swings', 'Clearly labelled as a backcast, not your P&L'],
    shot: SHOTS.comparison,
  },
  {
    id: 'exposure', kicker: 'Exposure', title: 'See where your money actually sits.',
    body: 'A treemap of every holding, sector and market-cap mix, and an allocation donut you can split by equity and mutual funds.',
    points: ['Largest positions at a glance', 'Sector and market-cap breakdown', 'Funds and stocks side by side'],
    shot: SHOTS.exposure,
  },
  {
    id: 'monitor', kicker: 'Monitor', title: 'The news and dates that move your holdings.',
    body: 'Market headlines, IPOs with GMP trends, an economic calendar and company updates, in one place, plus watch rules that ping you when a price crosses your line.',
    points: ['RBI, GDP, CPI and FOMC dates', 'Open, upcoming and recent IPOs', 'Price and daily-move watch rules'],
    shot: SHOTS.monitor, tall: true,
  },
  {
    id: 'imports', kicker: 'Imports & SIPs', title: 'Import once. Update in a minute.',
    body: 'Drop in the holdings export from Zerodha, Groww, INDmoney, Angel One or another spreadsheet. Review every change before it is saved, undo the last import, and track recurring SIPs between statements.',
    points: ['.xlsx, .xls and .csv exports', 'Change review and one-step undo', 'SIP instalments with estimated NAV dates'],
    shot: SHOTS.settings,
  },
]

const STEPS = [
  ['Export your holdings', 'Download the holdings file from Zerodha, Groww, INDmoney, Angel One or another broker.'],
  ['Import and review', 'Finverse matches each listing and scheme, then shows what will change before saving.'],
  ['Follow what moves', 'Prices refresh during NSE sessions and NAVs when they are published.'],
]

export function LandingPage() {
  const page = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.title = 'Finverse · Know what you own'
    const root = page.current
    if (!root || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      }
    }, { rootMargin: '0px 0px -10% 0px' })
    root.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element))
    root.classList.add('lp-reveal-ready')
    return () => observer.disconnect()
  }, [])

  return (
    <div className="lp" ref={page}>
      <a className="lp-skip" href="#lp-main">Skip to content</a>
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-inner">
          <Brand />
          <nav aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#privacy">Privacy</a>
          </nav>
          <a className="lp-btn lp-btn--small" href="/app">Open Finverse</a>
        </div>
      </header>

      <main id="lp-main">
        <section className="lp-hero lp-wrap">
          <div className="lp-hero-copy">
            <p className="lp-kicker">Stocks · ETFs · Mutual funds</p>
            <h1>Know what you own.<br /><span>See what moves.</span></h1>
            <p className="lp-lead">A private portfolio workspace for Indian investors. Import your holdings and follow prices, NAVs, news and the market around them.</p>
            <div className="lp-actions">
              <a className="lp-btn" href="/app">Open Finverse <span aria-hidden="true">→</span></a>
              <a className="lp-link" href="#features">See what’s inside</a>
            </div>
            <ul className="lp-facts" aria-label="At a glance">
              <li>No account</li>
              <li>Holdings stay in your browser</li>
              <li>INR with Indian digit grouping</li>
            </ul>
          </div>
          <div className="lp-hero-art">
            <Frame shot={SHOTS.overview} label="Overview" eager />
          </div>
        </section>

        <section className="lp-features lp-wrap" id="features" aria-label="Features">
          {FEATURES.map((feature, index) => (
            <article key={feature.id} className={`lp-feature${index % 2 ? ' lp-feature--flip' : ''}${feature.tall ? ' lp-feature--tall' : ''}`} data-reveal>
              <div className="lp-feature-copy">
                <p className="lp-kicker">{feature.kicker}</p>
                <h2>{feature.title}</h2>
                <p>{feature.body}</p>
                <ul>{feature.points.map((point) => <li key={point}>{point}</li>)}</ul>
              </div>
              <Frame shot={feature.shot} label={feature.kicker} />
            </article>
          ))}

          <article className="lp-feature lp-feature--flip lp-feature--phone" data-reveal>
            <div className="lp-feature-copy">
              <p className="lp-kicker">Highlights</p>
              <h2>Your week, told in a few slides.</h2>
              <p>Weekly and monthly recaps of your portfolio and the market: what lifted it, what dragged it and how NIFTY 50 did over the same days.</p>
              <ul><li>Portfolio, weekly and monthly editions</li><li>Top and worst holding by rupee impact</li><li>Built for a phone screen</li></ul>
            </div>
            <Phone shot={SHOTS.highlights} />
          </article>
        </section>

        <section className="lp-how lp-wrap" id="how" data-reveal>
          <h2>From a holdings file to a clear picture.</h2>
          <ol>
            {STEPS.map(([title, body], index) => (
              <li key={title}><span>{String(index + 1).padStart(2, '0')}</span><strong>{title}</strong><p>{body}</p></li>
            ))}
          </ol>
        </section>

        <section className="lp-privacy lp-wrap" id="privacy" data-reveal>
          <div>
            <p className="lp-kicker">Private by default</p>
            <h2>Your portfolio never leaves this browser.</h2>
          </div>
          <dl>
            <div><dt>No account, no server copy</dt><dd>Holdings, history and preferences are stored only in your browser.</dd></div>
            <div><dt>Identifiers only</dt><dd>Price providers see which instruments to quote, never your quantities or costs.</dd></div>
            <div><dt>Hide values</dt><dd>One tap masks amounts and holding names on every screen.</dd></div>
            <div><dt>Your backup</dt><dd>Download a backup file and restore it in another browser whenever you need.</dd></div>
          </dl>
        </section>

        <section className="lp-cta lp-wrap" data-reveal>
          <h2>Open your portfolio in under a minute.</h2>
          <a className="lp-btn" href="/app">Open Finverse <span aria-hidden="true">→</span></a>
        </section>
      </main>

      <footer className="lp-footer lp-wrap">
        <Brand />
        <p>Market data is indicative and may be delayed. Not investment advice.</p>
        <a href="https://github.com/AY-Karma/Finverse" target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  )
}

function Brand() {
  return (
    <a className="lp-brand" href="/welcome">
      <img src="/favicon.svg?v=2" width="28" height="28" alt="" />
      Finverse
    </a>
  )
}

function Frame({ shot, label, eager = false }: { shot: Shot; label: string; eager?: boolean }) {
  return (
    <figure className="lp-frame">
      <div className="lp-frame-bar" aria-hidden="true"><i /><i /><i /><span>{label}</span></div>
      <img src={shot.src} width={shot.width} height={shot.height} alt={shot.alt} loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined} />
    </figure>
  )
}

function Phone({ shot }: { shot: Shot }) {
  return (
    <figure className="lp-phone">
      <img src={shot.src} width={shot.width} height={shot.height} alt={shot.alt} loading="lazy" decoding="async" />
    </figure>
  )
}
