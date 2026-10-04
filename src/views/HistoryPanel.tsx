import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveYahooSymbol } from '../live'
import type { HistoryPoint } from '../live'
import { instrumentLabel } from '../instruments'
import { marketData } from '../marketData'
import type { Position } from '../types'
import { useStore } from '../useStore'
import { InteractiveTrendChart } from './InteractiveTrendChart'
import { HiddenValuesState } from './HiddenValuesState'

type ScopeFilter = 'all' | 'equity' | 'mutual'

const RANGES: { label: string; days: number }[] = [
  { label: '1M', days: 31 },
  { label: '3M', days: 92 },
  { label: '6M', days: 184 },
  { label: '1Y', days: 366 },
  { label: '2Y', days: 731 },
]

const LINE_COLOR = '#5e6ad2'
const COST_MARKER_COLOR = '#f2b53c'

function fmtY(v: number): string {
  return Math.abs(v) >= 1000
    ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
    : v.toFixed(2)
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Bare NSE tickers default to `.NS` so a symbol works for any Yahoo lookup.
 *  Strips NSE series suffixes (-EQ, -BE, -SM, -ST, -T, -BL, -Z, -E, -B, -N, -W) before appending .NS. */
interface Query {
  kind: 'equity' | 'mf'
  label: string
  position?: Position
}

interface FetchOutcome {
  points: HistoryPoint[]
  usedLabel: string
}

export function HistoryPanel({ scope }: { scope: ScopeFilter }) {
  const { positions, settings } = useStore()
  const all = useMemo(
    () => positions.filter((p) => (p.ticker || '').trim() !== '' || (p.name || '').trim() !== ''),
    [positions],
  )
  // The dropdown mirrors the top All / Equity / Mutual Funds filter, so a
  // scoped board only offers scoped options.
  const scopeHistoryable = useMemo(() => {
    const list =
      scope === 'all' ? all : all.filter((p) => (scope === 'mutual' ? p.type === 'mutual-fund' : p.type !== 'mutual-fund'))
    return [...list].sort((a, b) => instrumentLabel(a).localeCompare(instrumentLabel(b)))
  }, [all, scope])

  const [text, setText] = useState('')
  const [committed, setCommitted] = useState<string | null>(null)
  const [rangeDays, setRangeDays] = useState(366)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const [points, setPoints] = useState<HistoryPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usedLabel, setUsedLabel] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Until the user commits a pick, default to the first holding in scope so the
  // panel shows a chart immediately, and re-defaults when the scope changes.
  const effective = committed ?? (scopeHistoryable.length ? instrumentLabel(scopeHistoryable[0]) : '')
  const holding = useMemo(
    () => scopeHistoryable.find((p) => norm(instrumentLabel(p)) === norm(effective)),
    [scopeHistoryable, effective],
  )

  const holdingLabel = holding ? instrumentLabel(holding) : ''

  useEffect(() => {
    setText(holdingLabel)
  }, [holdingLabel])

  const query = useMemo<Query | null>(() => {
    if (holding) {
      return holding.type === 'mutual-fund'
        ? {
            kind: 'mf',
            label: instrumentLabel(holding),
            position: holding,
          }
        : { kind: 'equity', label: instrumentLabel(holding), position: holding }
    }
    return null
  }, [holding?.id, holding?.name, holding?.providerSymbol, holding?.ticker, holding?.type])

  const fetchOutcome = async (q: Query, from: Date, to: Date, signal: AbortSignal): Promise<FetchOutcome> => {
    if (q.position) {
      const pts = await marketData.history(q.position, from, to, signal)
      if (pts.length > 0) return { points: pts, usedLabel: q.kind === 'mf' ? 'mfapi.in' : resolveYahooSymbol(q.position) ?? q.label }
    }
    return { points: [], usedLabel: q.kind === 'mf' ? 'mfapi.in' : resolveYahooSymbol(q.position!) ?? q.label }
  }

  useEffect(() => {
    if (!settings.allowExternalData || !query) {
      setPoints([])
      setError(null)
      setLoading(false)
      return
    }
    let alive = true
    const controller = new AbortController()
    setLoading(true)
    setPoints([])
    setError(null)
    const to = new Date()
    const from = new Date(to.getTime() - rangeDays * 24 * 60 * 60 * 1000)
    const run = async () => {
      try {
        const out = await fetchOutcome(query, from, to, controller.signal)
        if (!alive) return
        setPoints(out.points)
        setUsedLabel(out.usedLabel)
        if (out.points.length === 0) {
          setError(
            query.kind === 'mf'
              ? `Couldn't find “${query.label}” on mfapi.in, or no NAVs exist for this range.`
              : `No price data for “${query.label}”. Retry, or check the ticker, exchange, or provider symbol.`,
          )
        }
      } catch {
        if (!alive) return
        setError(
          query.kind === 'mf'
            ? `Couldn't load NAV history for “${query.label}”. Please try again.`
            : `Couldn't load price history for “${query.label}”. Please try again.`,
        )
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
      controller.abort()
    }
  }, [query, rangeDays, retryAttempt, settings.allowExternalData])

  const chartData = useMemo(
    () =>
      points.map((p) => ({
        at: +new Date(`${p.date}T00:00:00`),
        close: p.close,
      })),
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
    const closest = points.reduce((nearest, point) => Math.abs(point.close - buy) < Math.abs(nearest.close - buy) ? point : nearest, points[0])
    return {
      buy,
      last,
      pct,
      markerAt: +new Date(`${closest.date}T00:00:00`),
    }
  }, [holding, points])

  const isMf = query?.kind === 'mf'
  const sourceLabel = isMf ? `NAV · ${usedLabel}` : usedLabel ? `daily close · ${usedLabel}` : 'daily close · Yahoo NSE'
  const rangeLabel = RANGES.find((r) => r.days === rangeDays)?.label.toLowerCase() ?? 'range'

  const commit = () => {
    const v = text.trim()
    if (!v) return
    const matched = scopeHistoryable.find((p) => norm(instrumentLabel(p)) === norm(v))
    if (!matched) return
    setText(instrumentLabel(matched))
    setCommitted(instrumentLabel(matched))
    setRetryAttempt((attempt) => attempt + 1)
    inputRef.current?.focus()
  }

  return (
    <div className="panel history-panel enter d4">
      <div className="panel-head">
        <div className="panel-head-titles">
          <span className="panel-title">Holding Price History</span>
          <span className="section-index">03 · Trends</span>
        </div>
        {!settings.hideValues && <div className="history-tools">
          <div className="history-picker">
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
              {scopeHistoryable.map((p) => (
                <option key={p.id} value={instrumentLabel(p)} />
              ))}
            </datalist>
            <button className="btn btn--primary btn--small history-track" onClick={commit} disabled={!text.trim()}>
              {error && norm(text) === norm(effective) ? 'Retry' : 'Track'}
            </button>
          </div>
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
        ) : !query ? (
          <p className="hint muted">Select a holding from your portfolio to plot its history.</p>
        ) : (
          <div className="history-stage">
            {(loading || points.length >= 2) && (
              <>
                <div className="history-summary">
                  <div className="history-summary-main">
                    <span className="history-name sym" title={query.label}>{query.label}</span>
                    {rangeChange && <div className="history-quote">
                      <span className="history-last"><small>₹</small>{fmtY(rangeChange.last)}</span>
                      <span className={`history-delta ${rangeChange.pct >= 0 ? 'up' : 'down'}`}>
                        {rangeChange.change >= 0 ? '+' : '-'}₹{fmtY(Math.abs(rangeChange.change))}
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
                        key={`${holding?.id ?? query.label}-${rangeDays}`}
                        rows={chartData}
                        lines={[{ key: 'close', label: isMf ? 'NAV' : 'Close', color: LINE_COLOR }]}
                        valueFormatter={fmtY}
                        yAxisLabel={isMf ? 'NAV' : 'Price'}
                        appearance="price"
                        markers={costComparison ? [{
                          at: costComparison.markerAt,
                          value: costComparison.buy,
                          color: COST_MARKER_COLOR,
                          label: 'Avg cost',
                          description: `Average cost: ${fmtY(costComparison.buy)}. Positioned by the closest historical close for reference, not a purchase date.`,
                        }] : undefined}
                      />
                    ) : (
                      <p className="hint muted history-empty">Not enough data in this range yet.</p>
                    )}
                  </div>
                  {loading && (
                    <div className="history-overlay">
                      <span>Fetching {query.label}…</span>
                    </div>
                  )}
                </div>

                {costComparison && !loading && (
                  <div className={`history-purchase history-purchase--${costComparison.pct >= 0 ? 'up' : 'down'}`}>
                    <span className="history-purchase-badge" aria-hidden="true">
                      {costComparison.pct >= 0 ? '▲' : '▼'}
                    </span>
                    <span>
                      The latest {isMf ? 'NAV' : 'close'} for <strong>{query.label}</strong> is{' '}
                      <span className="history-purchase-change">{Math.abs(costComparison.pct).toFixed(1)}%</span>{' '}
                      {costComparison.pct >= 0 ? 'above' : 'below'} your average cost.{' '}
                      {fmtY(costComparison.buy)} → <span className="history-current-price">{fmtY(costComparison.last)}</span>.{' '}
                      The Avg cost marker uses the closest historical close for placement, not a purchase date.
                    </span>
                  </div>
                )}
              </>
            )}
            {error && <p className="hint history-error down" role="alert">{error}</p>}
            {!loading && points.length < 2 && !error && <p className="hint muted history-empty">Not enough data in this range.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
