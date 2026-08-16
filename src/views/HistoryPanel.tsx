import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { resolveYahooSymbol } from '../live'
import type { HistoryPoint } from '../live'
import { instrumentLabel } from '../instruments'
import { marketData } from '../marketData'
import { downsampleSeries } from '../timeSeries'
import type { Position } from '../types'
import { useStore } from '../useStore'

export type ScopeFilter = 'all' | 'equity' | 'mutual'

const RANGES: { label: string; days: number }[] = [
  { label: '1M', days: 31 },
  { label: '3M', days: 92 },
  { label: '6M', days: 184 },
  { label: '1Y', days: 366 },
  { label: '2Y', days: 731 },
]

const MAX_POINTS = 160

const LINE_COLOR = '#5e6ad2'
const PURCHASE_DOT = '#f2b53c'
const AXIS_STYLE = { fill: '#8a8f98', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }
const TOOLTIP_STYLE = {
  background: '#151619',
  border: '1px solid #32343b',
  borderRadius: 8,
  color: '#f7f8f8',
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: 12,
}



function fmtY(v: number): string {
  return Math.abs(v) >= 1000
    ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
    : v.toFixed(2)
}

function fmtX(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function fmtDay(ts: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(ts))
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

  const fetchOutcome = async (q: Query, from: Date, to: Date): Promise<FetchOutcome> => {
    if (q.position) {
      const pts = await marketData.history(q.position, from, to)
      if (pts.length > 0) return { points: pts, usedLabel: q.kind === 'mf' ? 'mfapi.in' : resolveYahooSymbol(q.position) ?? q.label }
    }
    return { points: [], usedLabel: q.kind === 'mf' ? 'mfapi.in' : resolveYahooSymbol(q.position!) ?? q.label }
  }

  useEffect(() => {
    if (!settings.allowExternalData || !query) {
      setPoints([])
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    const to = new Date()
    const from = new Date(to.getTime() - rangeDays * 24 * 60 * 60 * 1000)
    const run = async () => {
      const out = await fetchOutcome(query, from, to)
      if (!alive) return
      setPoints(out.points)
      setUsedLabel(out.usedLabel)
      setLoading(false)
      if (out.points.length === 0) {
        setError(
          query.kind === 'mf'
            ? `Couldn't find “${query.label}” on mfapi.in, or no NAVs exist for this range.`
            : `No price data for “${query.label}”. Check the ticker, exchange, or provider symbol.`,
        )
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [query, rangeDays, settings.allowExternalData])

  const chartData = useMemo(
    () =>
      downsampleSeries(points, MAX_POINTS).map((p) => ({
        ts: +new Date(`${p.date}T00:00:00`),
        close: p.close,
        date: p.date,
      })),
    [points],
  )

  const rangeChange = useMemo(() => {
    if (points.length < 2) return null
    const first = points[0].close
    const last = points[points.length - 1].close
    if (first <= 0) return null
    return { last, pct: ((last - first) / first) * 100 }
  }, [points])

  /** Purchase marker + "since you bought" stat, inferred from the cost basis
   *  (the closest daily close to buyPrice pins the date; growth is always
   *  computed from buyPrice against the latest close). */
  const purchase = useMemo(() => {
    if (!holding || points.length === 0) return null
    const buy = holding.buyPrice
    if (!Number.isFinite(buy) || buy <= 0) return null
    let best = -1
    let bestDiff = Infinity
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].close - buy) / buy
      if (d < bestDiff) {
        bestDiff = d
        best = i
      }
    }
    const pinned = best >= 0 ? points[best] : points[0]
    const last = points[points.length - 1].close
    const pct = ((last - buy) / buy) * 100
    return {
      buy,
      last,
      pct,
      close: pinned.close,
      date: pinned.date,
      pinned: bestDiff <= 0.25,
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
    inputRef.current?.focus()
  }

  return (
    <div className="panel history-panel enter d4">
      <div className="panel-head">
        <div className="panel-head-titles">
          <span className="panel-title">Holding Price History</span>
          <span className="section-index">03 · Trends</span>
        </div>
        <div className="history-tools">
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
              Track
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
        </div>
      </div>

      <div className="history-body">
        {!settings.allowExternalData ? (
          <p className="hint muted">Enable external market data in Settings to fetch price history.</p>
        ) : !query ? (
          <p className="hint muted">Select a holding from your portfolio to plot its history.</p>
        ) : (
          <div className="history-stage">
            {(loading || points.length >= 2) && (
              <>
                <div className="history-summary">
                  <span className="history-name sym" title={query.label}>
                    {query.label}
                  </span>
                  {rangeChange && (
                    <>
                      <span className="history-last">{fmtY(rangeChange.last)}</span>
                      <span className={`history-delta ${rangeChange.pct >= 0 ? 'up' : 'down'}`}>
                        {rangeChange.pct >= 0 ? '+' : ''}
                        {rangeChange.pct.toFixed(2)}% over {rangeLabel}
                      </span>
                    </>
                  )}
                  <span className="history-source muted">{sourceLabel}</span>
                </div>

                <div className="history-chart-wrap">
                  <div className="history-chart" style={{ opacity: loading ? 0.4 : 1, transition: 'opacity 0.15s ease' }}>
                    {points.length >= 2 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#22242a" vertical={false} />
                          <XAxis
                            dataKey="ts"
                            type="number"
                            domain={['dataMin', 'dataMax']}
                            tick={AXIS_STYLE}
                            tickFormatter={(ts) => fmtX(Number(ts))}
                            minTickGap={56}
                          />
                          <YAxis tick={AXIS_STYLE} width={62} tickFormatter={fmtY} domain={['auto', 'auto']} />
                          <Tooltip
                            formatter={(v) => fmtY(Number(v))}
                            labelFormatter={(l) => fmtDay(Number(l))}
                            contentStyle={TOOLTIP_STYLE}
                          />
                          <Line
                            type="monotone"
                            dataKey="close"
                            stroke={LINE_COLOR}
                            strokeWidth={1.8}
                            dot={false}
                            isAnimationActive={false}
                          />
                          {purchase && purchase.pinned && (
                            <>
                              <ReferenceLine
                                x={+new Date(`${purchase.date}T00:00:00`)}
                                stroke="#8a8f98"
                                strokeDasharray="4 4"
                                strokeOpacity={0.55}
                              />
                              <ReferenceDot
                                x={+new Date(`${purchase.date}T00:00:00`)}
                                y={purchase.close}
                                r={5}
                                fill={PURCHASE_DOT}
                                stroke="#0e0f11"
                                strokeWidth={1.5}
                              />
                            </>
                          )}
                        </LineChart>
                      </ResponsiveContainer>
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

                {error && <p className={`hint history-error${error ? ' down' : ''}`}>{error}</p>}

                {purchase && !loading && (
                  <div className={`history-purchase ${purchase.pct >= 0 ? 'up' : 'down'}`}>
                    <span className="history-purchase-badge" aria-hidden="true">
                      {purchase.pct >= 0 ? '▲' : '▼'}
                    </span>
                    <span>
                      Your <strong>{query.label}</strong> is {purchase.pct >= 0 ? 'up' : 'down'}{' '}
                      <span className="history-purchase-change">{Math.abs(purchase.pct).toFixed(1)}%</span> since you{' '}
                      {isMf ? 'started this investment' : 'bought'}
                      {purchase.pinned ? <> (≈ {fmtDay(+new Date(`${purchase.date}T00:00:00`))})</> : null} —{' '}
                      {fmtY(purchase.buy)} → <span className="history-current-price">{fmtY(purchase.last)}</span>.
                    </span>
                  </div>
                )}
              </>
            )}
            {!loading && points.length < 2 && !error && <p className="hint muted history-empty">Not enough data in this range.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
