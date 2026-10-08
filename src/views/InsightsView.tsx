import { useEffect, useMemo, useState } from 'react'
import { formatCurrency, formatPercent } from '../valuation'
import { BENCHMARKS, marketData } from '../marketData'
import type { SectorAllocation } from '../investmentWorkspace'
import { buildPortfolioBackcast, type PortfolioBackcast } from '../portfolioBackcast'
import { downsampleSeries } from '../timeSeries'
import { calculatePortfolioRisk } from '../portfolioRisk'
import { useStore } from '../useStore'
import { portfolioDataLabels } from '../portfolioDataLabels'
import { assetTypeLabel } from '../instruments'
import { buildContributionColumns, type ContributionDisplay } from '../contributionBars'
import { InteractiveTrendChart } from './InteractiveTrendChart'
import { PortfolioRequiredState } from './PortfolioRequiredState'
import { HiddenValuesState } from './HiddenValuesState'
import { SessionContributors } from './SessionContributors'
import { WorstDrawdownChart } from './WorstDrawdownChart'
import { DataHealthGuide } from './DataHealthGuide'

// Same muted family as the overview allocation card so charts read as one system.
const EXPO_PALETTE = ['#7c89e8', '#5fae9b', '#d0a35c', '#c97b84', '#6aa9c9', '#a685c9', '#96b862', '#8a93a6']
const MAX_CHART_POINTS = 180
const INITIAL_BACKCAST_DAYS = 366
const BACKCAST_PAGE_DAYS = 366
const MAX_BACKCAST_DAYS = 3 * 366

type BenchmarkPoint = { ts: number; portfolio: number; benchmark?: number }

export function InsightsView({ onRequestImport }: { onRequestImport: () => void }) {
  const { snapshot, settings } = useStore()
  const [benchmarkId, setBenchmarkId] = useState('nifty-50')
  const selectedBenchmark = BENCHMARKS.find((item) => item.id === benchmarkId) ?? BENCHMARKS[0]
  const [benchmarkPoints, setBenchmarkPoints] = useState<{ date: string; close: number }[]>([])
  const [benchmarkLoading, setBenchmarkLoading] = useState(false)
  const [benchmarkError, setBenchmarkError] = useState(false)
  const [benchmarkReload, setBenchmarkReload] = useState(0)
  const [selectedExposureSymbol, setSelectedExposureSymbol] = useState<string | null>(null)
  const [contributionDisplay, setContributionDisplay] = useState<ContributionDisplay>('price')
  const [openKpi, setOpenKpi] = useState<'session' | 'drawdown' | 'top-five' | 'data-health' | null>(null)
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
      setBackcastLoading(false)
      setBackcastDays(INITIAL_BACKCAST_DAYS)
      return
    }
    let alive = true
    const controller = new AbortController()
    setBackcastLoading(true)
    void buildPortfolioBackcast(snapshot.positions, snapshot.quotes, marketData, backcastDays, controller.signal).then((result) => {
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
      controller.abort()
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
  const exposure = useMemo(() => snapshot.contributions.filter((item) => item.priced).sort((a, b) => b.value - a.value).slice(0, 16), [snapshot.contributions])
  const topFive = useMemo(() => snapshot.contributions.filter((item) => item.priced).sort((a, b) => b.value - a.value).slice(0, 5), [snapshot.contributions])
  const chartHistory = useMemo(() => downsampleSeries(snapshot.history, MAX_CHART_POINTS), [snapshot.history])
  const backcastHistory = backcast?.points ?? []
  const analyticsHistory = backcastHistory
  const backcastChartHistory = useMemo(() => downsampleSeries(backcast?.points ?? [], MAX_CHART_POINTS), [backcast])
  const analyticsStartAt = analyticsHistory[0]?.at ?? null
  const trackedAvailable = chartHistory.length >= 2
  const performanceHistory = performanceMode === 'tracked' ? chartHistory : backcastChartHistory

  useEffect(() => {
    const symbol = selectedBenchmark.symbol
    if (!settings.allowExternalData || analyticsStartAt == null || !symbol) {
      setBenchmarkPoints([])
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
    const from = new Date(Math.min(analyticsStartAt, to.getTime() - 365 * 24 * 60 * 60 * 1000))
    const load = async (attempt: number) => {
      let points: typeof benchmarkPoints = []
      try {
        points = await marketData.benchmarkHistory(symbol, from, to, controller.signal)
      } catch {
        // A failed provider request can be retried while this benchmark is selected.
      }
      if (!alive) return
      if (points.length >= 2) {
        setBenchmarkPoints(points)
        setBenchmarkError(false)
        setBenchmarkLoading(false)
      } else if (attempt < 2) {
        retryTimer = setTimeout(() => { void load(attempt + 1) }, attempt === 0 ? 600 : 1500)
      } else {
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
  }, [analyticsStartAt, benchmarkReload, selectedBenchmark.symbol, settings.allowExternalData])

  const benchmarkSeries = useMemo<BenchmarkPoint[]>(() => {
    const history = analyticsHistory
    if (history.length < 2) return []
    const firstPortfolio = history[0].value
    const benchmarkTimes = benchmarkPoints.map((item) => +new Date(item.date))
    let benchmarkIndex = 0
    while (benchmarkIndex + 1 < benchmarkTimes.length && benchmarkTimes[benchmarkIndex + 1] <= history[0].at) benchmarkIndex += 1
    const firstBenchmark = benchmarkPoints[benchmarkIndex]?.close
    return downsampleSeries(history, MAX_CHART_POINTS).map((point) => {
      while (benchmarkIndex + 1 < benchmarkTimes.length && benchmarkTimes[benchmarkIndex + 1] <= point.at) benchmarkIndex += 1
      const matching = benchmarkPoints[benchmarkIndex]
      return {
        ts: point.at,
        portfolio: firstPortfolio > 0 ? ((point.value / firstPortfolio) - 1) * 100 : 0,
        benchmark: firstBenchmark && matching ? ((matching.close / firstBenchmark) - 1) * 100 : undefined,
      }
    })
  }, [analyticsHistory, benchmarkPoints])
  const benchmarkLatest = benchmarkSeries[benchmarkSeries.length - 1]
  const benchmarkGap = benchmarkLatest?.benchmark == null ? null : benchmarkLatest.portfolio - benchmarkLatest.benchmark
  const performanceLatest = performanceHistory[performanceHistory.length - 1]
  const performanceGap = performanceLatest ? performanceLatest.value - performanceLatest.invested : null
  const performanceGapPct = performanceLatest?.invested > 0 && performanceGap != null
    ? performanceGap / performanceLatest.invested * 100
    : null

  const risk = useMemo(() => calculatePortfolioRisk(analyticsHistory), [analyticsHistory])

  if (snapshot.positions.length === 0) {
    return (
      <PortfolioRequiredState
        area="02 · Insights"
        description="Bring in your holdings to turn market prices into contribution, allocation, performance, and risk views."
        onImport={onRequestImport}
      />
    )
  }

  const hide = settings.hideValues
  const mask = (value: string) => hide ? '••••••' : value
  const currency = settings.currency
  const value = (amount: number) => mask(formatCurrency(amount, currency, snapshot.fxRate?.usdInr))
  const axisCurrency = new Intl.NumberFormat('en-IN', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })
  const axisValue = (amount: number) => mask(currency === 'USD'
    ? snapshot.fxRate?.usdInr ? axisCurrency.format(amount / snapshot.fxRate.usdInr) : '—'
    : axisCurrency.format(amount))
  const hasDailyData = contributionColumns.tailwinds.length > 0 || contributionColumns.headwinds.length > 0
  const hasHistory = analyticsHistory.length >= 2
  const selectedExposure = exposure.find((item) => item.symbol === selectedExposureSymbol) ?? exposure[0]
  const dataLabels = portfolioDataLabels(snapshot)

  return (
    <div className="insights-page">
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">02 · Investment intelligence</div>
          <h1 className="page-title">Read the market story.</h1>
        </div>
        <p className="page-sub">A visual explanation of what moved your portfolio, where your exposure sits, and how your record compares with the market.</p>
      </div>

      {!snapshot.valuationComplete && <p className="panel hint" role="status">{snapshot.unpricedCount} holding{snapshot.unpricedCount === 1 ? '' : 's'} unpriced. Allocation, concentration, and current P&L cover the {snapshot.pricedCount} priced holdings only. Incomplete portfolio values are not saved to tracked history.</p>}

      <div className="insight-kpis enter d1">
        <button type="button" id="session-kpi" className={`insight-kpi insight-kpi--interactive${openKpi === 'session' ? ' insight-kpi--open' : ''}`} onClick={() => setOpenKpi(openKpi === 'session' ? null : 'session')} aria-expanded={openKpi === 'session'} aria-controls="session-detail">
          <span className="score-label insight-kpi-label">{dataLabels.sessionLabel}<i className="insight-kpi-chevron" aria-hidden="true" /></span>
          <strong className={hide || snapshot.dailyChange == null ? '' : snapshot.dailyChange >= 0 ? 'up' : 'down'}>{snapshot.dailyChange == null ? 'Unavailable' : mask(`${snapshot.dailyChange >= 0 ? '+' : ''}${formatCurrency(snapshot.dailyChange, currency, snapshot.fxRate?.usdInr)}`)}</strong>
          <span className="hint">{snapshot.dailyChangePct != null && <>{mask(formatPercent(snapshot.dailyChangePct))} · </>}{dataLabels.coverageLabel}</span>
        </button>
        <button type="button" id="drawdown-kpi" className={`insight-kpi insight-kpi--interactive${openKpi === 'drawdown' ? ' insight-kpi--open' : ''}`} onClick={() => setOpenKpi(openKpi === 'drawdown' ? null : 'drawdown')} aria-expanded={openKpi === 'drawdown'} aria-controls="drawdown-detail">
          <span className="score-label insight-kpi-label">Worst drawdown<i className="insight-kpi-chevron" aria-hidden="true" /></span>
          <strong className={!hide && risk.worst < 0 ? 'down' : ''}>{hasHistory ? mask(`${risk.worst.toFixed(1)}%`) : '—'}</strong>
          <span className="hint">See the peak-to-trough chart</span>
        </button>
        <button type="button" id="top-five-kpi" className={`insight-kpi insight-kpi--interactive${openKpi === 'top-five' ? ' insight-kpi--open' : ''}`} onClick={() => setOpenKpi(openKpi === 'top-five' ? null : 'top-five')} aria-expanded={openKpi === 'top-five'} aria-controls="top-five-detail">
          <span className="score-label insight-kpi-label">Top five weight<i className="insight-kpi-chevron" aria-hidden="true" /></span>
          <strong>{snapshot.pricedCount ? mask(`${snapshot.topFiveWeight.toFixed(1)}%`) : 'Unpriced'}</strong>
          <span className="hint">See the five-position split</span>
        </button>
        <button type="button" id="data-health-kpi" className={`insight-kpi insight-kpi--interactive${openKpi === 'data-health' ? ' insight-kpi--open' : ''}`} onClick={() => setOpenKpi(openKpi === 'data-health' ? null : 'data-health')} aria-expanded={openKpi === 'data-health'} aria-controls="data-health-detail">
          <span className="score-label insight-kpi-label">Data health<i className="insight-kpi-chevron" aria-hidden="true" /></span>
          <strong>{dataLabels.healthLabel}</strong>
          <span className="hint">{dataLabels.healthDetail}</span>
        </button>
      </div>

      {openKpi === 'session' && <div className="insight-kpi-detail enter" id="session-detail" role="region" aria-labelledby="session-kpi">
        <div><span className="score-label">What contributed to the session move</span><strong>{dataLabels.sessionLabel}</strong><p className="hint">{dataLabels.coverageLabel}. Each amount is the price change multiplied by the quantity you hold.</p></div>
        {hide ? <HiddenValuesState /> : <SessionContributors snapshot={snapshot} formatValue={value} />}
      </div>}
      {openKpi === 'drawdown' && <div className="insight-kpi-detail enter" id="drawdown-detail" role="region" aria-labelledby="drawdown-kpi">
        <div><span className="score-label">How this was calculated</span><strong>{hasHistory ? mask(`${risk.worst.toFixed(1)}%`) : '—'}</strong><p className="hint">Today's holdings at historical prices. Past trades are not included.{backcast && hasHistory && <> {backcast.holdingsIncluded} of {backcast.holdingsTotal} holdings included · {mask(`${backcast.coveragePct.toFixed(0)}%`)} of current value covered.</>}</p></div>
        {hide ? <HiddenValuesState /> : hasHistory ? <WorstDrawdownChart points={analyticsHistory} risk={risk} formatValue={value} /> : <p>{backcastLoading ? 'Historical prices are loading for this calculation.' : settings.allowExternalData ? 'Historical prices are unavailable. Try again later.' : 'Enable external market data in Settings to calculate historical drawdown.'}</p>}
      </div>}
      {openKpi === 'top-five' && <div className="insight-kpi-detail enter" id="top-five-detail" role="region" aria-labelledby="top-five-kpi">
        <div><span className="score-label">Largest five holdings</span><strong>{snapshot.pricedCount ? mask(`${snapshot.topFiveWeight.toFixed(1)}% of priced portfolio`) : 'Unpriced'}</strong></div>
        {hide ? <HiddenValuesState /> : topFive.length === 0 ? <p>No priced holdings are available for this split.</p> : <div className="kpi-split-list">{topFive.map((item) => <div key={`${item.type}:${item.symbol}`}><span>{item.symbol}</span><span className="kpi-split-bar"><i style={{ width: `${item.weight / Math.max(...topFive.map((holding) => holding.weight), 1) * 100}%` }} /></span><strong>{mask(`${item.weight.toFixed(1)}%`)}</strong></div>)}</div>}
      </div>}
      {openKpi === 'data-health' && <div className="insight-kpi-detail insight-kpi-detail--health enter" id="data-health-detail" role="region" aria-labelledby="data-health-kpi">
        <DataHealthGuide healthLabel={dataLabels.healthLabel} allowExternalData={settings.allowExternalData} />
      </div>}

      <div className="insight-grid enter d2">
        <section className="panel insight-panel insight-panel--wide insight-panel--benchmark">
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
              <small>Current holdings since comparison start</small>
            </div>
            <div className="insight-chart-metric insight-chart-metric--benchmark">
              <span><i aria-hidden="true" />{selectedBenchmark.label}</span>
              <strong>{benchmarkLatest?.benchmark == null ? '—' : mask(`${benchmarkLatest.benchmark >= 0 ? '+' : ''}${benchmarkLatest.benchmark.toFixed(1)}%`)}</strong>
              <small>Same starting date</small>
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
                rows={benchmarkSeries.map((item) => ({ at: item.ts, portfolio: item.portfolio, benchmark: item.benchmark }))}
                lines={[{ key: 'portfolio', label: 'Portfolio', color: 'var(--chart-portfolio)' }, { key: 'benchmark', label: selectedBenchmark.label, color: 'var(--chart-benchmark)' }]}
                valueFormatter={(amount) => mask(`${amount >= 0 ? '+' : ''}${amount.toFixed(1)}%`)}
                differenceFormatter={(amount) => mask(`${amount >= 0 ? '+' : ''}${amount.toFixed(1)} pts`)}
                differenceLabel="Return gap"
                yAxisLabel="Return (%)"
                includeZero
                showArea={false}
                appearance="insight"
                onReachStart={backcast ? requestMoreBackcast : undefined}
              />
            ) : <div className="chart-empty chart-empty--tracking"><i aria-hidden="true" /><strong>{selectedBenchmark.unavailableReason ?? (backcastLoading ? 'Building your comparison' : settings.allowExternalData ? 'Historical comparison unavailable' : 'External market data is off')}</strong><span>{selectedBenchmark.unavailableReason ? 'Choose another benchmark to start a comparison.' : trackedAvailable ? 'Tracked balances include account changes and cash flows. Investment returns need historical prices or dated transactions.' : settings.allowExternalData ? 'The app is reconstructing today’s holdings against real historical closes.' : 'Enable it in Settings to compare your portfolio with market benchmarks.'}</span></div>}
          </div>
          <span className="hint insight-chart-footnote">{selectedBenchmark.unavailableReason ?? (benchmarkError ? <>Could not load {selectedBenchmark.label} history. <button type="button" className="benchmark-retry" onClick={() => setBenchmarkReload((count) => count + 1)}>Retry</button></> : benchmarkLoading || backcastLoading ? 'Building the historical comparison…' : backcastHistory.length >= 2 && backcast ? `Current-holdings backcast · ${backcast.coveragePct.toFixed(0)}% value coverage` : 'Historical market data is unavailable')}</span>
        </section>

        <section className="panel insight-panel">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Allocation treemap</span><span className="section-index">02 · Exposure</span></div></div>
          {hide ? <HiddenValuesState /> : <AllocationMap items={exposure} selected={selectedExposure?.symbol ?? null} onSelect={setSelectedExposureSymbol} formatValue={value} />}
        </section>

        <section className="panel insight-panel insight-panel--exposure">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Exposure mix</span><span className="section-index">03 · Sectors / type</span></div></div>
          <ExposureMix items={snapshot.sectors.slice(0, 10)} hideValues={hide} formatValue={value} />
        </section>

        <section className="panel insight-panel insight-panel--wide">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Latest price movers</span><span className="section-index">04 · Holding price changes</span></div><div className="segmented-control" aria-label="Mover display"><button type="button" className={contributionDisplay === 'price' ? 'is-active' : ''} onClick={() => setContributionDisplay('price')} aria-pressed={contributionDisplay === 'price'}>Price Δ</button><button type="button" className={contributionDisplay === 'percent' ? 'is-active' : ''} onClick={() => setContributionDisplay('percent')} aria-pressed={contributionDisplay === 'percent'}>% Δ</button></div></div>
          {!hide && <p className="hint">{dataLabels.sessionLabel} · {dataLabels.coverageLabel}. Bars show each holding's price change.</p>}
          {hide ? <HiddenValuesState /> : hasDailyData ? <div className="contribution-columns"><ContributionBars title="Tailwinds" data={contributionColumns.tailwinds} positive display={contributionDisplay} formatValue={value} formatPercent={(amount) => mask(formatPercent(amount))} /><ContributionBars title="Headwinds" data={contributionColumns.headwinds} display={contributionDisplay} formatValue={value} formatPercent={(amount) => mask(formatPercent(amount))} /></div> : <div className="chart-empty">{settings.allowExternalData ? 'No price changes reported for this measure. Refresh quotes to try again.' : 'Enable external market data in Settings to see holding-level price changes.'}</div>}
        </section>

        <section className="panel insight-panel insight-panel--wide insight-panel--risk">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Portfolio risk checks</span><span className="section-index">05 · At a glance</span></div></div>
          {hasHistory && snapshot.pricedCount > 0 ? <RiskProfile current={risk.current} worst={risk.worst} volatility={risk.volatility} concentration={snapshot.topFiveWeight} hideValues={hide} /> : <div className="chart-empty">{snapshot.pricedCount === 0 ? 'Current prices are unavailable. Risk checks need priced holdings.' : backcastLoading ? 'Historical prices are loading to build your risk profile.' : 'Historical risk is unavailable. Tracked balance changes include account changes and cash flows.'}</div>}
        </section>

        <section className="panel insight-panel insight-panel--wide insight-panel--performance">
          <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">{performanceMode === 'tracked' ? 'Tracked balances' : 'Performance story'}</span><span className="section-index">06 · Value vs invested capital</span></div><div className="segmented-control" aria-label="Performance history method"><button type="button" className={performanceMode === 'backcast' ? 'is-active' : ''} onClick={() => setPerformanceMode('backcast')} aria-pressed={performanceMode === 'backcast'}>Backcast</button><button type="button" className={performanceMode === 'tracked' ? 'is-active' : ''} onClick={() => setPerformanceMode('tracked')} aria-pressed={performanceMode === 'tracked'} disabled={!trackedAvailable} title={trackedAvailable ? 'Use saved daily portfolio balances' : 'Available after two market-day snapshots'}>Tracked</button></div></div>
          <p className="performance-method-note">{performanceMode === 'backcast' ? "Today's holdings at past prices. Past trades are not included." : 'Balance history, not investment returns. Account additions, removals and cash flows can change these values.'}</p>
          {performanceHistory.length >= 2 && <div className="insight-chart-readout">
            <div className="insight-chart-metric insight-chart-metric--value">
              <span><i aria-hidden="true" />Portfolio value</span>
              <strong>{performanceLatest ? value(performanceLatest.value) : '—'}</strong>
              <small>Latest observation</small>
            </div>
            <div className="insight-chart-metric insight-chart-metric--invested">
              <span><i aria-hidden="true" />Invested capital</span>
              <strong>{performanceLatest ? value(performanceLatest.invested) : '—'}</strong>
              <small>{performanceMode === 'tracked' ? 'Cost recorded at each snapshot' : "Cost of today's holdings"}</small>
            </div>
            <div className="insight-chart-metric insight-chart-metric--gap">
              <span>Value − invested</span>
              <strong className={hide || performanceGap == null ? '' : performanceGap >= 0 ? 'up' : 'down'}>{performanceGap == null ? '—' : mask(`${performanceGap >= 0 ? '+' : ''}${formatCurrency(performanceGap, currency, snapshot.fxRate?.usdInr)}`)}</strong>
              <small>{performanceGapPct == null ? 'Current difference' : mask(formatPercent(performanceGapPct))}</small>
            </div>
          </div>}
          <div className="insight-chart insight-chart--performance">
            {performanceHistory.length >= 2 ? (
              <InteractiveTrendChart
                rows={performanceHistory.map((item) => ({ at: item.at, value: item.value, invested: item.invested }))}
                lines={[{ key: 'value', label: 'Portfolio value', color: 'var(--chart-value)' }, { key: 'invested', label: 'Invested capital', color: 'var(--chart-invested)', dashed: true }]}
                valueFormatter={value}
                axisFormatter={axisValue}
                differenceFormatter={value}
                differenceLabel="Value − invested"
                yAxisLabel="Value"
                appearance="insight"
                onReachStart={performanceMode === 'backcast' && backcast ? requestMoreBackcast : undefined}
              />
            ) : <div className="chart-empty chart-empty--tracking"><i aria-hidden="true" /><strong>{backcastLoading ? 'Building your historical series' : 'Historical prices are unavailable'}</strong><span>{backcastLoading ? 'Current holdings are being matched with real historical closes.' : 'Enable external market data or use tracked snapshots as they accumulate.'}</span></div>}
          </div>
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
  formatValue,
}: {
  items: { symbol: string; value: number; weight: number; pnl: number | null }[]
  selected: string | null
  onSelect: (symbol: string) => void
  formatValue: (amount: number) => string
}) {
  const active = items.find((item) => item.symbol === selected) ?? items[0]
  return <div className="allocation-map-wrap">
    <div className="allocation-map" aria-label="Allocation treemap">
      {items.map((item) => {
        const span = Math.max(2, Math.min(12, Math.round(item.weight / 100 * 12)))
        const isActive = item.symbol === active?.symbol
        return <button key={item.symbol} type="button" className={`allocation-tile allocation-tile--${item.pnl != null && item.pnl < 0 ? 'down' : 'up'}${isActive ? ' allocation-tile--active' : ''}`} style={{ gridColumn: `span ${span}` }} onMouseEnter={() => onSelect(item.symbol)} onFocus={() => onSelect(item.symbol)} onClick={() => onSelect(item.symbol)} aria-pressed={isActive} aria-label={`${item.symbol}, ${item.weight.toFixed(1)}% of portfolio`}>
          <strong>{item.symbol}</strong><span>{item.weight.toFixed(1)}%</span>
        </button>
      })}
    </div>
    {active && <div className="allocation-detail" aria-live="polite"><div><span className="score-label">Selected holding</span><strong>{active.symbol}</strong></div><div><span className="score-label">Portfolio weight</span><strong>{active.weight.toFixed(1)}%</strong></div><div><span className="score-label">Current value</span><strong>{formatValue(active.value)}</strong></div><div><span className="score-label">P&L</span><strong className={active.pnl != null && active.pnl < 0 ? 'down' : 'up'}>{active.pnl == null ? '—' : formatValue(active.pnl)}</strong></div></div>}
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
    return <div className="contribution-row" key={item.label}><div><span title={item.label}>{item.label}</span><strong className={positive ? 'up' : 'down'}>{displayValue}</strong></div><div className="contribution-track" aria-label={`${item.label}: ${displayValue}`}><span className={positive ? 'contribution-fill contribution-fill--up' : 'contribution-fill contribution-fill--down'} style={{ width: `${item.width}%` }} /></div></div>
  })}</div></div>
}

type RiskStatus = 'lower' | 'watch' | 'high'

function riskStatus(value: number, watchAt: number, highAt: number): RiskStatus {
  if (value >= highAt) return 'high'
  if (value >= watchAt) return 'watch'
  return 'lower'
}

function RiskProfile({ current, worst, volatility, concentration, hideValues }: { current: number; worst: number; volatility: number | null; concentration: number; hideValues: boolean }) {
  const [openDefinition, setOpenDefinition] = useState<string | null>(null)
  const mask = (text: string) => hideValues ? '••••' : text
  const historyBasis = "Today's holdings at past prices. Uses every historical observation."
  const riskRows = [
    {
      id: 'below-high',
      label: 'Current drop from peak',
      value: Math.abs(current),
      summary: "How far the portfolio's latest value is below its peak.",
      scaleMax: 30,
      watchAt: 10,
      highAt: 20,
      formula: 'Value = (latest high - latest value) ÷ latest high × 100.',
      definition: 'Compares the latest value with the highest value reached before it. 0% means it is back at that high.',
      basis: historyBasis,
    },
    {
      id: 'largest-drop',
      label: 'Worst past drop',
      value: Math.abs(worst),
      summary: 'The biggest fall in portfolio value after an earlier peak.',
      scaleMax: 30,
      watchAt: 10,
      highAt: 20,
      formula: 'Value = largest (earlier high - later low) ÷ earlier high × 100.',
      definition: 'Finds the deepest fall from a peak to a later low. The portfolio may have recovered since.',
      basis: historyBasis,
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
      id: 'top-five-share',
      label: 'Top five holdings',
      value: concentration,
      summary: 'How much of the portfolio is in its five largest holdings.',
      scaleMax: 100,
      watchAt: 50,
      highAt: 75,
      formula: 'Value = five largest position values ÷ total portfolio value × 100.',
      definition: 'Adds the current value of the five largest positions, then compares it with the portfolio total. Five or fewer positions means 100%.',
      basis: 'Uses current position values.',
    },
  ].map((row) => ({
    ...row,
    width: row.value == null ? 0 : Math.min(100, (row.value / row.scaleMax) * 100),
    status: row.value == null ? null : riskStatus(row.value, row.watchAt, row.highAt),
  }))

  return (
    <div className="risk-profile">
      <div className="risk-bars">
        {riskRows.map((row) => {
          const tooltipId = `risk-definition-${row.id}`
          const isOpen = openDefinition === row.id
          const statusLabel = row.status == null ? 'Unavailable' : row.status === 'lower' ? 'Lower concern' : row.status === 'watch' ? 'Watch' : 'High concern'
          const displayedStatus = hideValues || row.status == null ? 'hidden' : row.status
          const reading = row.value == null ? 'Unavailable' : `${row.value.toFixed(1)}%`
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
                        <strong>{row.label}</strong>
                        <span>{row.definition}</span>
                        <span><b>Formula</b> {row.formula}</span>
                        <span><b>Guide</b> Watch at {row.watchAt}% · High at {row.highAt}%</span>
                        <small>Bar scale 0–{row.scaleMax}%. {row.basis} Screening guide only.</small>
                      </span>
                    </button>
                  </span>
                  <span className="risk-summary">{row.summary}</span>
                </div>
                <div className="risk-reading">
                  <strong>{mask(row.value == null ? '—' : reading)}</strong>
                  <span className={`risk-status risk-status--${displayedStatus}`}>{hideValues ? 'Hidden' : statusLabel}</span>
                </div>
              </div>

              <div className="risk-track" role="img" aria-label={hideValues ? `${row.label}: hidden` : `${row.label}: ${reading}, ${statusLabel}. Bar scale 0 to ${row.scaleMax}%.`}>
                <span className="risk-track-zone risk-track-zone--lower" style={{ width: `${row.watchAt / row.scaleMax * 100}%` }} />
                <span className="risk-track-zone risk-track-zone--watch" style={{ width: `${(row.highAt - row.watchAt) / row.scaleMax * 100}%` }} />
                <span className="risk-track-zone risk-track-zone--high" style={{ width: `${(row.scaleMax - row.highAt) / row.scaleMax * 100}%` }} />
                <span className={`risk-fill risk-fill--${displayedStatus}`} style={{ width: hideValues ? 0 : `${row.width}%` }} />
              </div>

            </article>
          )
        })}
      </div>
    </div>
  )
}
