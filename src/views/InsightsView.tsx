import { useEffect, useMemo, useState } from 'react'
import { formatCurrency, formatPercent } from '../valuation'
import { BENCHMARKS, marketData } from '../marketData'
import type { SectorAllocation } from '../investmentWorkspace'
import { buildPortfolioBackcast, type PortfolioBackcast } from '../portfolioBackcast'
import { downsampleSeries } from '../timeSeries'
import { useStore } from '../useStore'
import { assetTypeLabel } from '../instruments'
import { buildContributionColumns, type ContributionDisplay } from '../contributionBars'
import { InteractiveTrendChart } from './InteractiveTrendChart'

// Same muted family as the overview allocation card so charts read as one system.
const EXPO_PALETTE = ['#7c89e8', '#5fae9b', '#d0a35c', '#c97b84', '#6aa9c9', '#a685c9', '#96b862', '#8a93a6']
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' })
const MAX_CHART_POINTS = 180
const INITIAL_BACKCAST_DAYS = 366
const BACKCAST_PAGE_DAYS = 366
const MAX_BACKCAST_DAYS = 3 * 366

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
  const [backcastDays, setBackcastDays] = useState(INITIAL_BACKCAST_DAYS)
  const [performanceMode, setPerformanceMode] = useState<'backcast' | 'tracked'>('backcast')
  const backcastKey = useMemo(
    () => snapshot.positions.map((position) => `${position.id}:${position.quantity}:${position.buyPrice}`).join('|'),
    [snapshot.positions],
  )

  useEffect(() => {
    if (!settings.allowExternalData || snapshot.positions.length === 0) {
      setBackcast(null)
      setBackcastDays(INITIAL_BACKCAST_DAYS)
      return
    }
    let alive = true
    setBackcastLoading(true)
    void buildPortfolioBackcast(snapshot.positions, snapshot.quotes, marketData, backcastDays).then((result) => {
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
  }, [backcastDays, backcastKey, settings.allowExternalData])

  const requestMoreBackcast = () => {
    if (backcastLoading || backcastDays >= MAX_BACKCAST_DAYS) return
    setBackcastDays((current) => Math.min(MAX_BACKCAST_DAYS, current + BACKCAST_PAGE_DAYS))
  }

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
          <div className="panel-head">
            <div className="panel-head-titles">
              <span className="panel-title">Benchmark race</span>
              <details className="benchmark-menu">
                <summary aria-label={`Portfolio compared with ${selectedBenchmark.label}. Choose a benchmark`}>
                  <span>01 · Portfolio vs</span>
                  <strong>{selectedBenchmark.label}</strong>
                  <i aria-hidden="true" />
                </summary>
                <div className="benchmark-menu-popover">
                  {(['India', 'Global'] as const).map((region) => (
                    <div className="benchmark-menu-group" key={region}>
                      <span>{region}</span>
                      {BENCHMARKS.filter((item) => item.region === region).map((item) => (
                        <button
                          type="button"
                          className={item.id === benchmarkId ? 'is-selected' : ''}
                          aria-current={item.id === benchmarkId ? 'true' : undefined}
                          key={item.id}
                          onClick={(event) => {
                            setBenchmarkId(item.id)
                            event.currentTarget.closest('details')?.removeAttribute('open')
                          }}
                        >
                          <span>{item.label}</span>
                          <small>{item.unavailableReason ? 'Unavailable' : item.id === benchmarkId ? 'Selected' : ''}</small>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
          <span className="hint">{selectedBenchmark.unavailableReason ?? (benchmarkError ? `Could not load ${selectedBenchmark.label} history` : benchmarkLoading || backcastLoading ? 'Building the historical comparison…' : backcast ? `Current-holdings backcast · ${backcast.coveragePct.toFixed(0)}% value coverage` : 'Historical market data is unavailable')}</span>
          <div className="insight-chart">
            {benchmarkSeries.length >= 2 ? <InteractiveTrendChart rows={benchmarkSeries.map((item) => ({ at: item.ts, portfolio: item.portfolio, benchmark: item.benchmark }))} lines={[{ key: 'portfolio', label: 'Portfolio', color: '#5e6ad2' }, { key: 'benchmark', label: selectedBenchmark.label, color: '#f2b53c' }]} valueFormatter={(amount) => mask(`${amount >= 0 ? '+' : ''}${amount.toFixed(1)}%`)} yAxisLabel="Return (%)" includeZero onReachStart={backcast ? requestMoreBackcast : undefined} /> : <div className="chart-empty chart-empty--tracking"><i aria-hidden="true" /><strong>{selectedBenchmark.unavailableReason ?? (settings.allowExternalData ? 'Building your comparison' : 'External market data is off')}</strong><span>{selectedBenchmark.unavailableReason ? 'Choose another benchmark to start a comparison.' : settings.allowExternalData ? 'The app is reconstructing today’s holdings against real historical closes.' : 'Enable it in Settings to compare your portfolio with market benchmarks.'}</span></div>}
          </div>
        </section>

        <section className="panel insight-panel">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Allocation treemap</span><span className="section-index">02 · Exposure</span></div></div>
          <AllocationMap items={exposure} selected={selectedExposure?.symbol ?? null} onSelect={setSelectedExposureSymbol} hideValues={hide} formatValue={value} />
        </section>

        <section className="panel insight-panel insight-panel--exposure">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Exposure mix</span><span className="section-index">03 · Sectors / type</span></div></div>
          <ExposureMix items={snapshot.sectors.slice(0, 10)} hideValues={hide} formatValue={value} />
        </section>

        <section className="panel insight-panel insight-panel--wide">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">What moved today?</span><span className="section-index">04 · Contribution waterfall</span></div><div className="segmented-control" aria-label="Mover display"><button type="button" className={contributionDisplay === 'price' ? 'is-active' : ''} onClick={() => setContributionDisplay('price')} aria-pressed={contributionDisplay === 'price'}>Price Δ</button><button type="button" className={contributionDisplay === 'percent' ? 'is-active' : ''} onClick={() => setContributionDisplay('percent')} aria-pressed={contributionDisplay === 'percent'}>% Δ</button></div></div>
          {hasDailyData ? <div className="contribution-columns"><ContributionBars title="Tailwinds" data={contributionColumns.tailwinds} positive display={contributionDisplay} formatValue={value} formatPercent={(amount) => mask(formatPercent(amount))} /><ContributionBars title="Headwinds" data={contributionColumns.headwinds} display={contributionDisplay} formatValue={value} formatPercent={(amount) => mask(formatPercent(amount))} /></div> : <div className="chart-empty">The next market refresh will show which holdings moved your portfolio.</div>}
        </section>

        <section className="panel insight-panel insight-panel--wide">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Portfolio risk checks</span><span className="section-index">05 · Lower is safer</span></div><span className="hint">Uses today's quantities with past prices{backcast ? ` · ${backcast.coveragePct.toFixed(0)}% price coverage` : ''}</span></div>
          {hasHistory ? <RiskProfile current={risk.current} worst={risk.worst} volatility={risk.volatility} concentration={snapshot.topFiveWeight} hideValues={hide} /> : <div className="chart-empty">Historical prices are loading to build your risk profile.</div>}
        </section>

        <section className="panel insight-panel insight-panel--wide">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Performance story</span><span className="section-index">06 · Value vs invested capital</span></div><div className="segmented-control" aria-label="Performance history method"><button type="button" className={performanceMode === 'backcast' ? 'is-active' : ''} onClick={() => setPerformanceMode('backcast')} aria-pressed={performanceMode === 'backcast'}>Backcast</button><button type="button" className={performanceMode === 'tracked' ? 'is-active' : ''} onClick={() => setPerformanceMode('tracked')} aria-pressed={performanceMode === 'tracked'} disabled={!trackedAvailable} title={trackedAvailable ? 'Use saved daily portfolio values' : 'Available after two market-day snapshots'}>Tracked</button></div></div>
          <div className="history-method-note"><div><strong>Backcast · available now</strong><span>Applies today’s quantities to real historical closes. Useful immediately, but it cannot know past trades or cash flows.</span></div><div><strong>Tracked · {trackedAvailable ? 'available' : 'collecting'}</strong><span>Saves one verified portfolio value per market day on this device, building an observed record of the portfolio from now on.</span></div></div>
          <div className="insight-chart insight-chart--small">{performanceHistory.length >= 2 ? <InteractiveTrendChart rows={performanceHistory.map((item) => ({ at: item.at, value: item.value, invested: item.invested }))} lines={[{ key: 'value', label: 'Portfolio value', color: '#41b883' }, { key: 'invested', label: 'Invested capital', color: '#f2b53c', dashed: true }]} valueFormatter={value} yAxisLabel="Value" onReachStart={performanceMode === 'backcast' && backcast ? requestMoreBackcast : undefined} /> : <div className="chart-empty chart-empty--tracking"><i aria-hidden="true" /><strong>{backcastLoading ? 'Building your historical series' : 'Historical prices are unavailable'}</strong><span>{backcastLoading ? 'Current holdings are being matched with real historical closes.' : 'Enable external market data or use tracked snapshots as they accumulate.'}</span></div>}</div>
        </section>
      </div>
    </div>
  )
}

/** Exposure mix: one proportional ribbon plus interactive sector tiles. Both
 *  surfaces share a single hover state, so pointing at a tile lights its ribbon
 *  segment and vice versa — no separate legend repeating the same rows. */
function ExposureMix({ items, hideValues, formatValue }: { items: SectorAllocation[]; hideValues: boolean; formatValue: (value: number) => string }) {
  const [active, setActive] = useState<number | null>(null)
  const mask = (text: string) => (hideValues ? '••••••' : text)
  if (items.length === 0 || items.every((item) => item.value <= 0)) {
    return <div className="expo-empty muted">No valued exposure yet.</div>
  }
  const max = Math.max(...items.map((item) => item.value), 1)

  return (
    <div className="expo-mix" aria-label="Exposure mix by sector and type">
      <div className="expo-ribbon" aria-hidden="true">
        {items.map((sector, index) => (
          <i
            key={sector.label}
            className={`expo-seg${active === index ? ' is-active' : active != null ? ' is-dim' : ''}`}
            style={{ flexGrow: Math.max(sector.value, 1), background: EXPO_PALETTE[index % EXPO_PALETTE.length] }}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(null)}
          />
        ))}
      </div>
      <div className="expo-grid">
        {items.map((sector, index) => {
          const color = EXPO_PALETTE[index % EXPO_PALETTE.length]
          const type = sector.type === 'mixed' ? 'Mixed' : assetTypeLabel(sector.type)
          return (
            <button
              key={sector.label}
              type="button"
              className={`expo-tile${active === index ? ' is-active' : active != null ? ' is-dim' : ''}`}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              aria-pressed={active === index}
              aria-label={`${sector.label}: ${hideValues ? 'weight hidden' : `${sector.weight.toFixed(1)}%`}, ${hideValues ? 'value hidden' : formatValue(sector.value)}, ${sector.count} ${sector.count === 1 ? 'position' : 'positions'}`}
            >
              <span className="expo-tile-head">
                <i className="legend-swatch" style={{ background: color }} />
                <span className="expo-name" title={sector.label}>{sector.label}</span>
                <span className="expo-type">{type}</span>
              </span>
              <strong className="expo-weight">{mask(`${sector.weight.toFixed(1)}%`)}</strong>
              <span className="expo-meta">{mask(formatValue(sector.value))} · {sector.count} {sector.count === 1 ? 'position' : 'positions'}</span>
              <span className="expo-tile-track"><i style={{ width: `${(sector.value / max) * 100}%`, background: color }} /></span>
            </button>
          )
        })}
      </div>
    </div>
  )
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

type RiskStatus = 'lower' | 'watch' | 'high'

function riskStatus(value: number, watchAt: number, highAt: number): RiskStatus {
  if (value >= highAt) return 'high'
  if (value >= watchAt) return 'watch'
  return 'lower'
}

function RiskProfile({ current, worst, volatility, concentration, hideValues }: { current: number; worst: number; volatility: number; concentration: number; hideValues: boolean }) {
  const [openDefinition, setOpenDefinition] = useState<string | null>(null)
  const mask = (text: string) => hideValues ? '••••' : text
  const riskRows = [
    {
      id: 'below-high',
      label: 'Below latest high',
      value: Math.abs(current),
      description: 'How far the latest portfolio value sits below its latest high.',
      scaleMax: 30,
      watchAt: 10,
      highAt: 20,
      formula: 'Value = (latest high - latest value) ÷ latest high × 100.',
      definition: 'The app compares the latest reconstructed portfolio value with the highest value reached before it. A value of 0% means the portfolio is at that high. The bar uses a fixed 0% to 30% scale, and values above 30% fill the bar.',
    },
    {
      id: 'largest-drop',
      label: 'Largest past drop',
      value: Math.abs(worst),
      description: 'The biggest fall from a high to a later low in this history.',
      scaleMax: 30,
      watchAt: 10,
      highAt: 20,
      formula: 'Value = largest (earlier high - later low) ÷ earlier high × 100.',
      definition: 'The app checks every reconstructed day against the highest value reached before it, then keeps the largest fall. The bar uses a fixed 0% to 30% scale, so it no longer appears full just because it is the worst fall in this portfolio.',
    },
    {
      id: 'yearly-movement',
      label: 'Yearly ups and downs',
      value: volatility,
      description: 'An estimate of how widely portfolio returns vary over a year.',
      scaleMax: 40,
      watchAt: 15,
      highAt: 25,
      formula: 'Value = daily return standard deviation × √252 × 100.',
      definition: 'The app calculates each day-to-day percentage return, finds their sample standard deviation, and annualizes it using 252 trading days. The bar uses a fixed 0% to 40% scale. This measures variation, not the chance of losing money.',
    },
    {
      id: 'top-five-share',
      label: 'Held in 5 largest positions',
      value: concentration,
      description: 'How much of the portfolio depends on its five biggest holdings.',
      scaleMax: 100,
      watchAt: 50,
      highAt: 75,
      formula: 'Value = five largest position values ÷ total portfolio value × 100.',
      definition: 'The app sorts positions by current value, adds the largest five, and divides that total by the full portfolio value. The bar is a direct 0% to 100% scale. If the portfolio has five or fewer positions, this value will be 100%.',
    },
  ].map((row) => ({
    ...row,
    width: Math.min(100, (row.value / row.scaleMax) * 100),
    status: riskStatus(row.value, row.watchAt, row.highAt),
  }))

  return (
    <div className="risk-profile">
      <div className="risk-read-guide">
        <div>
          <strong>How to read these bars</strong>
          <span>A longer bar means more risk on that row. Each row has its own fixed scale, printed below it.</span>
        </div>
        <div className="risk-guide-key" aria-label="Risk range key">
          <span className="risk-guide-key--lower">Lower concern</span>
          <span className="risk-guide-key--watch">Watch</span>
          <span className="risk-guide-key--high">High concern</span>
        </div>
        <small>These ranges are a Finverse screening guide, not a personal recommendation. Your goal, time horizon, and tolerance for loss still matter.</small>
      </div>

      <div className="risk-bars">
        {riskRows.map((row) => {
          const tooltipId = `risk-definition-${row.id}`
          const isOpen = openDefinition === row.id
          const fillPercent = Math.min(100, (row.value / row.scaleMax) * 100)
          const statusLabel = row.status === 'lower' ? 'Lower concern' : row.status === 'watch' ? 'Watch' : 'High concern'
          const displayedStatus = hideValues ? 'hidden' : row.status
          return (
            <article className={`risk-bar risk-bar--${displayedStatus}`} key={row.id}>
              <div className="risk-bar-head">
                <div>
                  <span className="risk-label">
                    {row.label}
                    <button
                      type="button"
                      className="risk-help"
                      aria-label={`Explain how ${row.label} is calculated and rated`}
                      aria-expanded={isOpen}
                      aria-controls={tooltipId}
                      onClick={() => setOpenDefinition(isOpen ? null : row.id)}
                    >
                      i
                      <span id={tooltipId} role="tooltip" className="risk-help-popover">
                        <strong>Calculation</strong>
                        {row.formula}
                        <strong>How to read it</strong>
                        {row.definition}
                      </span>
                    </button>
                  </span>
                  <span className="risk-description">{row.description}</span>
                </div>
                <div className="risk-reading">
                  <strong>{mask(`${row.value.toFixed(1)}%`)}</strong>
                  <span className={`risk-status risk-status--${displayedStatus}`}>{hideValues ? 'Hidden' : statusLabel}</span>
                </div>
              </div>

              <div className="risk-track" aria-label={hideValues ? `${row.label}: hidden` : `${row.label}: ${row.value.toFixed(1)}%, ${statusLabel}`}>
                <span className={`risk-fill risk-fill--${displayedStatus}`} style={{ width: hideValues ? 0 : `${row.width}%` }} />
              </div>

              <div
                className="risk-ranges"
                style={{ gridTemplateColumns: `${row.watchAt}fr ${row.highAt - row.watchAt}fr ${row.scaleMax - row.highAt}fr` }}
                aria-label={`Lower concern below ${row.watchAt}%, watch from ${row.watchAt}% to ${row.highAt}%, high concern above ${row.highAt}%`}
              >
                <span className="risk-range--lower">Lower<br />Under {row.watchAt}%</span>
                <span className="risk-range--watch">Watch<br />{row.watchAt} to under {row.highAt}%</span>
                <span className="risk-range--high">High<br />{row.highAt}%+</span>
              </div>

              <p className="risk-bar-calculation">
                <strong>Bar length</strong>{' '}
                {hideValues ? 'Hidden in peek mode.' : `${row.value.toFixed(1)}% ÷ ${row.scaleMax}% scale = ${fillPercent.toFixed(0)}% of the bar${row.value > row.scaleMax ? ', capped at 100%' : ''}.`}
              </p>
              <p className="risk-formula"><strong>Value calculation</strong>{' '}{row.formula}</p>
            </article>
          )
        })}
      </div>
    </div>
  )
}
