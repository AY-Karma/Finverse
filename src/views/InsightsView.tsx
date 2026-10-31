import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { formatCurrency, formatPercent } from '../valuation'
import { BENCHMARKS, marketData } from '../marketData'
import type { SectorAllocation } from '../investmentWorkspace'
import { calculatePortfolioRisk } from '../portfolioRisk'
import { useStore } from '../useStore'
import { usePortfolioBackcast } from '../usePortfolioBackcast'
import { portfolioDataLabels } from '../portfolioDataLabels'
import { assetTypeLabel } from '../instruments'
import { dateFormatter, numberFormatter } from '../formatters'
import { buildContributionColumns, type ContributionDisplay } from '../contributionBars'
import { InteractiveTrendChart } from './InteractiveTrendChart'
import { PortfolioWelcome } from './PortfolioWelcome'
import { HiddenValuesState } from './HiddenValuesState'
import { SessionContributors } from './SessionContributors'
import { WorstDrawdownChart } from './WorstDrawdownChart'
import { DataHealthGuide, dataHealthColor } from './DataHealthGuide'
import { DitherBar } from './DitherBar'
import { rgb, seedOfColor, type DitherColor } from '../components/dither-kit/palette'
import './insights.css'

const HistoryPanel = lazy(() => import('./HistoryPanel').then((module) => ({ default: module.HistoryPanel })))

const EXPO_PALETTE: DitherColor[] = ['purple', 'green', 'blue', 'orange', 'pink', 'red', 'grey']
const BENCHMARK_REUSE_MS = 5 * 60_000

type BenchmarkPoint = { ts: number; portfolio: number; benchmark?: number }
type ExposureHighlight = { label: string; color: string }

export function InsightsView({ onRequestImport }: { onRequestImport: () => void }) {
  const { snapshot, settings } = useStore()
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
  const [openKpi, setOpenKpi] = useState<'session' | 'drawdown' | 'top-five' | 'data-health' | null>(null)
  const { backcast, history: backcastHistory, loading: backcastLoading, days: backcastDays, key: backcastKey, requestMore: requestMoreBackcast } = usePortfolioBackcast({
    positions: snapshot.positions, quotes: snapshot.quotes, allowExternalData: settings.allowExternalData,
  })

  const contributionColumns = useMemo(() => buildContributionColumns(snapshot.contributions.map((item) => ({
    label: item.symbol.length > 14 ? `${item.symbol.slice(0, 13)}…` : item.symbol,
    dailyPriceChange: item.dailyPriceChange,
    dailyPriceChangePct: item.dailyPriceChangePct,
  })), contributionDisplay), [contributionDisplay, snapshot.contributions])
  const exposure = useMemo(() => snapshot.contributions.filter((item) => item.priced && item.value > 0).sort((a, b) => b.value - a.value), [snapshot.contributions])
  const unmappedExposure = useMemo(() => snapshot.contributions.filter((item) => !item.priced || item.value <= 0), [snapshot.contributions])
  const topFive = useMemo(() => snapshot.contributions.filter((item) => item.priced).sort((a, b) => b.value - a.value).slice(0, 5), [snapshot.contributions])
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

  const risk = useMemo(() => calculatePortfolioRisk(analyticsHistory), [analyticsHistory])

  if (snapshot.positions.length === 0) {
    return (
      <PortfolioWelcome variant="insights" onRequestImport={onRequestImport} />
    )
  }

  const hide = settings.hideValues
  const mask = (value: string) => hide ? '••••••' : value
  const value = (amount: number) => mask(formatCurrency(amount))
  const hasDailyData = contributionColumns.tailwinds.length > 0 || contributionColumns.headwinds.length > 0
  const hasHistory = analyticsHistory.length >= 2
  const exposureSectors = snapshot.sectors.slice(0, 10)
  const activeSector = exposureSectors.find((sector) => sector.label === hoveredSector) ?? exposureSectors.find((sector) => sector.label === focusedSector)
  const activeSectorIndex = activeSector ? exposureSectors.indexOf(activeSector) : -1
  const exposureHighlight: ExposureHighlight | null = !hide && activeSectorIndex >= 0 ? {
    label: exposureSectors[activeSectorIndex].label,
    color: rgb(seedOfColor(EXPO_PALETTE[activeSectorIndex % EXPO_PALETTE.length]).fill),
  } : null
  const topFiveMaxWeight = Math.max(...topFive.map((holding) => holding.weight), 1)
  const dataLabels = portfolioDataLabels(snapshot)

  return (
    <div className="insights-page">
      <div className="page-head enter d0">
        <div>
          <h1 className="page-title">Insights</h1>
        </div>
        <p className="page-sub">A visual explanation of what moved your portfolio, where your exposure sits, and how your record compares with the market.</p>
      </div>

      {!snapshot.valuationComplete && <p className="panel hint" role="status">{snapshot.unpricedCount} holding{snapshot.unpricedCount === 1 ? '' : 's'} unpriced. Allocation, concentration, and current P&L cover the {snapshot.pricedCount} priced holdings only. Incomplete portfolio values are not saved to tracked history.</p>}

      <div className="insight-kpis enter d1" data-health-color={dataHealthColor(dataLabels.healthLabel)}>
        <button type="button" id="session-kpi" className={`insight-kpi insight-kpi--interactive${openKpi === 'session' ? ' insight-kpi--open' : ''}`} onClick={() => setOpenKpi(openKpi === 'session' ? null : 'session')} aria-expanded={openKpi === 'session'} aria-controls="session-detail">
          <span className="score-label insight-kpi-label"><span>{dataLabels.sessionLabel}</span><DitherBar className="insight-kpi-texture" segments={[{ value: 1, color: !hide && dataLabels.sessionValue != null && dataLabels.sessionValue < 0 ? 'red' : 'blue' }]} /><i className="insight-kpi-chevron" aria-hidden="true" /></span>
          <strong className={hide || dataLabels.sessionValue == null ? '' : dataLabels.sessionValue >= 0 ? 'up' : 'down'}>{dataLabels.sessionValue == null ? 'Unavailable' : mask(`${dataLabels.sessionValue >= 0 ? '+' : ''}${formatCurrency(dataLabels.sessionValue)}`)}</strong>
          <span className="hint">{hide ? 'Session values hidden' : <>{snapshot.dailyChangePct != null && <>{formatPercent(snapshot.dailyChangePct)} · </>}{dataLabels.coverageLabel}</>}</span>
        </button>
        {openKpi === 'session' && <div className="insight-kpi-detail enter" id="session-detail" role="region" aria-labelledby="session-kpi">
          <div><span className="score-label">What contributed to the session move</span><strong>{dataLabels.sessionLabel}</strong><p className="hint">{dataLabels.sessionScope} · {dataLabels.coverageLabel}. Each amount is the price change multiplied by the quantity you hold.</p></div>
          {hide ? <HiddenValuesState /> : <SessionContributors snapshot={snapshot} formatValue={value} />}
        </div>}
        <button type="button" id="drawdown-kpi" className={`insight-kpi insight-kpi--interactive${openKpi === 'drawdown' ? ' insight-kpi--open' : ''}`} onClick={() => setOpenKpi(openKpi === 'drawdown' ? null : 'drawdown')} aria-expanded={openKpi === 'drawdown'} aria-controls="drawdown-detail">
          <span className="score-label insight-kpi-label"><span>Worst drawdown</span><DitherBar className="insight-kpi-texture" segments={[{ value: 1, color: 'red' }]} /><i className="insight-kpi-chevron" aria-hidden="true" /></span>
          <strong className={!hide && risk.worst < 0 ? 'down' : ''}>{hasHistory ? mask(`${risk.worst.toFixed(1)}%`) : '—'}</strong>
          <span className="hint">See the peak-to-trough chart</span>
        </button>
        {openKpi === 'drawdown' && <div className="insight-kpi-detail enter" id="drawdown-detail" role="region" aria-labelledby="drawdown-kpi">
          <div><span className="score-label">How this was calculated</span><strong className={!hide && risk.worst < 0 ? 'down' : undefined}>{hasHistory ? mask(`${risk.worst.toFixed(1)}%`) : '—'}</strong><p className="hint">Today's holdings at historical prices. Past trades are not included.{backcast && hasHistory && <> {backcast.holdingsIncluded} of {backcast.holdingsTotal} holdings included · {mask(`${backcast.coveragePct.toFixed(0)}%`)} of priced INR value covered. Uses shared observation dates.</>}</p></div>
          {hide ? <HiddenValuesState /> : hasHistory ? <WorstDrawdownChart points={analyticsHistory} risk={risk} formatValue={value} /> : <p>{backcastLoading ? 'Historical prices are loading for this calculation.' : settings.allowExternalData ? 'Historical prices are unavailable. Try again later.' : 'Enable external market data in Settings to calculate historical drawdown.'}</p>}
        </div>}
        <button type="button" id="top-five-kpi" className={`insight-kpi insight-kpi--interactive${openKpi === 'top-five' ? ' insight-kpi--open' : ''}`} onClick={() => setOpenKpi(openKpi === 'top-five' ? null : 'top-five')} aria-expanded={openKpi === 'top-five'} aria-controls="top-five-detail">
          <span className="score-label insight-kpi-label"><span>Top five weight</span><DitherBar className="insight-kpi-texture" segments={[{ value: 1, color: 'purple' }]} /><i className="insight-kpi-chevron" aria-hidden="true" /></span>
          <strong>{snapshot.pricedCount ? mask(`${snapshot.topFiveWeight.toFixed(1)}%`) : 'Unpriced'}</strong>
          <span className="hint">See the five-position split</span>
        </button>
        {openKpi === 'top-five' && <div className="insight-kpi-detail enter" id="top-five-detail" role="region" aria-labelledby="top-five-kpi">
          <div><span className="score-label">Largest five holdings</span><strong>{snapshot.pricedCount ? mask(`${snapshot.topFiveWeight.toFixed(1)}% of priced portfolio`) : 'Unpriced'}</strong></div>
          {hide ? <HiddenValuesState /> : topFive.length === 0 ? <p>No priced holdings are available for this split.</p> : <div className="kpi-split-list">{topFive.map((item, index) => <div key={`${item.type}:${item.symbol}`}><span>{item.symbol}</span><DitherBar className="kpi-split-bar" segments={[{ value: item.weight, color: EXPO_PALETTE[index % EXPO_PALETTE.length] }]} scale={topFiveMaxWeight} /><strong>{mask(`${item.weight.toFixed(1)}%`)}</strong></div>)}</div>}
        </div>}
        <button type="button" id="data-health-kpi" className={`insight-kpi insight-kpi--interactive${openKpi === 'data-health' ? ' insight-kpi--open' : ''}`} onClick={() => setOpenKpi(openKpi === 'data-health' ? null : 'data-health')} aria-expanded={openKpi === 'data-health'} aria-controls="data-health-detail">
          <span className="score-label insight-kpi-label"><span>Data health</span><DitherBar className="insight-kpi-texture" segments={[{ value: 1, color: dataHealthColor(dataLabels.healthLabel) }]} /><i className="insight-kpi-chevron" aria-hidden="true" /></span>
          <strong>{dataLabels.healthLabel}</strong>
          <span className="hint">{dataLabels.healthDetail}</span>
        </button>
        {openKpi === 'data-health' && <div className="insight-kpi-detail insight-kpi-detail--health enter" id="data-health-detail" role="region" aria-labelledby="data-health-kpi">
          <DataHealthGuide healthLabel={dataLabels.healthLabel} allowExternalData={settings.allowExternalData} />
        </div>}
      </div>

      <div className="insight-grid enter d2">
        <section className="panel insight-panel insight-panel--wide insight-panel--benchmark chart-open">
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
            ) : <div className="chart-empty chart-empty--tracking"><i aria-hidden="true" /><strong>{selectedBenchmark.unavailableReason ?? (backcastLoading ? 'Building your comparison' : settings.allowExternalData ? 'Historical comparison unavailable' : 'External market data is off')}</strong><span>{selectedBenchmark.unavailableReason ? 'Choose another benchmark to start a comparison.' : trackedAvailable ? 'Tracked balances include account changes and cash flows. Investment returns need historical prices or dated transactions.' : settings.allowExternalData ? 'The app is reconstructing today’s holdings against real historical closes.' : 'Enable it in Settings to compare your portfolio with market benchmarks.'}</span></div>}
          </div>
          <span className="hint insight-chart-footnote">{selectedBenchmark.unavailableReason ?? (benchmarkError ? <>Could not load {selectedBenchmark.label} history. <button type="button" className="benchmark-retry" onClick={() => setBenchmarkReload((count) => count + 1)}>Retry</button></> : benchmarkLoading || backcastLoading ? 'Building the historical comparison…' : backcastHistory.length >= 2 && backcast ? `Current-holdings backcast · ${mask(`${backcast.coveragePct.toFixed(0)}%`)} priced INR value coverage · shared dates` : 'Historical market data is unavailable')}</span>
        </section>

        <section className="panel insight-panel insight-panel--allocation">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Allocation treemap</span><span className="section-index">02 · Exposure</span></div></div>
          <AllocationMap items={exposure} unmapped={unmappedExposure} formatValue={value} highlight={exposureHighlight} hideValues={hide} />
        </section>

        <section className="panel insight-panel insight-panel--exposure">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Exposure mix</span><span className="section-index">03 · Sectors / type</span></div></div>
          {hide ? <HiddenValuesState /> : <ExposureMix items={exposureSectors} formatValue={value} activeLabel={exposureHighlight?.label ?? null} onHover={setHoveredSector} onFocus={setFocusedSector} />}
        </section>

        <section className="panel insight-panel insight-panel--wide">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Latest price movers</span><span className="section-index">04 · Holding price changes</span></div><div className="segmented-control" aria-label="Mover display"><button type="button" className={contributionDisplay === 'price' ? 'is-active' : ''} onClick={() => setContributionDisplay('price')} aria-pressed={contributionDisplay === 'price'}>Price Δ</button><button type="button" className={contributionDisplay === 'percent' ? 'is-active' : ''} onClick={() => setContributionDisplay('percent')} aria-pressed={contributionDisplay === 'percent'}>% Δ</button></div></div>
          {!hide && <p className="hint">{dataLabels.sessionLabel} · {dataLabels.coverageLabel}. Bars show each holding's price change.</p>}
          {hide ? <HiddenValuesState /> : hasDailyData ? <div className="contribution-columns"><ContributionBars title="Tailwinds" data={contributionColumns.tailwinds} positive display={contributionDisplay} formatValue={value} formatPercent={(amount) => mask(formatPercent(amount))} /><ContributionBars title="Headwinds" data={contributionColumns.headwinds} display={contributionDisplay} formatValue={value} formatPercent={(amount) => mask(formatPercent(amount))} /></div> : <div className="chart-empty">{settings.allowExternalData ? 'No price changes reported for this measure. Refresh quotes to try again.' : 'Enable external market data in Settings to see holding-level price changes.'}</div>}
        </section>

        <section className="panel insight-panel insight-panel--wide insight-panel--risk">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Portfolio risk checks</span><span className="section-index">05 · At a glance</span></div></div>
          {hasHistory && snapshot.pricedCount > 0 ? <RiskProfile risk={risk} hideValues={hide}
            historyStart={analyticsHistory[0].at} historyEnd={analyticsHistory[analyticsHistory.length - 1].at}
            coverage={backcast && backcast.holdingsIncluded < backcast.holdingsTotal ? `History covers ${backcast.holdingsIncluded} of ${backcast.holdingsTotal} holdings · ${backcast.coveragePct.toFixed(0)}% of priced INR value.` : null} /> : <div className="chart-empty">{snapshot.pricedCount === 0 ? 'Current prices are unavailable. Risk checks need priced holdings.' : backcastLoading ? 'Historical prices are loading to build your risk profile.' : 'Historical risk is unavailable. Tracked balance changes include account changes and cash flows.'}</div>}
        </section>
      </div>
      <Suspense fallback={<div className="panel history-panel-placeholder" role="status">Preparing price history…</div>}>
        <HistoryPanel scope="all" />
      </Suspense>
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
  const max = Math.max(...items.map((item) => item.value), 1)

  return (
    <div className="expo-mix" aria-label="Exposure mix by sector and type">
      <div className="expo-ribbon" aria-hidden="true">
        {items.map((sector, index) => (
          <div
            key={sector.label}
            className={`expo-seg${active === index ? ' is-active' : active >= 0 ? ' is-dim' : ''}`}
            style={{ flexGrow: Math.max(sector.value, 1) }}
            onMouseEnter={() => onHover(sector.label)}
            onMouseLeave={() => onHover(null)}
          ><DitherBar segments={[{ value: 1, color: EXPO_PALETTE[index % EXPO_PALETTE.length] }]} /></div>
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
              aria-pressed={active === index}
              aria-label={`${sector.label}: ${sector.weight.toFixed(1)}%, ${formatValue(sector.value)}, ${sector.count} ${sector.count === 1 ? 'position' : 'positions'}`}
            >
              <span className="expo-identity">
                <i className="legend-swatch" style={{ background: rgb(seedOfColor(color).fill) }} />
                <span className="expo-name" title={sector.label}>{sector.label}</span>
              </span>
              <strong className="expo-weight">{sector.weight.toFixed(1)}%</strong>
              <span className="expo-meta">{context}</span>
              <span className="expo-value">{formatValue(sector.value)}</span>
              <DitherBar className="expo-track" segments={[{ value: sector.value, color }]} scale={max} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

type AllocationItem = { symbol: string; value: number; weight: number; pnl: number | null; sector: string }

const AllocationTile = memo(function AllocationTile({ item, active, highlight, onSelect }: {
  item: AllocationItem
  active: boolean
  highlight: ExposureHighlight | null
  onSelect: (symbol: string) => void
}) {
  const widthPercent = Math.max(2, Math.min(12, Math.round(item.weight / 100 * 12))) / 12 * 100
  const exposureClass = !highlight ? '' : item.sector === highlight.label ? ' allocation-tile--exposure-match' : ' allocation-tile--exposure-muted'
  const color: DitherColor = item.pnl == null ? 'grey' : item.pnl < 0 ? 'red' : 'green'
  return <button type="button" className={`allocation-tile${active ? ' allocation-tile--active' : ''}${exposureClass}`} style={{ flexBasis: `max(110px, calc(${widthPercent}% - 4px))` }} onMouseEnter={() => onSelect(item.symbol)} onFocus={() => onSelect(item.symbol)} onClick={() => onSelect(item.symbol)} aria-pressed={active} aria-label={`${item.symbol}, ${item.weight.toFixed(1)}% of portfolio, ${item.sector}`}>
    <DitherBar className="allocation-tile-fill" segments={[{ value: 1, color }]} />
    <strong>{item.symbol}</strong><span>{item.weight.toFixed(1)}%</span>
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
  unmapped: { symbol: string; priced: boolean }[]
  formatValue: (amount: number) => string
  highlight: ExposureHighlight | null
  hideValues: boolean
}) {
  const [selected, onSelect] = useState<string | null>(null)
  if (hideValues) return <HiddenValuesState />
  const active = items.find((item) => item.symbol === selected) ?? items[0]
  return <div className="allocation-map-wrap" style={highlight ? { '--exposure-highlight': highlight.color } as CSSProperties : undefined}>
    <div className="allocation-map" aria-label="Allocation treemap">
      {items.map((item) => <AllocationTile key={item.symbol} item={item} active={item.symbol === active?.symbol} highlight={highlight} onSelect={onSelect} />)}
    </div>
    {unmapped.length > 0 && <div className="allocation-unmapped">
      <span className="score-label">Outside treemap</span>
      <ul>{unmapped.map((item) => <li key={item.symbol}><strong>{item.symbol}</strong><span>{item.priced ? 'No positive value' : 'Unpriced'}</span></li>)}</ul>
    </div>}
    {active && <div className="allocation-detail" aria-live="polite"><div><span className="score-label">Selected holding</span><strong>{active.symbol}</strong></div><div><span className="score-label">Portfolio weight</span><strong>{active.weight.toFixed(1)}%</strong></div><div><span className="score-label">Current value</span><strong>{formatValue(active.value)}</strong></div><div><span className="score-label">P&L</span><strong className={active.pnl == null ? undefined : active.pnl < 0 ? 'down' : 'up'}>{active.pnl == null ? '—' : formatValue(active.pnl)}</strong></div></div>}
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

type RiskStatus = 'lower' | 'watch' | 'high'
const RISK_COLORS: Record<RiskStatus | 'hidden', DitherColor> = { lower: 'green', watch: 'orange', high: 'red', hidden: 'grey' }

function riskStatus(value: number, watchAt: number, highAt: number): RiskStatus {
  if (value >= highAt) return 'high'
  if (value >= watchAt) return 'watch'
  return 'lower'
}

function RiskProfile({ risk, hideValues, coverage, historyStart, historyEnd }: { risk: ReturnType<typeof calculatePortfolioRisk>; hideValues: boolean; coverage: string | null; historyStart: number; historyEnd: number }) {
  const [openDefinition, setOpenDefinition] = useState<string | null>(null)
  const { current, volatility } = risk
  const mask = (text: string) => hideValues ? '••••' : text
  const amount = (value: number) => mask(numberFormatter({ style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value))
  const date = (at: number) => dateFormatter({ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(at)
  const historyBasis = "Today's holdings at past prices. Uses every historical observation."
  const riskRows = [
    {
      id: 'below-high',
      label: 'Current drop from peak',
      value: Math.abs(current),
      scaleMax: 30,
      watchAt: 10,
      highAt: 20,
      formula: 'Value = (latest high - latest value) ÷ latest high × 100.',
      definition: 'Compares the latest value with the highest value reached before it. 0% means it is back at that high.',
      basis: historyBasis,
    },
    {
      id: 'time-below-peak',
      label: 'Time below peak',
      value: risk.daysBelowPeak,
      scaleMax: 180,
      unit: ' days',
      watchAt: 30,
      highAt: 90,
      reading: risk.daysBelowPeak == null ? 'Unavailable' : `${risk.daysBelowPeak} ${risk.daysBelowPeak === 1 ? 'day' : 'days'}`,
      formula: 'Value = latest observation date − most recent peak date, in calendar days.',
      definition: 'Shows how long the latest value has been below its high within the loaded history. Equal highs reset the date; recovery shows 0 days. Earlier unseen peaks are not included.',
      basis: `${historyBasis} Meter scale: 0 to 180 days; longer periods fill the meter.`,
    },
    {
      id: 'yearly-movement',
      label: 'Yearly swings',
      value: volatility,
      summary: volatility == null ? 'Daily closes are required for a yearly estimate.' : 'How much daily percentage returns varied, shown as a yearly estimate.',
      scaleMax: 40,
      watchAt: 15,
      highAt: 25,
      formula: 'Value = daily return standard deviation × √252 × 100.',
      definition: 'Estimates the size of return swings. Gains and losses both count; this is not a loss probability.',
      basis: "Today's holdings at past prices. Longer gaps and the latest app valuation are excluded.",
    },
    {
      id: 'down-sessions',
      label: 'Down sessions',
      value: risk.downSessionPct,
      reading: `${risk.downSessions} of ${risk.observedSessions}`,
      detail: risk.downSessionPct == null ? undefined : `${risk.downSessionPct.toFixed(1)}%`,
      summary: 'Observed sessions that closed lower.',
      scaleMax: 100,
      watchAt: 45,
      highAt: 55,
      formula: 'Share = falling close changes ÷ all eligible close changes × 100.',
      definition: 'Counts falls between consecutive market closes. Gains and flat sessions stay in the total. Missing-session gaps and the current live valuation are excluded. This is observed frequency, not a forecast.',
      basis: "Today's holdings at past prices. Uses eligible close changes within the loaded history.",
    },
  ].map((row) => ({
    ...row,
    status: row.value == null ? null : riskStatus(row.value, row.watchAt, row.highAt),
  }))

  return (
    <div className="risk-profile">
      <div className="risk-bars">
        {riskRows.map((row) => {
          const tooltipId = `risk-definition-${row.id}`
          const isOpen = openDefinition === row.id
          const statusLabel = row.status == null ? 'Unavailable' : row.status === 'lower' ? 'Good' : row.status === 'watch' ? 'To watch' : 'High'
          const displayedStatus = hideValues || row.status == null ? 'hidden' : row.status
          const reading = row.value == null ? 'Unavailable' : row.reading ?? `${row.value.toFixed(1)}%`
          const unit = row.unit ?? '%'
          const readingContent = <div className="risk-reading">
            <strong>{mask(row.value == null ? '—' : reading)}</strong>
            <div className="risk-reading-meta">
              {!hideValues && row.detail && <span className="risk-observation">{row.detail}</span>}
              <span className={`risk-status risk-status--${displayedStatus}`}>{hideValues ? 'Hidden' : statusLabel}</span>
            </div>
          </div>
          return (
            <article className={`risk-bar risk-bar--${displayedStatus}`} key={row.id} data-risk={row.id}>
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
                        <strong>{row.label}</strong>
                        <span>{row.definition}</span>
                        <span><b>Formula</b> {row.formula}</span>
                        <span><b>App guide</b> Good below {row.watchAt}{unit} · To watch from {row.watchAt}{unit} · High from {row.highAt}{unit}</span>
                        <small>{row.basis} App-defined screening bands.</small>
                      </span>
                    </button>
                  </span>
                  {row.id !== 'below-high' && row.id !== 'time-below-peak' && <span className="risk-summary">{row.summary}</span>}
                </div>
                {row.id !== 'time-below-peak' && readingContent}
              </div>

              {row.id === 'below-high' && <div className="risk-breakdown">
                <dl className="risk-calculation" aria-label="Current drop calculation">
                  <div className="risk-calculation-stat"><dt>Peak value</dt><dd><strong>{amount(risk.peakValue)}</strong></dd></div>
                  <div className="risk-calculation-stat"><dt>Latest value</dt><dd><strong>{amount(risk.currentValue)}</strong></dd></div>
                  <div className={`risk-calculation-stat risk-calculation-result${!hideValues && risk.peakValue > risk.currentValue ? ' risk-calculation-result--loss' : ''}`}>
                    <dt><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 4 8 8M6 12h6V6" /></svg>Below peak</dt>
                    <dd><strong>{amount(risk.peakValue - risk.currentValue)}</strong></dd>
                  </div>
                </dl>
                {!hideValues && coverage && <small className="risk-calculation-basis">{coverage}</small>}
              </div>}

              {row.id === 'time-below-peak' && <div className="risk-time-breakdown">
                <div className="risk-timeline" role="group" aria-label="Time below peak calculation">
                  <dl className="risk-timeline-date">
                    <dt>Last observed peak</dt>
                    <dd><strong>{hideValues ? mask('') : risk.peakAt == null ? 'Unavailable' : <time dateTime={new Date(risk.peakAt).toISOString()}>{date(risk.peakAt)}</time>}</strong></dd>
                  </dl>
                  <div className="risk-timeline-reading">{readingContent}</div>
                  <dl className="risk-timeline-date">
                    <dt>Latest reading</dt>
                    <dd><strong>{hideValues ? mask('') : <time dateTime={new Date(historyEnd).toISOString()}>{date(historyEnd)}</time>}</strong></dd>
                  </dl>
                </div>
                {!hideValues && risk.daysBelowPeak === 0 && <p className="risk-summary risk-recovery-note">Latest value is at its observed peak.</p>}
              </div>}

              <div className="risk-track" role="img" aria-label={hideValues ? `${row.label}: hidden` : `${row.label}: ${reading}, ${statusLabel}. Bar scale 0 to ${row.scaleMax}${unit}.`}>
                <span className="risk-track-zone risk-track-zone--lower" style={{ width: `${row.watchAt / row.scaleMax * 100}%` }} />
                <span className="risk-track-zone risk-track-zone--watch" style={{ width: `${(row.highAt - row.watchAt) / row.scaleMax * 100}%` }} />
                <span className="risk-track-zone risk-track-zone--high" style={{ width: `${(row.scaleMax - row.highAt) / row.scaleMax * 100}%` }} />
                <DitherBar segments={[{ value: hideValues ? 0 : row.value ?? 0, color: RISK_COLORS[displayedStatus] }]} scale={row.scaleMax} />
              </div>

            </article>
          )
        })}
      </div>
      {!hideValues && <small className="risk-history-basis">Current holdings at past prices · {date(historyStart)} to {date(historyEnd)}</small>}
    </div>
  )
}
