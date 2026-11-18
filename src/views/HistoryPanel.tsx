import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveYahooSymbol } from '../live'
import type { HistoryPoint } from '../live'
import { instrumentLabel } from '../instruments'
import { marketData } from '../marketData'
import type { Position } from '../types'
import { useStore } from '../useStore'
import { numberFormatter } from '../formatters'
import { quoteKey, signedPercent } from '../valuation'
import { InteractiveTrendChart } from './InteractiveTrendChart'
import './historyPanel.css'

const RANGES: { label: string; days: number }[] = [
  { label: '1M', days: 31 },
  { label: '3M', days: 92 },
  { label: '6M', days: 184 },
  { label: '1Y', days: 366 },
  { label: '2Y', days: 731 },
]

const LINE_COLOR = 'var(--holding-chart-line)'
const COST_LINE_COLOR = 'var(--holding-chart-cost)'

type HistoryChartRow = {
  at: number
  close: number | undefined
}

function historyRows(points: HistoryPoint[]): HistoryChartRow[] {
  let breakBefore = false
  const dated = points.flatMap((point) => {
    const at = Date.parse(point?.date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point?.date) || !Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== point.date) {
      breakBefore = true
      return []
    }
    const row = { at, close: Number.isFinite(point.close) && point.close > 0 ? point.close : undefined, breakBefore }
    breakBefore = false
    return [row]
  }).sort((a, b) => a.at - b.at)
  const rows: HistoryChartRow[] = []
  for (const point of new Map(dated.map((row) => [row.at, row])).values()) {
    const previous = rows[rows.length - 1]
    if (previous && previous.close !== undefined && point.breakBefore) {
      rows.push({ at: previous.at + (point.at - previous.at) / 2, close: undefined })
    }
    rows.push({ at: point.at, close: point.close })
  }
  return rows
}

const axisFormat = numberFormatter({ maximumFractionDigits: 0 })
function fmtY(v: number): string {
  return Math.abs(v) >= 1000
    ? axisFormat.format(v)
    : v.toFixed(2)
}

interface HistoryResult {
  key: string
  points: HistoryPoint[]
  usedLabel: string
  loading: boolean
  error: string | null
}

export function HistoryPanel({ position, active = true }: { position: Position; active?: boolean }) {
  const { settings } = useStore()
  const [rangeDays, setRangeDays] = useState(366)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const [result, setResult] = useState<HistoryResult | null>(null)

  const holding = position
  const holdingLabel = instrumentLabel(position)
  const listingUnconfirmed = position.type === 'stock' || position.type === 'etf' ? !resolveYahooSymbol(position) : false
  const holdingRef = useRef(holding)
  holdingRef.current = holding
  const requestIdentity = JSON.stringify([
    holding.id, quoteKey(holding), holding.type, holding.providerSymbol, holding.exchange,
    holding.currency, holding.reportedCurrency, holding.isin, holding.identityIssue,
    holding.type === 'mutual-fund' ? holding.name : holding.ticker, holding.mfScheme?.code,
  ])
  const requestKey = JSON.stringify([requestIdentity, rangeDays, retryAttempt])
  const currentResult = active && settings.allowExternalData && result?.key === requestKey ? result : null
  const points = currentResult?.points ?? []
  const loading = currentResult?.loading ?? false
  const error = currentResult?.error ?? null
  const usedLabel = currentResult?.usedLabel ?? ''

  useEffect(() => {
    const requestedHolding = holdingRef.current
    if (!active) return
    if (!settings.allowExternalData) {
      setResult(null)
      return
    }
    let alive = true
    const controller = new AbortController()
    const key = JSON.stringify([requestIdentity, rangeDays, retryAttempt])
    const label = instrumentLabel(requestedHolding)
    const isMf = requestedHolding.type === 'mutual-fund'
    const usedLabel = isMf ? 'mfapi.in' : resolveYahooSymbol(requestedHolding) ?? label
    setResult((previous) => ({ key, points: previous?.key === key ? previous.points : [], usedLabel, loading: true, error: null }))
    const to = new Date()
    const from = new Date(to.getTime() - rangeDays * 24 * 60 * 60 * 1000)
    const run = async () => {
      try {
        const points = await marketData.history(requestedHolding, from, to, controller.signal)
        if (!alive) return
        const error = points.length > 0 ? null : requestedHolding.type === 'other'
          ? `Price history is unavailable for “${label}” from the current provider.`
          : isMf
            ? `Couldn't find “${label}” on mfapi.in, or no NAVs exist for this range.`
            : resolveYahooSymbol(requestedHolding)
              ? `No price data for “${label}” from the provider. Retry later.`
              : `Confirm this listing in Settings to load price history for “${label}”.`
        setResult({ key, points, usedLabel, loading: false, error })
      } catch {
        if (!alive) return
        setResult({ key, points: [], usedLabel, loading: false, error: isMf
          ? `Couldn't load NAV history for “${label}”. Please try again.`
          : `Couldn't load price history for “${label}”. Please try again.` })
      }
    }
    void run()
    return () => {
      alive = false
      controller.abort()
    }
  }, [requestIdentity, rangeDays, retryAttempt, active, settings.allowExternalData])

  const chartData = useMemo(
    () => historyRows(points),
    [points],
  )

  const rangeChange = useMemo(() => {
    if (points.length < 2) return null
    const first = points[0].close
    const last = points[points.length - 1].close
    if (first <= 0) return null
    return { last, change: last - first, pct: ((last - first) / first) * 100 }
  }, [points])

  const costComparison = useMemo(() => {
    if (points.length === 0) return null
    const buy = holding.buyPrice
    if (!Number.isFinite(buy) || buy <= 0) return null
    const last = points[points.length - 1].close
    const pct = ((last - buy) / buy) * 100
    return {
      buy,
      pct,
      change: last - buy,
    }
  }, [holding, points])

  const isMf = holding.type === 'mutual-fund'
  const nativeCurrency = holding.currency ?? 'INR'
  const currencySymbol = '\u20b9'
  const formatPrice = (value: number) => `${currencySymbol}${fmtY(value)}`
  const signedPrice = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatPrice(Math.abs(value))}`
  const sourceLabel = isMf ? `NAV · ${usedLabel}` : usedLabel ? `daily close · ${usedLabel}` : 'daily close · Yahoo NSE'
  const rangeLabel = RANGES.find((r) => r.days === rangeDays)?.label.toLowerCase() ?? 'range'

  return (
    <div className="panel history-panel chart-open enter d4">
      <div className="panel-head">
        <div className="panel-head-titles">
          <span className="panel-title">Holding Price History</span>
        </div>
        <div className="history-tools">
          <div className="history-range" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                className={`range-btn${rangeDays === r.days ? ' range-btn--active' : ''}`}
                aria-pressed={rangeDays === r.days}
                onClick={() => setRangeDays(r.days)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="history-body">
        {!settings.allowExternalData ? (
          <p className="hint muted">Market data is paused because this workspace changed in another tab. Reload to continue.</p>
        ) : !active ? (
          <p className="hint muted">Open this view to load price history.</p>
        ) : (
          <div className="history-stage">
            {(loading || points.length >= 2) && (
              <>
                <div className="history-summary">
                  <div className="history-summary-main">
                    <span className="history-name sym" title={holdingLabel}>{holdingLabel}</span>
                    {rangeChange && <div className="history-quote">
                      <span className="history-last"><small>{currencySymbol}</small>{fmtY(rangeChange.last)}</span>
                      <span className={`history-delta ${rangeChange.pct >= 0 ? 'up' : 'down'}`}>
                        {signedPrice(rangeChange.change)}
                        <span>({signedPercent(rangeChange.pct)})</span>
                        <small>{rangeLabel}</small>
                      </span>
                    </div>}
                  </div>
                  <span className="history-source muted">{sourceLabel}</span>
                </div>

                <div className="history-chart-wrap">
                  <div className="history-chart" style={{ opacity: loading ? 0.4 : 1, transition: 'opacity 0.15s ease' }}>
                    {points.length >= 2 ? (
                      <InteractiveTrendChart
                        key={`${requestIdentity}-${rangeDays}`}
                        rows={chartData}
                        lines={[{ key: 'close', label: isMf ? 'NAV' : 'Close', color: LINE_COLOR }]}
                        valueFormatter={formatPrice}
                        yAxisLabel={`${isMf ? 'NAV' : 'Price'} (${nativeCurrency})`}
                        appearance="price"
                        referenceLines={costComparison ? [{
                          value: costComparison.buy,
                          color: COST_LINE_COLOR,
                          label: 'Avg cost',
                        }] : undefined}
                      />
                    ) : (
                      <p className="hint muted history-empty">Not enough data in this range yet.</p>
                    )}
                  </div>
                  {loading && (
                    <div className="history-overlay">
                      <span>Fetching {holdingLabel}…</span>
                    </div>
                  )}
                </div>

                {costComparison && !loading && (
                  <div className="history-cost-summary">
                    <span><i aria-hidden="true" />Avg cost <strong>{formatPrice(costComparison.buy)}</strong></span>
                    <span>Latest {isMf ? 'NAV' : 'close'} vs cost <strong className={costComparison.pct >= 0 ? 'up' : 'down'}>{signedPrice(costComparison.change)} ({signedPercent(costComparison.pct, 1)})</strong></span>
                  </div>
                )}
              </>
            )}
            {error && <div className="hint history-error down" role="alert">{error}{!listingUnconfirmed && <button type="button" className="btn btn--ghost btn--small" onClick={() => setRetryAttempt((attempt) => attempt + 1)}>Retry</button>}</div>}
            {!loading && points.length < 2 && !error && <p className="hint muted history-empty">Not enough data in this range.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
