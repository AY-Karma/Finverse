import { useEffect, useMemo, useState } from 'react'
import { formatCurrency, formatPercent } from '../valuation'
import { BENCHMARKS, marketData } from '../marketData'
import { buildPortfolioBackcast, type PortfolioBackcast } from '../portfolioBackcast'
import { downsampleSeries } from '../timeSeries'
import { useStore } from '../useStore'
import { buildContributionColumns, type ContributionDisplay } from '../contributionBars'
import { InteractiveTrendChart } from './InteractiveTrendChart'

const COLORS = ['#5e6ad2', '#7a8cff', '#41b883', '#f2b53c', '#e77b8a', '#9a9fd0', '#5c8298', '#c185c8']
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' })
const MAX_CHART_POINTS = 180

type BenchmarkPoint = { ts: number; portfolio: number; benchmark?: number }
function shortDate(value: number): string {
  return SHORT_DATE_FORMATTER.format(new Date(value))
}

export function InsightsView() {
  const { snapshot, settings } = useStore()
  const [benchmarkId, setBenchmarkId] = useState('nifty-50')
  const selectedBenchmark = BENCHMARKS.find((item) => item.id === benchmarkId) ?? BENCHMARKS[0]
  const [benchmarkPoints, setBenchmarkPoints] = useState<{ date: string; close: number }[]>([])
  const [benchmarkLoading, setBenchmarkLoading] = useState(false)
  const [benchmarkError, setBenchmarkError] = useState(false)
  const [selectedExposureSymbol, setSelectedExposureSymbol] = useState<string | null>(null)
  const [contributionDisplay, setContributionDisplay] = useState<ContributionDisplay>('price')
  const [openKpi, setOpenKpi] = useState<'top-five' | 'drawdown' | null>(null)
  const [backcast, setBackcast] = useState<PortfolioBackcast | null>(null)
  const [backcastLoading, setBackcastLoading] = useState(false)
  const [performanceMode, setPerformanceMode] = useState<'backcast' | 'tracked'>('backcast')
  const backcastKey = useMemo(
    () => snapshot.positions.map((position) => `${position.id}:${position.quantity}:${position.buyPrice}`).join('|'),
    [snapshot.positions],
  )

  useEffect(() => {
    if (!settings.allowExternalData || snapshot.positions.length === 0) {
      setBackcast(null)
      return
    }
    let alive = true
    setBackcastLoading(true)
    void buildPortfolioBackcast(snapshot.positions, snapshot.quotes, marketData).then((result) => {
      if (alive) {
        setBackcast(result)
        setBackcastLoading(false)
      }
    }).catch(() => {
      if (alive) {
        setBackcast(null)
        setBackcastLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [backcastKey, settings.allowExternalData])

  const contributionColumns = useMemo(() => buildContributionColumns(snapshot.contributions.map((item) => ({
    label: item.symbol.length > 14 ? `${item.symbol.slice(0, 13)}…` : item.symbol,
    dailyPriceChange: item.dailyPriceChange,
    dailyPriceChangePct: item.dailyPriceChangePct,
  })), contributionDisplay), [contributionDisplay, snapshot.contributions])
  const exposure = useMemo(() => [...snapshot.contributions].sort((a, b) => b.value - a.value).slice(0, 16), [snapshot.contributions])
  const topFive = useMemo(() => [...snapshot.contributions].sort((a, b) => b.value - a.value).slice(0, 5), [snapshot.contributions])
  const chartHistory = useMemo(() => downsampleSeries(snapshot.history, MAX_CHART_POINTS), [snapshot.history])
  const backcastHistory = backcast?.points ?? []
  const analyticsHistory = backcastHistory.length >= 2 ? backcastHistory : chartHistory
  const analyticsStartAt = analyticsHistory[0]?.at ?? null
  const trackedAvailable = chartHistory.length >= 2
  const performanceHistory = performanceMode === 'tracked' && trackedAvailable ? chartHistory : backcastHistory

  useEffect(() => {
    if (!settings.allowExternalData || analyticsStartAt == null || !selectedBenchmark.symbol) {
      setBenchmarkPoints([])
      return
    }
    let alive = true
    setBenchmarkPoints([])
    setBenchmarkError(false)
    setBenchmarkLoading(true)
    const to = new Date()
    const from = new Date(Math.min(analyticsStartAt, to.getTime() - 365 * 24 * 60 * 60 * 1000))
    void marketData.benchmarkHistory(selectedBenchmark.symbol, from, to).then((points) => {
      if (alive) {
        setBenchmarkPoints(points)
        setBenchmarkError(points.length < 2)
        setBenchmarkLoading(false)
      }
    }).catch(() => {
      if (alive) {
        setBenchmarkPoints([])
        setBenchmarkError(true)
        setBenchmarkLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [analyticsStartAt, selectedBenchmark.symbol, settings.allowExternalData])

  const benchmarkSeries = useMemo<BenchmarkPoint[]>(() => {
    const history = analyticsHistory
    if (history.length < 2) return []
    const firstPortfolio = history[0].value
    const benchmarkTimes = benchmarkPoints.map((item) => +new Date(item.date))
    let benchmarkIndex = 0
    while (benchmarkIndex + 1 < benchmarkTimes.length && benchmarkTimes[benchmarkIndex + 1] <= history[0].at) benchmarkIndex += 1
    const firstBenchmark = benchmarkPoints[benchmarkIndex]?.close
    return history.map((point) => {
      while (benchmarkIndex + 1 < benchmarkTimes.length && benchmarkTimes[benchmarkIndex + 1] <= point.at) benchmarkIndex += 1
      const matching = benchmarkPoints[benchmarkIndex]
      return {
        ts: point.at,
        portfolio: firstPortfolio > 0 ? ((point.value / firstPortfolio) - 1) * 100 : 0,
        benchmark: firstBenchmark && matching ? ((matching.close / firstBenchmark) - 1) * 100 : undefined,
      }
    })
  }, [analyticsHistory, benchmarkPoints])

  const risk = useMemo(() => {
    let peak = 0
    let peakAt: number | null = null
    let worst = 0
    let worstAt: number | null = null
    let worstPeakAt: number | null = null
    const returns: number[] = []
    for (let index = 0; index < analyticsHistory.length; index += 1) {
      const point = analyticsHistory[index]
      const previous = analyticsHistory[index - 1]
      if (previous?.value > 0) returns.push((point.value - previous.value) / previous.value)
      if (point.value >= peak) {
        peak = point.value
        peakAt = point.at
      }
      const drawdown = peak > 0 ? ((point.value - peak) / peak) * 100 : 0
      if (drawdown < worst) {
        worst = drawdown
        worstAt = point.at
        worstPeakAt = peakAt
      }
    }
    const average = returns.length ? returns.reduce((sum, item) => sum + item, 0) / returns.length : 0
    const variance = returns.length > 1 ? returns.reduce((sum, item) => sum + (item - average) ** 2, 0) / (returns.length - 1) : 0
    const currentValue = analyticsHistory[analyticsHistory.length - 1]?.value ?? peak
    return { worst, current: peak > 0 ? ((currentValue - peak) / peak) * 100 : 0, volatility: Math.sqrt(variance) * Math.sqrt(252) * 100, worstAt, worstPeakAt }
  }, [analyticsHistory])

  if (snapshot.positions.length === 0) {
    return <div className="empty-panel"><span className="page-eyebrow">03 · Intelligence</span><h1 className="page-title">Your investment story starts with an import.</h1><p className="page-sub">Once holdings are loaded, this space turns prices into contribution, allocation, performance, and risk views.</p></div>
  }

  const hide = settings.hideValues
  const mask = (value: string) => hide ? '••••••' : value
  const currency = settings.currency
  const value = (amount: number) => mask(formatCurrency(amount, currency, snapshot.fxRate?.usdInr))
  const hasDailyData = contributionColumns.tailwinds.length > 0 || contributionColumns.headwinds.length > 0
  const hasHistory = analyticsHistory.length >= 2
  const selectedExposure = exposure.find((item) => item.symbol === selectedExposureSymbol) ?? exposure[0]

  return (
    <div className="insights-page">
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">03 · Investment intelligence</div>
          <h1 className="page-title">Read the market story.</h1>
        </div>
        <p className="page-sub">A visual explanation of what moved your portfolio, where your exposure sits, and how your record compares with the market.</p>
      </div>

      <div className="insight-kpis enter d1">
        <div className="insight-kpi"><span className="score-label">Today’s move</span><strong className={snapshot.dailyChange != null && snapshot.dailyChange >= 0 ? 'up' : 'down'}>{snapshot.dailyChange == null ? '—' : mask(`${snapshot.dailyChange >= 0 ? '+' : ''}${formatCurrency(snapshot.dailyChange, currency, snapshot.fxRate?.usdInr)}`)}</strong><span className="hint">{snapshot.dailyChangePct == null ? 'Waiting for quote changes' : mask(formatPercent(snapshot.dailyChangePct))}</span></div>
        <button type="button" className={`insight-kpi insight-kpi--interactive${openKpi === 'top-five' ? ' insight-kpi--open' : ''}`} onClick={() => setOpenKpi(openKpi === 'top-five' ? null : 'top-five')} aria-expanded={openKpi === 'top-five'} aria-controls="top-five-detail"><span className="score-label">Top five weight</span><strong>{mask(`${snapshot.topFiveWeight.toFixed(1)}%`)}</strong><span className="hint">See the five-position split</span></button>
        <button type="button" className={`insight-kpi insight-kpi--interactive${openKpi === 'drawdown' ? ' insight-kpi--open' : ''}`} onClick={() => setOpenKpi(openKpi === 'drawdown' ? null : 'drawdown')} aria-expanded={openKpi === 'drawdown'} aria-controls="drawdown-detail"><span className="score-label">Worst drawdown</span><strong className={risk.worst < 0 ? 'down' : ''}>{hasHistory ? mask(`${risk.worst.toFixed(1)}%`) : '—'}</strong><span className="hint">See date and calculation</span></button>
        <div className="insight-kpi"><span className="score-label">Data health</span><strong>{snapshot.staleQuotes === 0 ? 'Fresh' : `${snapshot.staleQuotes} stale`}</strong><span className="hint">{snapshot.lastUpdatedAt ? `Last quote ${shortDate(snapshot.lastUpdatedAt)}` : 'Imported prices only'}</span></div>
      </div>

      {openKpi === 'top-five' && <div className="insight-kpi-detail enter" id="top-five-detail"><div><span className="score-label">Largest five holdings</span><strong>{mask(`${snapshot.topFiveWeight.toFixed(1)}% of portfolio`)}</strong></div><div className="kpi-split-list">{topFive.map((item) => <div key={item.symbol}><span>{item.symbol}</span><span className="kpi-split-bar"><i style={{ width: `${item.weight / Math.max(...topFive.map((holding) => holding.weight), 1) * 100}%` }} /></span><strong>{mask(`${item.weight.toFixed(1)}%`)}</strong></div>)}</div></div>}
      {openKpi === 'drawdown' && <div className="insight-kpi-detail enter" id="drawdown-detail"><div><span className="score-label">How this was calculated</span><strong>{hasHistory ? mask(`${risk.worst.toFixed(1)}%`) : '—'}</strong></div><p>{hasHistory && risk.worstAt && risk.worstPeakAt ? <>The reconstructed value fell from its high on <strong>{shortDate(risk.worstPeakAt)}</strong> to its lowest point on <strong>{shortDate(risk.worstAt)}</strong>. This uses today’s holdings across historical market prices and does not claim a news or event caused the move.</> : 'Historical prices are still loading for this calculation.'}</p></div>}

      <div className="insight-grid enter d2">
        <section className="panel insight-panel insight-panel--wide">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Benchmark race</span><span className="section-index">01 · Portfolio vs {selectedBenchmark.label}</span></div><label className="benchmark-picker"><span className="sr-only">Benchmark comparison</span><select aria-label="Benchmark comparison" value={benchmarkId} onChange={(event) => setBenchmarkId(event.target.value)}>{(['India', 'Global'] as const).map((region) => <optgroup key={region} label={region}>{BENCHMARKS.filter((item) => item.region === region).map((item) => <option key={item.id} value={item.id}>{item.label}{item.unavailableReason ? ' — unavailable' : ''}</option>)}</optgroup>)}</select></label></div>
          <span className="hint">{selectedBenchmark.unavailableReason ?? (benchmarkError ? `Could not load ${selectedBenchmark.label} history` : benchmarkLoading || backcastLoading ? 'Building the one-year comparison…' : backcast ? `Current-holdings backcast · ${backcast.coveragePct.toFixed(0)}% value coverage` : 'Historical market data is unavailable')}</span>
          <div className="insight-chart">
            {benchmarkSeries.length >= 2 ? <InteractiveTrendChart rows={benchmarkSeries.map((item) => ({ at: item.ts, portfolio: item.portfolio, benchmark: item.benchmark }))} lines={[{ key: 'portfolio', label: 'Portfolio', color: '#5e6ad2' }, { key: 'benchmark', label: selectedBenchmark.label, color: '#f2b53c' }]} valueFormatter={(amount) => mask(`${amount >= 0 ? '+' : ''}${amount.toFixed(1)}%`)} yAxisLabel="Return (%)" includeZero /> : <div className="chart-empty chart-empty--tracking"><i aria-hidden="true" /><strong>{selectedBenchmark.unavailableReason ?? (settings.allowExternalData ? 'Building your comparison' : 'External market data is off')}</strong><span>{selectedBenchmark.unavailableReason ? 'Choose another benchmark to start a comparison.' : settings.allowExternalData ? 'The app is reconstructing today’s holdings against real historical closes.' : 'Enable it in Settings to compare your portfolio with market benchmarks.'}</span></div>}
          </div>
        </section>

        <section className="panel insight-panel">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Allocation treemap</span><span className="section-index">02 · Exposure</span></div></div>
          <AllocationMap items={exposure} selected={selectedExposure?.symbol ?? null} onSelect={setSelectedExposureSymbol} hideValues={hide} formatValue={value} />
        </section>

        <section className="panel insight-panel">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Exposure mix</span><span className="section-index">03 · Sectors / type</span></div></div>
          <ExposureBars items={snapshot.sectors.slice(0, 8)} hideValues={hide} formatValue={value} />
          <div className="insight-legend">{snapshot.sectors.slice(0, 6).map((sector, index) => <div key={sector.label}><span className="legend-swatch" style={{ background: COLORS[index % COLORS.length] }} /><span>{sector.label}</span><strong>{mask(`${sector.weight.toFixed(1)}%`)}</strong></div>)}</div>
        </section>

        <section className="panel insight-panel insight-panel--wide">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">What moved today?</span><span className="section-index">04 · Contribution waterfall</span></div><div className="segmented-control" aria-label="Mover display"><button type="button" className={contributionDisplay === 'price' ? 'is-active' : ''} onClick={() => setContributionDisplay('price')} aria-pressed={contributionDisplay === 'price'}>Price Δ</button><button type="button" className={contributionDisplay === 'percent' ? 'is-active' : ''} onClick={() => setContributionDisplay('percent')} aria-pressed={contributionDisplay === 'percent'}>% Δ</button></div></div>
          {hasDailyData ? <div className="contribution-columns"><ContributionBars title="Tailwinds" data={contributionColumns.tailwinds} positive display={contributionDisplay} formatValue={value} formatPercent={(amount) => mask(formatPercent(amount))} /><ContributionBars title="Headwinds" data={contributionColumns.headwinds} display={contributionDisplay} formatValue={value} formatPercent={(amount) => mask(formatPercent(amount))} /></div> : <div className="chart-empty">The next market refresh will show which holdings moved your portfolio.</div>}
        </section>

        <section className="panel insight-panel insight-panel--wide">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Risk and drawdown</span><span className="section-index">05 · Portfolio resilience</span></div><span className="hint">One-year current-holdings backcast{backcast ? ` · ${backcast.coveragePct.toFixed(0)}% coverage` : ''}</span></div>
          {hasHistory ? <RiskProfile current={risk.current} worst={risk.worst} volatility={risk.volatility} concentration={snapshot.topFiveWeight} hideValues={hide} /> : <div className="chart-empty">Historical prices are loading to build your risk profile.</div>}
        </section>

        <section className="panel insight-panel insight-panel--wide">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Performance story</span><span className="section-index">06 · Value vs invested capital</span></div><div className="segmented-control" aria-label="Performance history method"><button type="button" className={performanceMode === 'backcast' ? 'is-active' : ''} onClick={() => setPerformanceMode('backcast')} aria-pressed={performanceMode === 'backcast'}>Backcast</button><button type="button" className={performanceMode === 'tracked' ? 'is-active' : ''} onClick={() => setPerformanceMode('tracked')} aria-pressed={performanceMode === 'tracked'} disabled={!trackedAvailable} title={trackedAvailable ? 'Use saved daily portfolio values' : 'Available after two market-day snapshots'}>Tracked</button></div></div>
          <div className="history-method-note"><div><strong>Backcast · available now</strong><span>Applies today’s quantities to real historical closes. Useful immediately, but it cannot know past trades or cash flows.</span></div><div><strong>Tracked · {trackedAvailable ? 'available' : 'collecting'}</strong><span>Saves one verified portfolio value per market day on this device, building an observed record of the portfolio from now on.</span></div></div>
          <div className="insight-chart insight-chart--small">{performanceHistory.length >= 2 ? <InteractiveTrendChart rows={performanceHistory.map((item) => ({ at: item.at, value: item.value, invested: item.invested }))} lines={[{ key: 'value', label: 'Portfolio value', color: '#41b883' }, { key: 'invested', label: 'Invested capital', color: '#f2b53c', dashed: true }]} valueFormatter={value} yAxisLabel="Value" /> : <div className="chart-empty chart-empty--tracking"><i aria-hidden="true" /><strong>{backcastLoading ? 'Building your one-year history' : 'Historical prices are unavailable'}</strong><span>{backcastLoading ? 'Current holdings are being matched with real historical closes.' : 'Enable external market data or use tracked snapshots as they accumulate.'}</span></div>}</div>
        </section>
      </div>
    </div>
  )
}

function ExposureBars({ items, hideValues, formatValue }: { items: { label: string; value: number; weight: number }[]; hideValues: boolean; formatValue: (value: number) => string }) {
  const max = Math.max(...items.map((item) => item.value), 1)
  return <div className="exposure-bars">{items.map((item, index) => <div className="exposure-row" key={item.label}><div><span><i className="legend-swatch" style={{ background: COLORS[index % COLORS.length] }} />{item.label}</span><strong>{hideValues ? '••••' : `${item.weight.toFixed(1)}%`}</strong></div><div className="exposure-track"><span style={{ width: `${item.value / max * 100}%`, background: COLORS[index % COLORS.length] }} /></div><small>{hideValues ? '••••••' : formatValue(item.value)}</small></div>)}</div>
}

function AllocationMap({
  items,
  selected,
  onSelect,
  hideValues,
  formatValue,
}: {
  items: { symbol: string; value: number; weight: number; pnl: number | null }[]
  selected: string | null
  onSelect: (symbol: string) => void
  hideValues: boolean
  formatValue: (amount: number) => string
}) {
  const active = items.find((item) => item.symbol === selected) ?? items[0]
  return <div className="allocation-map-wrap">
    <div className="allocation-map" aria-label="Allocation treemap">
      {items.map((item) => {
        const span = Math.max(2, Math.min(12, Math.round(item.weight / 100 * 12)))
        const isActive = item.symbol === active?.symbol
        return <button key={item.symbol} type="button" className={`allocation-tile allocation-tile--${item.pnl != null && item.pnl < 0 ? 'down' : 'up'}${isActive ? ' allocation-tile--active' : ''}`} style={{ gridColumn: `span ${span}` }} onMouseEnter={() => onSelect(item.symbol)} onFocus={() => onSelect(item.symbol)} onClick={() => onSelect(item.symbol)} aria-pressed={isActive} aria-label={`${item.symbol}, ${hideValues ? 'allocation hidden' : `${item.weight.toFixed(1)}% of portfolio`}`}>
          <strong>{item.symbol}</strong><span>{hideValues ? '••••' : `${item.weight.toFixed(1)}%`}</span>
        </button>
      })}
    </div>
    {active && <div className="allocation-detail" aria-live="polite"><div><span className="score-label">Selected holding</span><strong>{active.symbol}</strong></div><div><span className="score-label">Portfolio weight</span><strong>{hideValues ? '••••' : `${active.weight.toFixed(1)}%`}</strong></div><div><span className="score-label">Current value</span><strong>{formatValue(active.value)}</strong></div><div><span className="score-label">P&L</span><strong className={active.pnl != null && active.pnl < 0 ? 'down' : 'up'}>{active.pnl == null ? '—' : formatValue(active.pnl)}</strong></div></div>}
  </div>
}

function ContributionBars({
  title,
  data,
  positive = false,
  display,
  formatValue,
  formatPercent,
}: {
  title: string
  data: { label: string; width: number; metric: number }[]
  positive?: boolean
  display: 'price' | 'percent'
  formatValue: (amount: number) => string
  formatPercent: (amount: number) => string
}) {
  const values = data.length ? data : [{ label: 'No movement', metric: 0, width: 4 }]
  return <div className="contribution-chart"><div className="contribution-title">{title}</div><div className="contribution-bars">{values.map((item) => {
    const displayValue = display === 'percent' ? formatPercent(item.metric) : formatValue(item.metric)
    return <div className="contribution-row" key={item.label}><div><span title={item.label}>{item.label}</span><strong className={positive ? 'up' : 'down'}>{displayValue}</strong></div><div className="contribution-track" aria-label={`${item.label}: ${displayValue}`}><span className={positive ? 'contribution-fill contribution-fill--up' : 'contribution-fill contribution-fill--down'} style={{ width: `${item.width}%` }} /></div></div>
  })}</div></div>
}

function RiskProfile({ current, worst, volatility, concentration, hideValues }: { current: number; worst: number; volatility: number; concentration: number; hideValues: boolean }) {
  const mask = (text: string) => hideValues ? '••••' : text
  const drawdownScale = Math.max(Math.abs(worst), 1)
  const riskRows = [
    { label: 'Distance from peak', value: Math.abs(current), width: Math.abs(current) / drawdownScale * 100, detail: current < 0 ? 'Below the latest portfolio high' : 'At the latest portfolio high', definition: 'This is the percentage the latest saved value sits below its most recent saved high. The red bar is your current recovery distance; 0% means you are at that high.', tone: 'down' },
    { label: 'Worst observed pullback', value: Math.abs(worst), width: 100, detail: 'Largest fall in the reconstructed history', definition: 'This is the biggest peak-to-trough percentage decline in the current-holdings backcast. The red bar uses that maximum as its full width, so a larger percentage means a deeper historical fall.', tone: 'down' },
    { label: 'Annualized swings', value: volatility, width: Math.min(100, volatility / 30 * 100), detail: 'How much daily returns have moved', definition: 'This estimates how widely day-to-day portfolio returns vary over a year. The blue bar is scaled to 30%; higher percentages mean less predictable movement, not a guaranteed loss.', tone: 'neutral' },
    { label: 'Top-five concentration', value: concentration, width: Math.min(100, concentration), detail: 'Share held in the five largest positions', definition: 'This is the percentage of your portfolio held in its five largest positions. The blue bar fills directly to that share; a higher percentage means those holdings have more influence.', tone: 'neutral' },
  ]
  return <div className="risk-profile"><p className="risk-summary-copy">{current < 0 ? 'Your portfolio is below its most recent high. These bars show the size of the recovery room and where concentration adds risk.' : 'Your portfolio is at its most recent high. These bars show how much past drawdowns and concentration can still matter.'}</p><div className="risk-bars">{riskRows.map((row) => <div className="risk-bar" key={row.label}><div><span className="risk-label">{row.label}<button type="button" className="risk-help" aria-label={`Explain ${row.label}`}>i<span role="tooltip">{row.definition}</span></button></span><strong className={row.tone === 'down' ? 'down' : ''}>{mask(`${row.value.toFixed(1)}%`)}</strong></div><div className="risk-track"><span className={`risk-fill risk-fill--${row.tone}`} style={{ width: `${row.width}%` }} /></div><small>{row.detail}</small></div>)}</div></div>
}
