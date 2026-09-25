import { useState, type ReactNode } from 'react'
import { LandingPreviewChart } from './LandingPreviewChart'
import { SAMPLE_BENCHMARK, SAMPLE_MONTHS, SAMPLE_PORTFOLIO, samplePercent } from './landingSample'
import './landingDemo.css'

type DemoTab = 'overview' | 'monitor' | 'insights' | 'research' | 'settings'
type DemoScope = 'all' | 'equity' | 'funds'

type DemoHolding = {
  ticker: string
  name: string
  type: 'equity' | 'funds'
  quantity: number
  buy: number
  price: number
  change: number
  color: string
}

const HOLDINGS: DemoHolding[] = [
  { ticker: 'RELIANCE', name: 'Reliance Industries', type: 'equity', quantity: 32, buy: 2460, price: 2984, change: 1.18, color: '#7784fa' },
  { ticker: 'INFY', name: 'Infosys', type: 'equity', quantity: 54, buy: 1218, price: 1479, change: -0.24, color: '#54c3b9' },
  { ticker: 'HDFCBANK', name: 'HDFC Bank', type: 'equity', quantity: 41, buy: 1432, price: 1688, change: 0.72, color: '#e5b358' },
  { ticker: 'BLUECHIP', name: 'Bluechip Fund', type: 'funds', quantity: 920, buy: 62, price: 73, change: 0.35, color: '#ba85db' },
]

const TABS: { id: DemoTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'monitor', label: 'Monitor' },
  { id: 'insights', label: 'Insights' },
  { id: 'research', label: 'Research' },
  { id: 'settings', label: 'Settings' },
]

const STORIES = [
  { ticker: 'RELIANCE', title: 'Energy and retail shape the quarterly picture', source: 'Market wire', time: '18m ago', detail: 'A sample headline connected to Reliance Industries. The full wire groups each story with its holding and source.' },
  { ticker: 'INFY', title: 'Services demand steadies this quarter', source: 'Business desk', time: '42m ago', detail: 'A sample headline connected to Infosys. Open Finverse to follow live stories and their sources.' },
  { ticker: 'HDFCBANK', title: 'Banks lead a broad market advance', source: 'Market wire', time: '1h ago', detail: 'A sample headline connected to HDFC Bank. Filter the full wire by holding, topic, or signal.' },
]

const money = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`

export function LandingDemo() {
  const [tab, setTab] = useState<DemoTab>('overview')
  const [scope, setScope] = useState<DemoScope>('all')
  const [selectedTicker, setSelectedTicker] = useState(HOLDINGS[0].ticker)
  const [hideValues, setHideValues] = useState(false)
  const [refreshes, setRefreshes] = useState(0)
  const [newsTicker, setNewsTicker] = useState('ALL')
  const [newsQuery, setNewsQuery] = useState('')
  const [openStory, setOpenStory] = useState<string | null>(null)
  const [chartRange, setChartRange] = useState<'3M' | '1Y'>('1Y')
  const [researchQuery, setResearchQuery] = useState('')
  const [settingsSection, setSettingsSection] = useState<'preferences' | 'privacy'>('preferences')
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')

  const shown = HOLDINGS.filter((holding) => scope === 'all' || holding.type === scope)
  const selected = shown.find((holding) => holding.ticker === selectedTicker) ?? shown[0]
  const visibleStories = STORIES.filter((story) => (newsTicker === 'ALL' || story.ticker === newsTicker) && `${story.title} ${story.ticker} ${story.source}`.toLowerCase().includes(newsQuery.toLowerCase()))
  const researchHoldings = HOLDINGS.filter((holding) => `${holding.name} ${holding.ticker}`.toLowerCase().includes(researchQuery.toLowerCase())).slice(0, 3)
  const priceOf = (holding: DemoHolding) => Math.round(holding.price * [1, 1.002, 0.999][refreshes % 3])
  const currentValue = shown.reduce((sum, holding) => sum + holding.quantity * priceOf(holding), 0)
  const invested = shown.reduce((sum, holding) => sum + holding.quantity * holding.buy, 0)
  const visibleMoney = (amount: number) => hideValues ? '•••••' : money(amount)
  let allocationEnd = 0
  const allocationSegments = shown.map((holding) => {
    const start = allocationEnd
    allocationEnd += (holding.quantity * priceOf(holding) / currentValue) * 100
    return `${holding.color} ${start}% ${allocationEnd}%`
  })

  return (
    <div className={`landing-demo a-overview-shot${density === 'compact' ? ' demo-compact' : ''}`} role="region" aria-label="Interactive sample of the Finverse workspace">
      <div className="shot-chrome"><span><i /><i /><i /></span><strong>Finverse workspace · Try the preview</strong><small>SAMPLE DATA / NO LIVE REQUESTS</small></div>
      <div className="demo-shell">
        <aside className="demo-sidebar">
          <div className="demo-brand"><span>₹</span><strong>Finverse<small>Portfolio workspace</small></strong></div>
          <span className="demo-sidebar-label">WORKSPACE</span>
          <nav aria-label="Preview sections">
            {TABS.map(({ id, label }, index) => <button type="button" key={id} className={tab === id ? 'is-active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><span>{label}</span><i>0{index + 1}</i></button>)}
          </nav>
          <span className="demo-sidebar-foot">{HOLDINGS.length} sample holdings</span>
        </aside>

        <div className="demo-content">
          {tab === 'overview' && <>
            <div className="demo-topline">
              <div><span>PORTFOLIO / SAMPLE</span><h3>Overview</h3></div>
              <div className="demo-top-actions">
                <div className="demo-segmented" role="group" aria-label="Preview portfolio scope">
                  {(['all', 'equity', 'funds'] as const).map((option) => (
                    <button key={option} type="button" className={scope === option ? 'is-active' : ''} aria-pressed={scope === option} onClick={() => setScope(option)}>
                      {option === 'all' ? 'All' : option === 'equity' ? 'Equity' : 'Funds'}
                    </button>
                  ))}
                </div>
                <button type="button" className="demo-icon-button" aria-label={hideValues ? 'Show sample values' : 'Hide sample values'} aria-pressed={hideValues} onClick={() => setHideValues((value) => !value)}>{hideValues ? '◉' : '◎'}</button>
                <button type="button" className="demo-icon-button" aria-label="Refresh sample prices" onClick={() => setRefreshes((count) => count + 1)}>↻</button>
              </div>
            </div>
            <p className="demo-status">{refreshes ? `Sample prices refreshed ${refreshes} ${refreshes === 1 ? 'time' : 'times'}.` : 'Try the filters, holdings, and controls. Values are sample data.'}</p>
            <div className="demo-stats">
              <div><span>Current value</span><strong>{visibleMoney(currentValue)}</strong><small>{shown.length} holdings in view</small></div>
              <div><span>Invested</span><strong>{visibleMoney(invested)}</strong><small>Cost basis</small></div>
              <div><span>Unrealized P&amp;L</span><strong className="demo-positive">{hideValues ? '•••••' : `+${money(currentValue - invested)}`}</strong><small>{samplePercent((currentValue / invested - 1) * 100)} on cost</small></div>
            </div>
            <div className="demo-daily">
              <div><span>DAILY READ</span><strong>{selected.ticker} is in focus.</strong><small>Choose a holding below to inspect its sample move.</small></div>
              <div><span>TODAY</span><strong className={selected.change >= 0 ? 'demo-positive' : 'demo-negative'}>{samplePercent(selected.change)}</strong></div>
              <button type="button" onClick={() => setTab('insights')}>See insights →</button>
            </div>
            <div className="demo-ticker" aria-label="Select a sample holding">
              {HOLDINGS.map((holding) => <button type="button" key={holding.ticker} className={selected.ticker === holding.ticker ? 'is-active' : ''} onClick={() => { setScope('all'); setSelectedTicker(holding.ticker) }}>
                <strong>{holding.ticker}</strong><span className={holding.change >= 0 ? 'demo-positive' : 'demo-negative'}>{samplePercent(holding.change)}</span>
              </button>)}
            </div>
            <div className="demo-panels">
              <section className="demo-ledger">
                <div className="demo-panel-head"><strong>The ledger</strong><span>01 / HOLDINGS</span></div>
                <div className="demo-ledger-labels"><span>SYMBOL</span><span>QTY</span><span>VALUE</span></div>
                {shown.map((holding) => <button type="button" key={holding.ticker} className={selected.ticker === holding.ticker ? 'is-active' : ''} onClick={() => setSelectedTicker(holding.ticker)}>
                  <strong>{holding.ticker}</strong><span>{holding.quantity}</span><span>{visibleMoney(holding.quantity * priceOf(holding))}</span>
                </button>)}
              </section>
              <section className="demo-allocation">
                <div className="demo-panel-head"><strong>Allocation mix</strong><span>02 / EXPOSURE</span></div>
                <div className="demo-donut" style={{ background: `conic-gradient(${allocationSegments.join(', ')})` }}><div><small>HOLDINGS</small><strong>{shown.length}</strong></div></div>
                <div className="demo-allocation-detail"><span style={{ background: selected.color }} /><strong>{selected.ticker}</strong><small>{((selected.quantity * priceOf(selected) / currentValue) * 100).toFixed(1)}%</small></div>
              </section>
            </div>
          </>}

          {tab === 'monitor' && <DemoPanel title="Portfolio watch" eyebrow="02 / MONITOR" description="Market stories for your holdings, shown here with sample headlines.">
            <div className="demo-monitor-status"><span className="demo-status-dot" /><div><strong>Sample market wire</strong><small>{STORIES.length} illustrative stories · No live requests</small></div><span>ON WATCH</span></div>
            <div className="demo-feed">
              <div className="demo-feed-head"><strong>Market wire</strong><span>{visibleStories.length} of {STORIES.length} stories</span></div>
              <input className="demo-search" type="search" aria-label="Search sample stories" placeholder="Search headline or holding" value={newsQuery} onChange={(event) => setNewsQuery(event.target.value)} />
              <div className="demo-filter-row" role="group" aria-label="Filter sample stories">
                {['ALL', 'RELIANCE', 'INFY', 'HDFCBANK'].map((ticker) => <button type="button" key={ticker} className={newsTicker === ticker ? 'is-active' : ''} aria-pressed={newsTicker === ticker} onClick={() => setNewsTicker(ticker)}>{ticker === 'ALL' ? 'All holdings' : ticker}</button>)}
              </div>
              {visibleStories.length === 0 && <p className="demo-empty">No sample stories match that search.</p>}
              {visibleStories.map((story) => (
                <button className="demo-story" type="button" key={story.ticker} aria-expanded={openStory === story.ticker} onClick={() => setOpenStory((current) => current === story.ticker ? null : story.ticker)}>
                  <span>{story.ticker}</span><strong>{story.title}</strong><i>{openStory === story.ticker ? '−' : '+'}</i>
                  <small>{story.source} · {story.time}</small>
                  {openStory === story.ticker && <em>{story.detail}</em>}
                </button>
              ))}
            </div>
          </DemoPanel>}

          {tab === 'insights' && <DemoPanel title="Insights" eyebrow="03 / PERFORMANCE" description="Inspect a sample benchmark comparison. Move across the chart to read each point.">
            <div className="demo-chart-head">
              <strong>Portfolio vs NIFTY 50</strong>
              <div className="demo-segmented">{(['3M', '1Y'] as const).map((range) => <button type="button" key={range} className={chartRange === range ? 'is-active' : ''} aria-pressed={chartRange === range} onClick={() => setChartRange(range)}>{range}</button>)}</div>
            </div>
            <LandingPreviewChart
              key={chartRange}
              label="Sample portfolio against NIFTY 50"
              months={chartRange === '1Y' ? SAMPLE_MONTHS : SAMPLE_MONTHS.slice(-4)}
              series={[{ label: 'Portfolio', color: '#7784fa', values: chartRange === '1Y' ? SAMPLE_PORTFOLIO : SAMPLE_PORTFOLIO.slice(-4) }, { label: 'NIFTY 50', color: '#f2b33d', values: chartRange === '1Y' ? SAMPLE_BENCHMARK : SAMPLE_BENCHMARK.slice(-4) }]}
              formatValue={samplePercent}
            />
            <div className="demo-chart-legend"><span><i style={{ background: '#7784fa' }} />Portfolio +31.8%</span><span><i style={{ background: '#f2b33d' }} />NIFTY 50 +14.2%</span></div>
          </DemoPanel>}

          {tab === 'research' && <DemoPanel title="Research desk" eyebrow="04 / RESEARCH" description="A dossier for each holding, with its context and paths into deeper research.">
            <div className="demo-research-brief"><div><span>PORTFOLIO CONTEXT</span><strong>{HOLDINGS.length} holdings · 2 allocation groups</strong><small>Sample positions stay in this preview.</small></div><span>LOCAL FIRST</span></div>
            <div className="demo-research-toolbar"><input className="demo-search" type="search" aria-label="Filter sample research cards" placeholder="Filter by name or ticker" value={researchQuery} onChange={(event) => setResearchQuery(event.target.value)} /><span>{researchHoldings.length} shown</span></div>
            <div className="demo-research-grid">
              {researchHoldings.length === 0 && <p className="demo-empty">No sample holding matches that filter.</p>}
              {researchHoldings.map((holding) => <article className="demo-research-card" key={holding.ticker}>
                <div className="demo-research-identity"><span className="demo-research-avatar">{holding.ticker.slice(0, 1)}</span><div><strong>{holding.ticker}</strong><small>{holding.name}</small><span>EQUITY · NSE</span></div><div className="demo-research-value"><strong>{visibleMoney(holding.quantity * priceOf(holding))}</strong>{!hideValues && <small className={holding.change >= 0 ? 'demo-positive' : 'demo-negative'}>{samplePercent(holding.change)}</small>}</div></div>
                <div className="demo-research-links"><a href="/app">Fundamentals ↗</a><a href="/app">Charts ↗</a><a href="/app">News ↗</a></div>
              </article>)}
            </div>
          </DemoPanel>}

          {tab === 'settings' && <DemoPanel title="Settings" eyebrow="05 / WORKSPACE" description="Choose how the workspace displays sample information.">
            <div className="demo-settings-shell">
              <nav className="demo-settings-nav" aria-label="Sample settings categories">
                <span>SETTINGS / 02</span>
                <button type="button" className={settingsSection === 'preferences' ? 'is-active' : ''} aria-current={settingsSection === 'preferences' ? 'page' : undefined} onClick={() => setSettingsSection('preferences')}><strong>01</strong><span>Preferences<small>INR · {density}</small></span></button>
                <button type="button" className={settingsSection === 'privacy' ? 'is-active' : ''} aria-current={settingsSection === 'privacy' ? 'page' : undefined} onClick={() => setSettingsSection('privacy')}><strong>02</strong><span>Data &amp; privacy<small>Local first</small></span></button>
                <small>Changes stay in this sample.</small>
              </nav>
              <div className="demo-settings-detail">
                <div className="demo-settings-heading"><span>{settingsSection === 'preferences' ? 'WORKSPACE' : 'PERMISSIONS'}</span><strong>{settingsSection === 'preferences' ? 'Preferences' : 'Data & privacy'}</strong><small>{settingsSection === 'preferences' ? 'Sample display controls' : 'External access in this preview'}</small></div>
                {settingsSection === 'preferences' ? <div className="demo-settings-group">
                  <div className="demo-settings-row"><span><strong>Display currency</strong><small>Values are shown in rupees</small></span><b>INR (₹)</b></div>
                  <label className="demo-settings-row"><span><strong>Interface density</strong><small>Change sample spacing</small></span><select aria-label="Sample interface density" value={density} onChange={(event) => setDensity(event.target.value as 'comfortable' | 'compact')}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
                  <button type="button" className="demo-setting" aria-pressed={hideValues} onClick={() => setHideValues((value) => !value)}><span><strong>Hide portfolio values</strong><small>Mask amounts in the sample overview</small></span><i className={hideValues ? 'is-on' : ''} /></button>
                </div> : <div className="demo-settings-group"><div className="demo-settings-row"><span><strong>Local portfolio storage</strong><small>Sample holdings live only in this page</small></span><b>ON</b></div><div className="demo-settings-row"><span><strong>External market data</strong><small>No provider is called by this preview</small></span><b>OFF</b></div></div>}
              </div>
            </div>
          </DemoPanel>}

          {tab !== 'overview' && <div className="demo-gate"><span>Just a glimpse of {tab}.</span><a href="/app">Launch Finverse ↗</a></div>}
        </div>
      </div>
    </div>
  )
}

function DemoPanel({ title, eyebrow, description, children }: { title: string; eyebrow: string; description: string; children: ReactNode }) {
  return <div className="demo-tab-panel"><div className="demo-tab-intro"><span>{eyebrow}</span><h3>{title}</h3><p>{description}</p></div>{children}</div>
}
