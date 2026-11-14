import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { formatCurrency, formatPercent } from '../valuation'
import { BENCHMARKS, marketData } from '../marketData'
import type { SectorAllocation } from '../investmentWorkspace'
import { useStore } from '../useStore'
import { usePortfolioBackcast } from '../usePortfolioBackcast'
import { portfolioDataLabels } from '../portfolioDataLabels'
import { assetTypeLabel } from '../instruments'
import { dateFormatter } from '../formatters'
import { buildContributionColumns, type ContributionDisplay } from '../contributionBars'
import { InteractiveTrendChart } from './InteractiveTrendChart'
import { PortfolioWelcome } from './PortfolioWelcome'
import { HiddenValuesState } from './HiddenValuesState'
import { PortfolioAllocationMix } from './PortfolioAllocationMix'
import { SessionContributors } from './SessionContributors'
import { DitherBar } from './DitherBar'
import { rgb, seedOfColor, type DitherColor } from '../components/dither-kit/palette'
import './insights.css'
import './holdingInsights.css'
import { HoldingMarketMoves } from './HoldingMarketMoves'
import { ComparisonBuilding } from './ComparisonBuilding'
import { MarketCapExposure, type MarketCapSelection } from './MarketCapExposure'
import { holdingMovePeriod, holdingMoveToday } from '../holdingMarketMoves'

const EXPO_PALETTE: DitherColor[] = ['purple', 'green', 'blue', 'orange', 'pink', 'red', 'grey']
const BENCHMARK_REUSE_MS = 5 * 60_000

type BenchmarkPoint = { ts: number; portfolio: number; benchmark?: number }
type ExposureHighlight = { label: string; color: string; positionIds?: ReadonlySet<string> }
type ContributionRange = 'today' | 'month' | 'year' | 'custom'

export function InsightsView({ onRequestImport }: { onRequestImport: () => void }) {
  const { snapshot, settings } = useStore()
  const [contributionRange, setContributionRange] = useState<ContributionRange>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [appliedContribution, setAppliedContribution] = useState<{ range: ContributionRange; from: string }>({ range: 'today', from: '' })
  const appliedRange = appliedContribution.range
  const today = holdingMoveToday()

  function selectContributionRange(range: ContributionRange) {
    setContributionRange(range)
    if (range === 'custom') {
      setCustomFrom('')
      return
    }
    setAppliedContribution({ range, from: '' })
  }

  function changeCustomStart(value: string) {
    setCustomFrom(value)
    if (value >= '1900-01-01' && holdingMovePeriod('custom', value, today)) {
      setAppliedContribution({ range: 'custom', from: value })
    }
  }
  const [exposureMode, setExposureMode] = useState<'sector' | 'market-cap'>('sector')
  const [marketCapSelection, setMarketCapSelection] = useState<MarketCapSelection | null>(null)
  const [benchmarkId, setBenchmarkId] = useState('nifty-50')
  const selectedBenchmark = BENCHMARKS.find((item) => item.id === benchmarkId) ?? BENCHMARKS[0]
  const [benchmarkPoints, setBenchmarkPoints] = useState<{ date: string; close: number }[]>([])
  const [benchmarkLoading, setBenchmarkLoading] = useState(false)
  const [benchmarkError, setBenchmarkError] = useState(false)
  const [benchmarkReload, setBenchmarkReload] = useState(0)
  const reusableBenchmark = useRef<{ key: string; at: number; points: typeof benchmarkPoints } | null>(null)
  const [hoveredSector, setHoveredSector] = useState<string | null>(null)
  const [focusedSector, setFocusedSector] = useState<string | null>(null)
  const [contributionDisplay, setContributionDisplay] = useState<ContributionDisplay>('price')
  const [sessionExpanded, setSessionExpanded] = useState(false)
  const summaryRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!sessionExpanded) return
    const position = () => {
      const summary = summaryRef.current
      const detail = summary?.querySelector<HTMLElement>('#session-detail')
      if (!summary || !detail) return
      const box = summary.getBoundingClientRect()
      const below = window.innerHeight - box.bottom - 16
      const above = box.top - 16
      const showBelow = below >= Math.min(detail.scrollHeight, 440) || below >= above
      detail.style.top = showBelow ? 'calc(100% + 8px)' : 'auto'
      detail.style.bottom = showBelow ? 'auto' : 'calc(100% + 8px)'
      detail.style.maxHeight = `${Math.max(120, Math.min(440, showBelow ? below : above))}px`
    }
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return
      const trigger = summaryRef.current?.querySelector('#session-kpi')
      const detail = summaryRef.current?.querySelector('#session-detail')
      if (!trigger?.contains(event.target) && !detail?.contains(event.target)) {
        setSessionExpanded(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSessionExpanded(false)
      summaryRef.current?.querySelector<HTMLButtonElement>('#session-kpi')?.focus()
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    document.addEventListener('click', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      document.removeEventListener('click', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [sessionExpanded])

  const { backcast, history: backcastHistory, loading: backcastLoading, error: backcastError, retry: retryBackcast, days: backcastDays, key: backcastKey, requestMore: requestMoreBackcast } = usePortfolioBackcast({
    positions: snapshot.positions, quotes: snapshot.quotes, allowExternalData: settings.allowExternalData,
  })

  const contributionColumns = useMemo(() => buildContributionColumns(snapshot.contributions.map((item) => ({
    label: item.symbol.length > 14 ? `${item.symbol.slice(0, 13)}…` : item.symbol,
    dailyPriceChange: item.dailyPriceChange,
    dailyPriceChangePct: item.dailyPriceChangePct,
  })), contributionDisplay), [contributionDisplay, snapshot.contributions])
  const exposure = useMemo(() => snapshot.contributions.filter((item) => item.priced && item.value > 0).sort((a, b) => b.value - a.value), [snapshot.contributions])
  const unmappedExposure = useMemo(() => snapshot.contributions.filter((item) => !item.priced || item.value <= 0), [snapshot.contributions])
  const analyticsHistory = backcastHistory
  const trackedAvailable = snapshot.history.length >= 2

  useEffect(() => {
    if (!settings.hideValues) return
    setHoveredSector(null)
    setFocusedSector(null)
  }, [settings.hideValues])

  useEffect(() => {
    const symbol = selectedBenchmark.symbol
    if (!settings.allowExternalData || snapshot.positions.length === 0 || !symbol) {
      reusableBenchmark.current = null
      setBenchmarkPoints([])
      setBenchmarkError(false)
      setBenchmarkLoading(false)
      return
    }
    const requestKey = JSON.stringify([symbol, backcastDays, backcastKey, benchmarkReload])
    const cached = reusableBenchmark.current
    if (cached?.key === requestKey && Date.now() - cached.at < BENCHMARK_REUSE_MS) {
      setBenchmarkPoints(cached.points)
      setBenchmarkError(false)
      setBenchmarkLoading(false)
      return
    }
    let alive = true
    const controller = new AbortController()
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setBenchmarkPoints([])
    setBenchmarkError(false)
    setBenchmarkLoading(true)
    const to = new Date()
    const from = new Date(to.getTime() - backcastDays * 24 * 60 * 60 * 1000)
    const load = async (attempt: number) => {
      let points: typeof benchmarkPoints = []
      try {
        points = await marketData.benchmarkHistory(symbol, from, to, controller.signal)
      } catch {
        // A failed provider request can be retried while this benchmark is selected.
      }
      if (!alive) return
      if (points.length >= 2) {
        reusableBenchmark.current = { key: requestKey, at: Date.now(), points }
        setBenchmarkPoints(points)
        setBenchmarkError(false)
        setBenchmarkLoading(false)
      } else if (attempt < 2) {
        retryTimer = setTimeout(() => { void load(attempt + 1) }, attempt === 0 ? 600 : 1500)
      } else {
        reusableBenchmark.current = null
        setBenchmarkPoints([])
        setBenchmarkError(true)
        setBenchmarkLoading(false)
      }
    }
    void load(0)
    return () => {
      alive = false
      controller.abort()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [backcastDays, backcastKey, benchmarkReload, selectedBenchmark.symbol, settings.allowExternalData])

  const benchmarkSeries = useMemo<BenchmarkPoint[]>(() => {
    if (analyticsHistory.length < 2) return []
    const observedDate = (at: number) => new Date(at + 5.5 * 3600000).toISOString().slice(0, 10)
    const benchmarkCloses = new Map(benchmarkPoints.map((point) => [point.date, point.close]))
    const sharedStart = analyticsHistory.findIndex((point) => benchmarkCloses.has(observedDate(point.at)))
    const history = sharedStart > 0 ? analyticsHistory.slice(sharedStart) : analyticsHistory
    const firstPortfolio = history[0].value
    const firstBenchmark = benchmarkCloses.get(observedDate(history[0].at))
    return history.map((point) => {
      const matching = benchmarkCloses.get(observedDate(point.at))
      return {
        ts: point.at,
        portfolio: firstPortfolio > 0 ? ((point.value / firstPortfolio) - 1) * 100 : 0,
        benchmark: firstBenchmark && matching ? ((matching / firstBenchmark) - 1) * 100 : undefined,
      }
    })
  }, [analyticsHistory, benchmarkPoints])
  const latestPortfolioPoint = benchmarkSeries[benchmarkSeries.length - 1]
  const benchmarkLatest = [...benchmarkSeries].reverse().find((point) => point.benchmark != null) ?? latestPortfolioPoint
  const benchmarkGap = benchmarkLatest?.benchmark == null ? null : benchmarkLatest.portfolio - benchmarkLatest.benchmark
  const benchmarkThrough = benchmarkLatest?.benchmark != null && benchmarkLatest.ts !== latestPortfolioPoint?.ts
    ? dateFormatter({ day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(benchmarkLatest.ts)
    : null


  if (snapshot.positions.length === 0) {
    return (
      <PortfolioWelcome variant="insights" onRequestImport={onRequestImport} />
    )
  }

  const hide = settings.hideValues
  const mask = (value: string) => hide ? '••••••' : value
  const value = (amount: number) => mask(formatCurrency(amount))
  const hasDailyData = contributionColumns.tailwinds.length > 0 || contributionColumns.headwinds.length > 0
  const comparisonLoading = settings.allowExternalData && (benchmarkLoading || backcastLoading)
  const comparisonTitle = selectedBenchmark.unavailableReason ?? (!settings.allowExternalData
    ? 'External market data is off'
    : comparisonLoading ? 'Building your comparison' : 'Historical comparison unavailable')
  const comparisonDescription = selectedBenchmark.unavailableReason ? 'Choose another benchmark to start a comparison.'
    : !settings.allowExternalData ? 'Enable it in Settings to compare your portfolio with market benchmarks.'
      : comparisonLoading ? 'Loading historical closes for your holdings and the selected benchmark.'
        : trackedAvailable ? 'Tracked balances include account changes and cash flows. Investment returns need historical prices or dated transactions.'
          : 'Historical closes could not be loaded for this comparison.'
  const retryComparison = () => {
    if (backcastError) retryBackcast()
    if (benchmarkError) setBenchmarkReload((count) => count + 1)
  }
  const exposureSectors = snapshot.sectors.slice(0, 10)
  const activeSector = exposureSectors.find((sector) => sector.label === hoveredSector) ?? exposureSectors.find((sector) => sector.label === focusedSector)
  const activeSectorIndex = activeSector ? exposureSectors.indexOf(activeSector) : -1
  const exposureHighlight: ExposureHighlight | null = !hide && exposureMode === 'market-cap' && marketCapSelection ? {
    label: marketCapSelection.label,
    positionIds: new Set(marketCapSelection.positionIds),
    color: 'var(--primary-hover)',
  } : !hide && exposureMode === 'sector' && activeSectorIndex >= 0 ? {
    label: exposureSectors[activeSectorIndex].label,
    color: rgb(seedOfColor(EXPO_PALETTE[activeSectorIndex % EXPO_PALETTE.length]).fill),
  } : null
  const dataLabels = portfolioDataLabels(snapshot)
  const sessionDate = snapshot.dailyChangeDate
    ? dateFormatter({ day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${snapshot.dailyChangeDate}T00:00:00+05:30`))
    : null
  const summaryPnlUp = snapshot.pnl >= 0
  const sessionDirection = hide || dataLabels.sessionValue == null || dataLabels.sessionValue === 0 ? '' : dataLabels.sessionValue > 0 ? 'up' : 'down'

  return (
    <div className="insights-page">
      <div className="page-head insights-heading enter d0">
        <div>
          <h1 className="page-title">Insights</h1>
        </div>
        <p className="page-sub">Movement, exposure and composition across your holdings.</p>
      </div>

      {!snapshot.valuationComplete && <p className="insights-valuation-notice" role="status">{snapshot.unpricedCount} holding{snapshot.unpricedCount === 1 ? '' : 's'} unpriced. Values and P&L cover {snapshot.pricedCount} priced holdings; incomplete values are excluded from tracked history.</p>}

      <div ref={summaryRef} className="insights-overview-summary enter d1">
        <section className="insights-portfolio-summary" aria-label="Portfolio summary">
          <div className={`insights-summary-metrics${snapshot.valuationComplete ? '' : ' insights-summary-metrics--partial'}`} tabIndex={0} role="group" aria-label="Portfolio values">
          <div className="insights-summary-current">
            <span className="score-label">Current value</span>
            <div className="insights-summary-reading"><strong>{snapshot.pricedCount ? value(snapshot.currentValue) : 'Unpriced'}</strong></div>
          </div>
          <button type="button" id="session-kpi" className={`insights-summary-session${sessionExpanded ? ' is-open' : ''}`} onClick={() => setSessionExpanded((open) => !open)} aria-expanded={sessionExpanded} aria-controls="session-detail">
            <span className="insights-summary-session-label"><span>Session move</span><i className="insights-summary-chevron" aria-hidden="true" /></span>
            <span className="insights-summary-reading">
              <strong className={sessionDirection}>{mask(dataLabels.sessionValue == null ? 'Unavailable' : `${dataLabels.sessionValue >= 0 ? '+' : ''}${formatCurrency(dataLabels.sessionValue)}`)}</strong>
              <span className={`hint${snapshot.dailyChangePct != null && sessionDirection ? ` ${sessionDirection}` : ''}`}>{hide ? 'Values hidden' : snapshot.dailyChangePct != null ? formatPercent(snapshot.dailyChangePct) : dataLabels.sessionValue == null ? 'Awaiting updates' : 'Reported change'}</span>
            </span>
          </button>
          <div className="insights-summary-invested">
            <span className="score-label">Invested</span>
            <div className="insights-summary-reading"><strong>{value(snapshot.invested)}</strong></div>
          </div>
          <div className="insights-summary-pnl">
            <span className="score-label">{snapshot.valuationComplete ? 'Unrealized P&L' : 'Priced holdings P&L'}</span>
            <div className="insights-summary-reading">
              <strong className={!hide && snapshot.pricedCount ? summaryPnlUp ? 'up' : 'down' : ''}>{snapshot.pricedCount ? mask(`${summaryPnlUp ? '+' : ''}${formatCurrency(snapshot.pnl)}`) : 'Unpriced'}</strong>
              <small className={!hide && snapshot.pricedCount ? summaryPnlUp ? 'up' : 'down' : ''}>{snapshot.pricedCount ? mask(formatPercent(snapshot.pnlPct)) : 'Unavailable'}{!snapshot.valuationComplete && <span> on priced cost</span>}</small>
            </div>
          </div>
          </div>
          <div className="insights-summary-context">
            {hide ? 'Session details hidden' : <><span>{dataLabels.isPartialSession ? 'Partial session' : 'Session'}{sessionDate && <> · {sessionDate}</>}</span><span>{dataLabels.coverageLabel}</span></>}
          </div>
        </section>
        {sessionExpanded && <div className="insights-summary-detail" id="session-detail" role="region" aria-labelledby="session-kpi">
          {hide ? <HiddenValuesState /> : <SessionContributors snapshot={snapshot} formatValue={value} compact />}
        </div>}
      </div>

      <div className="insight-grid enter d2">
        <section className="panel insight-panel insight-panel--wide insight-panel--benchmark chart-open">
          <div className="performance-panel-header"><span className="panel-title">Market comparison</span>
              <details className="benchmark-menu">
                <summary aria-label={`Compare with ${selectedBenchmark.label}. Choose a benchmark`}>
                  <span>Compare with</span>{' '}
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
          <div className="performance-comparison">
          {hide ? <HiddenValuesState /> : <>
          {benchmarkSeries.length >= 2 && <div className="insight-chart-readout">
            <div className="insight-chart-metric insight-chart-metric--portfolio">
              <span><i aria-hidden="true" />Portfolio</span>
              <strong>{benchmarkLatest ? mask(`${benchmarkLatest.portfolio >= 0 ? '+' : ''}${benchmarkLatest.portfolio.toFixed(1)}%`) : '—'}</strong>
              <small>{benchmarkThrough ? `Compared through ${benchmarkThrough}` : 'Current holdings since comparison start'}</small>
            </div>
            <div className="insight-chart-metric insight-chart-metric--benchmark">
              <span><i aria-hidden="true" />{selectedBenchmark.label}</span>
              <strong>{benchmarkLatest?.benchmark == null ? '—' : mask(`${benchmarkLatest.benchmark >= 0 ? '+' : ''}${benchmarkLatest.benchmark.toFixed(1)}%`)}</strong>
              <small>Matching observation dates</small>
            </div>
            <div className="insight-chart-metric insight-chart-metric--gap">
              <span>Return gap</span>
              <strong className={hide || benchmarkGap == null ? '' : benchmarkGap >= 0 ? 'up' : 'down'}>{benchmarkGap == null ? '—' : mask(`${benchmarkGap >= 0 ? '+' : ''}${benchmarkGap.toFixed(1)} pts`)}</strong>
              <small>{hide ? 'Comparison hidden' : benchmarkGap == null ? 'Waiting for benchmark' : benchmarkGap >= 0 ? 'Portfolio leads' : `${selectedBenchmark.label} leads`}</small>
            </div>
          </div>}
          <div className="insight-chart insight-chart--benchmark">
            {benchmarkSeries.length >= 2 ? (
              <InteractiveTrendChart
                key={benchmarkId}
                rows={benchmarkSeries.map((item) => ({ at: item.ts, portfolio: item.portfolio, benchmark: item.benchmark }))}
                lines={[{ key: 'portfolio', label: 'Portfolio', color: 'var(--chart-portfolio)' }, { key: 'benchmark', label: selectedBenchmark.label, color: 'var(--chart-benchmark)', connectGaps: true }]}
                valueFormatter={(amount) => mask(`${amount >= 0 ? '+' : ''}${amount.toFixed(1)}%`)}
                differenceFormatter={(amount) => mask(`${amount >= 0 ? '+' : ''}${amount.toFixed(1)} pts`)}
                differenceLabel="Return gap"
                yAxisLabel="Return (%)"
                includeZero
                appearance="insight"
                onReachStart={backcast ? requestMoreBackcast : undefined}
              />
            ) : <div className="chart-empty chart-empty--tracking"><ComparisonBuilding loading={comparisonLoading} /><strong>{comparisonTitle}</strong><span>{comparisonDescription}</span></div>}
          </div>
          <span className="hint insight-chart-footnote">{selectedBenchmark.unavailableReason ?? (!settings.allowExternalData ? 'External market data is off' : comparisonLoading ? 'Building the historical comparison…' : benchmarkError || backcastError ? <>{benchmarkError ? `Could not load ${selectedBenchmark.label} history.` : 'Historical portfolio prices are unavailable.'} <button type="button" className="benchmark-retry" onClick={retryComparison}>Retry</button></> : backcastHistory.length >= 2 && backcast ? `Current-holdings backcast · ${mask(`${backcast.coveragePct.toFixed(0)}%`)} priced INR value coverage · shared dates` : 'Historical market data is unavailable')}</span>
          </>}
          </div>
        </section>

        <section className="panel insight-panel insight-panel--allocation">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Allocation treemap</span><span className="section-index"></span></div></div>
          <AllocationMap items={exposure} unmapped={unmappedExposure} formatValue={value} highlight={exposureHighlight} hideValues={hide} />
        </section>

        <section className="panel insight-panel insight-panel--exposure">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Exposure mix</span><span className="section-index">Sectors</span></div></div>
          <div className="segmented-control exposure-mode" role="group" aria-label="Exposure view"><button type="button" className={exposureMode === 'sector' ? 'is-active' : ''} aria-pressed={exposureMode === 'sector'} onClick={() => setExposureMode('sector')}>Sectors</button><button type="button" className={exposureMode === 'market-cap' ? 'is-active' : ''} aria-pressed={exposureMode === 'market-cap'} onClick={() => { setExposureMode('market-cap'); setHoveredSector(null); setFocusedSector(null) }}>Market cap</button></div>
          {hide ? <HiddenValuesState /> : <>
            {exposureMode === 'sector' && <ExposureMix items={exposureSectors} formatValue={value} activeLabel={exposureHighlight?.label ?? null} onHover={setHoveredSector} onFocus={setFocusedSector} />}
            <div hidden={exposureMode !== 'market-cap'}>
              <MarketCapExposure positions={snapshot.positions} quotes={snapshot.quotes} hideValues={hide} active={exposureMode === 'market-cap'} allowExternalData={settings.allowExternalData} onHighlight={setMarketCapSelection} />
            </div>
          </>}
        </section>

        <section className="panel insight-panel insight-panel--wide">
          <div className="panel-head market-contribution-head"><div className="panel-head-titles"><span className="panel-title">{appliedRange === 'today' ? 'Latest price movers' : 'Market contribution'}</span><span className="section-index">{appliedRange === 'today' ? 'Holding price changes' : 'Current holdings at market prices'}</span></div>{appliedRange === 'today' && <div className="segmented-control" aria-label="Mover display"><button type="button" className={contributionDisplay === 'price' ? 'is-active' : ''} onClick={() => setContributionDisplay('price')} aria-pressed={contributionDisplay === 'price'}>Price Δ</button><button type="button" className={contributionDisplay === 'percent' ? 'is-active' : ''} onClick={() => setContributionDisplay('percent')} aria-pressed={contributionDisplay === 'percent'}>% Δ</button></div>}<div className="performance-controls contribution-period-control"><label><span className="sr-only">Period</span><select aria-label="Return contribution period" value={contributionRange} onChange={(event) => selectContributionRange(event.target.value as ContributionRange)}><option value="today">Today</option><option value="month">This month</option><option value="year">This year</option><option value="custom">Custom</option></select></label>{contributionRange === 'custom' && <label className="contribution-date-control"><span>From</span><input type="date" aria-label="Contribution start date" min="1900-01-01" max={today} value={customFrom} onChange={(event) => changeCustomStart(event.target.value)} /></label>}</div></div>
          {!hide && appliedRange === 'today' && <p className="hint">{dataLabels.sessionLabel} · {dataLabels.coverageLabel}. Bars show each holding's price change.</p>}
          {hide ? <HiddenValuesState /> : appliedRange !== 'today' ? <HoldingMarketMoves positions={snapshot.positions} quotes={snapshot.quotes} range={appliedRange} customFrom={appliedContribution.from} allowExternalData={settings.allowExternalData} /> : hasDailyData ? <div className="contribution-columns"><ContributionBars title="Tailwinds" data={contributionColumns.tailwinds} positive display={contributionDisplay} formatValue={value} formatPercent={(amount) => mask(formatPercent(amount))} /><ContributionBars title="Headwinds" data={contributionColumns.headwinds} display={contributionDisplay} formatValue={value} formatPercent={(amount) => mask(formatPercent(amount))} /></div> : <div className="chart-empty contributor-empty">{settings.allowExternalData ? 'No price changes reported for this measure. Refresh quotes to try again.' : 'Enable external market data in Settings to see holding-level price changes.'}</div>}
        </section>

        <PortfolioAllocationMix />
      </div>
    </div>
  )
}

function ExposureMix({ items, formatValue, activeLabel, onHover, onFocus }: {
  items: SectorAllocation[]
  formatValue: (value: number) => string
  activeLabel: string | null
  onHover: (label: string | null) => void
  onFocus: (label: string | null) => void
}) {
  const active = items.findIndex((sector) => sector.label === activeLabel)
  if (items.length === 0 || items.every((item) => item.value <= 0)) {
    return <div className="expo-empty muted">No valued exposure yet.</div>
  }
  return (
    <div className="expo-mix" aria-label="Exposure mix by sector and type">
      <div className="expo-ribbon" aria-hidden="true">
        {items.map((sector, index) => (
          <div
            key={sector.label}
            className={`expo-seg${active === index ? ' is-active' : active >= 0 ? ' is-dim' : ''}`}
            style={{ flexGrow: Math.max(sector.value, 1), background: rgb(seedOfColor(EXPO_PALETTE[index % EXPO_PALETTE.length]).fill) }}
            onMouseEnter={() => onHover(sector.label)}
            onMouseLeave={() => onHover(null)}
          />
        ))}
      </div>
      <div className="expo-list">
        {items.map((sector, index) => {
          const color = EXPO_PALETTE[index % EXPO_PALETTE.length]
          const type = sector.type === 'mixed' ? 'Mixed' : assetTypeLabel(sector.type)
          const positionLabel = `${sector.count} ${sector.count === 1 ? 'position' : 'positions'}`
          const context = sector.label.toLowerCase() === type.toLowerCase() ? positionLabel : `${type} · ${positionLabel}`
          return (
            <button
              key={sector.label}
              type="button"
              className={`expo-row${active === index ? ' is-active' : ''}`}
              onMouseEnter={() => onHover(sector.label)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onFocus(sector.label)}
              onBlur={() => onFocus(null)}
              onClick={() => onFocus(sector.label)}
              aria-pressed={active === index}
              aria-label={`${sector.label} ${sector.weight.toFixed(1)}% ${context} ${formatValue(sector.value)}`}
            >
              <span className="expo-identity">
                <i className="legend-swatch" style={{ background: rgb(seedOfColor(color).fill) }} />
                <span className="expo-name" title={sector.label}>{sector.label}</span>
              </span>{' '}
              <span className="expo-weight">{sector.weight.toFixed(1)}%</span>{' '}
              <span className="expo-value">{formatValue(sector.value)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

type AllocationItem = { id: string; symbol: string; value: number; weight: number; pnl: number | null; sector: string }
const ALLOCATION_PAGE_SIZE = 25

function matchesExposure(item: AllocationItem, highlight: ExposureHighlight): boolean {
  return highlight.positionIds ? highlight.positionIds.has(item.id) : item.sector === highlight.label
}

const AllocationTile = memo(function AllocationTile({ item, active, highlight, onSelect }: {
  item: AllocationItem
  active: boolean
  highlight: ExposureHighlight | null
  onSelect: (id: string) => void
}) {
  const widthPercent = Math.max(2, Math.min(12, Math.round(item.weight / 100 * 12))) / 12 * 100
  const matchesHighlight = highlight && matchesExposure(item, highlight)
  const exposureClass = !highlight ? '' : matchesHighlight ? ' allocation-tile--exposure-match' : ' allocation-tile--exposure-muted'
  const tone = item.pnl == null ? 'neutral' : item.pnl < 0 ? 'negative' : 'positive'
  return <button type="button" className={`allocation-tile allocation-tile--${tone}${active ? ' allocation-tile--active' : ''}${exposureClass}`} style={{ flexBasis: `max(110px, calc(${widthPercent}% - 4px))` }} onMouseEnter={() => onSelect(item.id)} onFocus={() => onSelect(item.id)} onClick={() => onSelect(item.id)} aria-pressed={active} aria-label={`${item.symbol} ${item.weight.toFixed(1)}% of portfolio, ${item.sector}`} title={item.symbol}>
    <strong>{item.symbol}</strong>{' '}<span>{item.weight.toFixed(1)}%</span>
  </button>
})

function AllocationMap({
  items,
  unmapped,
  formatValue,
  highlight,
  hideValues,
}: {
  items: AllocationItem[]
  unmapped: { id: string; symbol: string; priced: boolean }[]
  formatValue: (amount: number) => string
  highlight: ExposureHighlight | null
  hideValues: boolean
}) {
  const [selected, onSelect] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / ALLOCATION_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const start = currentPage * ALLOCATION_PAGE_SIZE
  const visibleItems = items.slice(start, start + ALLOCATION_PAGE_SIZE)
  useEffect(() => { setPage((current) => Math.min(current, pageCount - 1)) }, [pageCount])
  if (hideValues) return <HiddenValuesState />
  const active = visibleItems.find((item) => item.id === selected) ?? visibleItems[0]
  const members = highlight ? items.filter((item) => matchesExposure(item, highlight)) : []
  const detail = highlight ? {
    symbol: highlight.label,
    weight: members.reduce((sum, item) => sum + item.weight, 0),
    value: members.reduce((sum, item) => sum + item.value, 0),
    pnl: members.reduce<number | null>((sum, item) => sum == null || item.pnl == null ? null : sum + item.pnl, 0),
  } : active
  return <div className="allocation-map-wrap" style={highlight ? { '--exposure-highlight': highlight.color } as CSSProperties : undefined}>
    <div className="allocation-map" aria-label="Allocation treemap">
      {visibleItems.map((item) => <AllocationTile key={item.id} item={item} active={item.id === active?.id} highlight={highlight} onSelect={onSelect} />)}
    </div>
    {items.length > ALLOCATION_PAGE_SIZE && <nav className="ledger-pagination allocation-pagination" aria-label="Allocation treemap pages">
      <span aria-live="polite">{start + 1}–{Math.min(start + ALLOCATION_PAGE_SIZE, items.length)} of {items.length}</span>
      <div><button className="btn btn--secondary" type="button" aria-label="Previous allocation page" disabled={currentPage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button><button className="btn btn--secondary" type="button" aria-label="Next allocation page" disabled={currentPage === pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button></div>
    </nav>}
    {unmapped.length > 0 && <div className="allocation-unmapped">
      <span className="score-label">Outside treemap</span>
      <ul>{unmapped.map((item) => <li key={item.id}><strong>{item.symbol}</strong><span>{item.priced ? 'No positive value' : 'Unpriced'}</span></li>)}</ul>
    </div>}
    {detail && <div className="allocation-detail" aria-live="polite"><div><span className="score-label">{highlight ? 'Selected group' : 'Selected holding'}</span><strong>{detail.symbol}</strong></div><div><span className="score-label">Portfolio weight</span><strong>{detail.weight.toFixed(1)}%</strong></div><div><span className="score-label">Current value</span><strong>{formatValue(detail.value)}</strong></div><div><span className="score-label">P&L</span><strong className={detail.pnl == null ? undefined : detail.pnl < 0 ? 'down' : 'up'}>{detail.pnl == null ? '—' : formatValue(detail.pnl)}</strong></div></div>}
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
  return <div className="contribution-chart"><div className="contribution-title">{title}</div><div className="contribution-bars">{data.length === 0 && <span className="hint">No reported {positive ? 'gains' : 'declines'}.</span>}{data.map((item) => {
    const displayValue = display === 'percent' ? formatPercent(item.metric) : formatValue(item.metric)
    return <div className="contribution-row" key={item.label} tabIndex={0} role="img" aria-label={`${item.label}: ${displayValue}`}>
      <div><span title={item.label}>{item.label}</span><strong className={positive ? 'up' : 'down'}>{displayValue}</strong></div>
      <DitherBar className="contribution-track" segments={[{ value: item.width, color: positive ? 'green' : 'red' }]} scale={100} />
    </div>
  })}</div></div>
}
