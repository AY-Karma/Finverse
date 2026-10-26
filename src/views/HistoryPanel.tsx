import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveYahooSymbol } from '../live'
import type { HistoryPoint } from '../live'
import { instrumentLabel } from '../instruments'
import { marketData } from '../marketData'
import type { Position } from '../types'
import { useStore } from '../useStore'
import { quoteKey } from '../valuation'
import { InteractiveTrendChart } from './InteractiveTrendChart'
import { HiddenValuesState } from './HiddenValuesState'
import './historyPanel.css'

type ScopeFilter = 'all' | 'equity' | 'mutual'

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

function fmtY(v: number): string {
  return Math.abs(v) >= 1000
    ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
    : v.toFixed(2)
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function historyOptions(positions: Position[]) {
  const labelCounts = new Map<string, number>()
  for (const position of positions) {
    const label = norm(instrumentLabel(position))
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
  }
  const options = positions.map((position) => {
    const label = instrumentLabel(position)
    if (labelCounts.get(norm(label)) === 1) return { position, label }
    const details = position.type === 'mutual-fund'
      ? [position.mfScheme?.name, position.mfScheme && `Scheme ${position.mfScheme.code}`, position.currency ?? 'INR']
      : [position.exchange, position.currency, position.providerSymbol, position.isin]
    return { position, label: [label, ...details.filter(Boolean)].join(' · ') }
  })
  const descriptionCounts = new Map<string, number>()
  for (const option of options) {
    const label = norm(option.label)
    descriptionCounts.set(label, (descriptionCounts.get(label) ?? 0) + 1)
  }
  const holdingNumbers = new Map<string, number>()
  return options.map((option) => {
    const label = norm(option.label)
    if (descriptionCounts.get(label) === 1) return option
    const number = (holdingNumbers.get(label) ?? 0) + 1
    holdingNumbers.set(label, number)
    return { ...option, label: `${option.label} · Holding ${number}` }
  })
}

interface HistoryResult {
  key: string
  points: HistoryPoint[]
  usedLabel: string
  loading: boolean
  error: string | null
}

export function HistoryPanel({ scope, position, active = true }: { scope: ScopeFilter; position?: Position; active?: boolean }) {
  const { positions, settings } = useStore()
  const boundToPosition = position !== undefined
  const all = useMemo(
    () => boundToPosition ? [] : positions.filter((p) => (p.ticker || '').trim() !== '' || (p.name || '').trim() !== ''),
    [positions, boundToPosition],
  )
  // The dropdown mirrors the top All / Equity / Mutual Funds filter, so a
  // scoped board only offers scoped options.
  const scopeHistoryable = useMemo(() => {
    const list =
      scope === 'all' ? all : all.filter((p) => (scope === 'mutual' ? p.type === 'mutual-fund' : p.type !== 'mutual-fund'))
    return [...list].sort((a, b) => instrumentLabel(a).localeCompare(instrumentLabel(b)))
  }, [all, scope])
  const options = useMemo(() => historyOptions(scopeHistoryable), [scopeHistoryable])

  const [text, setText] = useState('')
  const [committedId, setCommittedId] = useState<string | null>(null)
  const [rangeDays, setRangeDays] = useState(366)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const [result, setResult] = useState<HistoryResult | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Until the user commits a pick, default to the first holding in scope so the
  // panel shows a chart immediately, and re-defaults when the scope changes.
  const selectedOption = options.find(({ position }) => position.id === committedId) ?? options[0]
  const holding = position ?? selectedOption?.position
  const holdingLabel = position ? instrumentLabel(position) : selectedOption?.label ?? ''
  const holdingRef = useRef(holding)
  holdingRef.current = holding
  const requestIdentity = holding ? JSON.stringify([
    holding.id, quoteKey(holding), holding.type, holding.providerSymbol, holding.exchange,
    holding.currency, holding.reportedCurrency, holding.isin, holding.identityIssue,
    holding.type === 'mutual-fund' ? holding.name : holding.ticker, holding.mfScheme?.code,
  ]) : null
  const requestKey = JSON.stringify([requestIdentity, rangeDays, retryAttempt])
  const currentResult = active && settings.allowExternalData && result?.key === requestKey ? result : null
  const points = currentResult?.points ?? []
  const loading = currentResult?.loading ?? false
  const error = currentResult?.error ?? null
  const usedLabel = currentResult?.usedLabel ?? ''

  useEffect(() => {
    if (committedId && !options.some(({ position }) => position.id === committedId)) setCommittedId(null)
  }, [committedId, options])

  useEffect(() => {
    setText(holdingLabel)
  }, [holdingLabel])

  useEffect(() => {
    const requestedHolding = holdingRef.current
    if (!active || !settings.allowExternalData || !requestedHolding) {
      setResult(null)
      return
    }
    let alive = true
    const controller = new AbortController()
    const key = JSON.stringify([requestIdentity, rangeDays, retryAttempt])
    const label = instrumentLabel(requestedHolding)
    const isMf = requestedHolding.type === 'mutual-fund'
    const usedLabel = isMf ? 'mfapi.in' : resolveYahooSymbol(requestedHolding) ?? label
    setResult({ key, points: [], usedLabel, loading: true, error: null })
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
            : `No price data for “${label}”. Retry, or check the ticker, exchange, or provider symbol.`
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
    if (!holding || points.length === 0) return null
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

  const isMf = holding?.type === 'mutual-fund'
  const nativeCurrency = holding?.currency ?? 'INR'
  const currencySymbol = '\u20b9'
  const formatPrice = (value: number) => `${currencySymbol}${fmtY(value)}`
  const sourceLabel = isMf ? `NAV · ${usedLabel}` : usedLabel ? `daily close · ${usedLabel}` : 'daily close · Yahoo NSE'
  const rangeLabel = RANGES.find((r) => r.days === rangeDays)?.label.toLowerCase() ?? 'range'

  const commit = () => {
    const v = text.trim()
    if (!v) return
    const matched = options.find((option) => norm(option.label) === norm(v))
    if (!matched) return
    setText(matched.label)
    setCommittedId(matched.position.id)
    setRetryAttempt((attempt) => attempt + 1)
    inputRef.current?.focus()
  }

  return (
    <div className="panel history-panel chart-open enter d4">
      <div className="panel-head">
        <div className="panel-head-titles">
          <span className="panel-title">Holding Price History</span>
          {!position && <span className="section-index">06 · Trends</span>}
        </div>
        {!settings.hideValues && <div className="history-tools">
          {!position && <div className="history-picker">
            <input
              ref={inputRef}
              className="input history-input"
              list="history-symbols"
              placeholder="Pick a holding from your portfolio…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
              }}
              aria-label="Holding from your portfolio"
            />
            <datalist id="history-symbols">
              {options.map(({ position, label }) => (
                <option key={position.id} value={label} />
              ))}
            </datalist>
            <button className="btn btn--primary btn--small history-track" onClick={commit} disabled={!text.trim()}>
              {error && norm(text) === norm(holdingLabel) ? 'Retry' : 'Track'}
            </button>
          </div>}
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
        </div>}
      </div>

      <div className="history-body">
        {settings.hideValues ? (
          <HiddenValuesState />
        ) : !settings.allowExternalData ? (
          <p className="hint muted">Enable external market data in Settings to fetch price history.</p>
        ) : !active ? (
          <p className="hint muted">Open this view to load price history.</p>
        ) : !holding ? (
          <p className="hint muted">Select a holding from your portfolio to plot its history.</p>
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
                        {rangeChange.change >= 0 ? '+' : '-'}{formatPrice(Math.abs(rangeChange.change))}
                        <span>({rangeChange.pct >= 0 ? '+' : ''}{rangeChange.pct.toFixed(2)}%)</span>
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
                    <span>Latest {isMf ? 'NAV' : 'close'} vs cost <strong className={costComparison.pct >= 0 ? 'up' : 'down'}>{costComparison.change >= 0 ? '+' : '−'}{formatPrice(Math.abs(costComparison.change))} ({costComparison.pct >= 0 ? '+' : ''}{costComparison.pct.toFixed(1)}%)</strong></span>
                  </div>
                )}
              </>
            )}
            {error && <div className="hint history-error down" role="alert">{error}{position && <button type="button" className="btn btn--ghost btn--small" onClick={() => setRetryAttempt((attempt) => attempt + 1)}>Retry</button>}</div>}
            {!loading && points.length < 2 && !error && <p className="hint muted history-empty">Not enough data in this range.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
