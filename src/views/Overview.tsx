import { useEffect, useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { computeStats, formatCurrency, formatPercent } from '../store'
import { useStore } from '../useStore'
import type { Currency, LiveQuote, Position } from '../types'
import type { View } from '../useStore'
import { isLiveQuote, isMarketOpen, livePriceOf, marketStatusText } from '../live'
import { marketLinks, resolveScreenerCompanyPath, screenerSectionLinks } from '../research'
import type { ResearchLink } from '../research'

const PIE_COLORS = [
  '#5e6ad2',
  '#828fff',
  '#7a7fad',
  '#8a8f98',
  '#4a5bb0',
  '#a0a5b5',
  '#6d78d8',
  '#9a9fd0',
]

const TOOLTIP_STYLE = {
  background: '#151619',
  border: '1px solid #32343b',
  borderRadius: 8,
  color: '#f7f8f8',
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: 12,
}

type Scope = 'all' | 'equity' | 'mutual'
type SortField = 'symbol' | 'qty' | 'buy' | 'ltp' | 'value' | 'pnl'
type SortDir = 'asc' | 'desc'

interface LedgerRow {
  id: string
  symbol: string
  qty: number
  buy: number
  ltp: number | null
  isLive: boolean
  value: number
  pnl: number | null
}

export function Overview({ onGoTo }: { onGoTo: (v: View) => void }) {
  const { positions, settings, setSettings, liveQuotes, refreshNow } = useStore()
  const currency = settings.currency || 'INR'
  const [scope, setScope] = useState<Scope>('all')
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [limitMsg, setLimitMsg] = useState<{ text: string; until?: number } | null>(null)
  const [researchOpen, setResearchOpen] = useState<string | null>(null)
  const [, setNowTick] = useState(0)
  const hideValues = settings.hideValues

  // Live countdown for the manual-refresh rate-limit note.
  useEffect(() => {
    if (!limitMsg?.until) return
    const id = window.setInterval(() => {
      if (limitMsg.until! <= Date.now()) setLimitMsg(null)
      else setNowTick(Date.now())
    }, 1000)
    return () => window.clearInterval(id)
  }, [limitMsg])

  const onManualRefresh = async () => {
    if (refreshing || positions.length === 0) return
    setRefreshing(true)
    try {
      const res = await refreshNow()
      if (!res.ok) {
        setLimitMsg({
          text: res.reason === 'limit' ? 'Manual refresh limit reached (5 per hour).' : 'Refreshing too quickly.',
          until: Date.now() + res.retryInMs,
        })
      } else {
        setLimitMsg(null)
      }
    } finally {
      setRefreshing(false)
    }
  }

  const live = settings.currency === 'INR' ? liveQuotes : {}
  const liveCount = Object.keys(live).length
  const marketOpen = isMarketOpen()

  const MASK = '••••••'
  const mask = (s: string) => (hideValues ? MASK : s)

  const fmtCd = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000))
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
  }

  const equityCount = positions.filter((p) => p.type !== 'mutual-fund').length
  const mfCount = positions.filter((p) => p.type === 'mutual-fund').length

  const scopePositions = useMemo(
    () =>
      scope === 'all'
        ? positions
        : positions.filter((p) => (scope === 'mutual' ? p.type === 'mutual-fund' : p.type !== 'mutual-fund')),
    [positions, scope],
  )

  const pricesMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of positions) {
      const v = livePriceOf(p, live)
      if (v != null) m.set(p.ticker, v)
    }
    return m
  }, [positions, live])

  const stats = computeStats(scopePositions, pricesMap)

  // Top holdings, enriched for the research list: weight, live P&L and the
  // matching position (for type-aware deep-links).
  const researchRows = useMemo(
    () =>
      stats.allocations.map((a) => {
        const p = positions.find((x) => x.ticker === a.symbol)
        const price = p ? livePriceOf(p, live) : null
        const pnl = p && price != null ? price * p.quantity - p.invested : null
        const pct = stats.currentValue > 0 ? (a.value / stats.currentValue) * 100 : 0
        return { a, p, pnl, pct }
      }),
    [stats.allocations, stats.currentValue, positions, live],
  )

  // Hooks are all called unconditionally — no early return may happen above these.
  const ledgerRows: LedgerRow[] = useMemo(
    () =>
      scopePositions.map((p) => {
        const price = livePriceOf(p, live)
        const value = price != null ? price * p.quantity : p.invested
        const pnl = price != null ? value - p.invested : null
        return {
          id: p.id,
          symbol: p.type === 'mutual-fund' ? p.name || p.ticker : p.ticker,
          qty: p.quantity,
          buy: p.buyPrice,
          ltp: price,
          isLive: isLiveQuote(p, live),
          value,
          pnl,
        }
      }),
    [scopePositions, live],
  )

  const sortedRows = useMemo(() => {
    if (!sort) return ledgerRows
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...ledgerRows].sort((a, b) => {
      if (sort.field === 'symbol') return a.symbol.localeCompare(b.symbol) * dir
      if (sort.field === 'qty') return (a.qty - b.qty) * dir
      if (sort.field === 'buy') return (a.buy - b.buy) * dir
      if (sort.field === 'ltp') return ((a.ltp ?? -Infinity) - (b.ltp ?? -Infinity)) * dir
      if (sort.field === 'value') return (a.value - b.value) * dir
      const ap = a.pnl ?? -Infinity
      const bp = b.pnl ?? -Infinity
      return (ap - bp) * dir
    })
  }, [ledgerRows, sort])

  const mfSummary = useMemo(() => {
    if (scope !== 'mutual') return null
    const invested = scopePositions.reduce((s, p) => s + p.invested, 0)
    const current = scopePositions.reduce((s, p) => {
      const price = livePriceOf(p, live)
      return s + (price != null ? price * p.quantity : p.invested)
    }, 0)
    const pnl = current - invested
    const xirrs = scopePositions.map((p) => p.xirr).filter((x): x is number => x != null)
    const xirrAvg = xirrs.length ? xirrs.reduce((s, x) => s + x, 0) / xirrs.length : null
    return { invested, current, pnl, xirrAvg }
  }, [scope, scopePositions, live])

  if (positions.length === 0) {
    return (
      <div className="enter" style={{ display: 'grid', gap: 28, justifyItems: 'center', padding: '12vh 24px', textAlign: 'center' }}>
        <div>
          <div className="page-eyebrow">Finverse — Live Market Scoreboard</div>
          <h1 className="page-title" style={{ textTransform: 'none', maxWidth: 720 }}>
            Step into the arena.
          </h1>
          <p className="page-sub" style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto', marginTop: 12 }}>
            Upload your holdings and Finverse turns a spreadsheet into a live scoreboard — allocation,
            performance, and AI-guided analysis in one command rail.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => onGoTo('import')}>
          Import portfolio →
        </button>
      </div>
    )
  }

  if (scopePositions.length === 0) {
    // Switch to a scope with no holdings yet — point at import rather than a dead page.
    return (
      <div className="enter" style={{ display: 'grid', gap: 28, justifyItems: 'center', padding: '12vh 24px', textAlign: 'center' }}>
        <div>
          <div className="page-eyebrow">Live Market Scoreboard</div>
          <h1 className="page-title" style={{ textTransform: 'none' }}>
            {scope === 'mutual' ? 'No mutual funds on the board yet.' : 'No equity holdings on the board yet.'}
          </h1>
          <p className="page-sub" style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto', marginTop: 12 }}>
            {scope === 'mutual'
              ? 'Import a mutual-fund export (.xlsx) with Scheme Name, Units and Invested Value — Finverse maps it into its own Mutual Funds ledger and allocation mix.'
              : 'Import a broker export (.xlsx / .csv) with ticker, quantity, and cost to run it onto the equity scoreboard.'}
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => onGoTo('import')}>
          Import holdings →
        </button>
      </div>
    )
  }

  const pnlUp = stats.pnl >= 0
  const eff = (p: (typeof positions)[number]) => livePriceOf(p, live)
  const best = scopePositions
    .filter((p) => eff(p) != null && p.invested > 0)
    .sort((a, b) => ((eff(b)! - b.buyPrice) / b.buyPrice) * 100 - ((eff(a)! - a.buyPrice) / a.buyPrice) * 100)[0]
  const bestPct =
    best && eff(best) != null && best.buyPrice > 0
      ? ((eff(best)! - best.buyPrice) / best.buyPrice) * 100
      : null

  const toggleSort = (field: SortField) => {
    setSort((prev) => {
      if (!prev || prev.field !== field) return { field, dir: 'asc' }
      if (prev.dir === 'asc') return { field, dir: 'desc' }
      return null
    })
  }

  const sortIcon = (field: SortField) => {
    if (!sort || sort.field !== field) return '↕'
    return sort.dir === 'asc' ? '▲' : '▼'
  }

  const sortCls = (field: SortField) =>
    sort && sort.field === field ? 'th-sort th-sort--active' : 'th-sort'

  const Th = ({ field, children }: { field: SortField; children: string }) => (
    <th>
      <button className={sortCls(field)} onClick={() => toggleSort(field)}>
        {children}
        <span className="th-sort-icon">{sortIcon(field)}</span>
      </button>
    </th>
  )

  const Scope = () => (
    <div className="scope-switch">
      <button className={`scope-btn${scope === 'all' ? ' scope-btn--active' : ''}`} onClick={() => setScope('all')}>
        All
        <span className="scope-count">{positions.length}</span>
      </button>
      <button className={`scope-btn${scope === 'equity' ? ' scope-btn--active' : ''}`} onClick={() => setScope('equity')}>
        Equity
        <span className="scope-count">{equityCount}</span>
      </button>
      <button className={`scope-btn${scope === 'mutual' ? ' scope-btn--active' : ''}`} onClick={() => setScope('mutual')}>
        Mutual Funds
        <span className="scope-count">{mfCount}</span>
      </button>
    </div>
  )

  return (
    <div className={hideValues ? 'peek' : undefined} style={{ display: 'contents' }}>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">Live Market Scoreboard</div>
          <h1 className="page-title">Your Arena</h1>
        </div>
        <p className="page-sub" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Scope />
          <button
            className={`icon-btn${hideValues ? ' icon-btn--active' : ''}`}
            onClick={() => setSettings({ ...settings, hideValues: !hideValues })}
            title={hideValues ? 'Reveal values (peek mode off)' : 'Hide values (peek mode on)'}
            aria-pressed={hideValues}
          >
            {hideValues ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M14.1 5.6A11.4 11.4 0 0 1 22 12c-.9 1.9-2.5 4.1-4.6 5.6M13.4 17A10.9 10.9 0 0 1 2 12c1.3-2.7 3.6-5.4 7.1-6.7" />
                <path d="M4 20 20 4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
          <button
            className={`icon-btn${refreshing ? ' icon-btn--spinning' : ''}`}
            onClick={onManualRefresh}
            title={positions.length === 0 ? 'Import a portfolio first' : 'Refresh last-trade prices for all holdings now (5 per hour)'}
            disabled={refreshing || positions.length === 0}
            aria-label="Refresh prices now"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          {limitMsg && (
            <span className="manual-note">
              {limitMsg.text}
              {limitMsg.until && Date.now() < limitMsg.until && <> Retry in {fmtCd(limitMsg.until - Date.now())}.</>}
            </span>
          )}
          <span className="market-status">
            <span className={`live-dot${liveCount > 0 ? '' : ' live-dot--loading'}`} aria-hidden="true" />
            {marketStatusText(marketOpen, liveCount)}
            {liveCount > 0 && (
              <span className="market-status-time">· last refresh {lastRefreshTime(live)}</span>
            )}
          </span>
          <span>
            Net position across {scopePositions.length} holding{scopePositions.length === 1 ? '' : 's'}
            {scope === 'mutual' ? ' — mutual funds' : ''} at current market prices.
          </span>
        </p>
      </div>

      {/* Scoreboard */}
      <div className="scoreboard enter d1">
        <div className="score">
          <div className="score-label">
            <span>Current Value</span>
            <span className={`live-dot${liveCount > 0 ? '' : ' live-dot--loading'}`} />
          </div>
          <div className="score-value">{mask(formatCurrency(stats.currentValue, currency))}</div>
          <div className="score-foot">Total market exposure</div>
        </div>
        <div className="score">
          <div className="score-label">Invested</div>
          <div className="score-value">{mask(formatCurrency(stats.invested, currency))}</div>
          <div className="score-foot">Cost basis deployed</div>
        </div>
        <div className="score">
          <div className="score-label">Unrealized P&L</div>
          <div className={`score-value ${pnlUp ? 'up' : 'down'}`}>
            {mask(`${pnlUp ? '+' : ''}${formatCurrency(stats.pnl, currency)}`)}
          </div>
          <div className={`score-foot ${pnlUp ? 'up' : 'down'}`}>
            {mask(formatPercent(stats.pnlPct))} on cost
          </div>
        </div>
        <div className="score">
          <div className="score-label">Best Performer</div>
          <div className="score-value sym">{mask(best ? best.ticker : '—')}</div>
          <div className={`score-foot ${bestPct != null ? (bestPct >= 0 ? 'up' : 'down') : ''}`}>
            {bestPct != null ? mask(`${bestPct >= 0 ? '+' : ''}${bestPct.toFixed(2)}%`) : 'Spread the field'}
          </div>
        </div>
      </div>

      {/* Ticker tape */}
      <div className="tiker-wrap enter d2">
        <div className="ticker">
          <div className="ticker-track">
            {tickerItems(scopePositions, currency, hideValues, live).map((t, i) => (
              <TickerCell key={i} t={t} hideValues={hideValues} />
            ))}
            {tickerItems(scopePositions, currency, hideValues, live).map((t, i) => (
              <TickerCell key={`dup-${i}`} t={t} hideValues={hideValues} />
            ))}
          </div>
        </div>
      </div>

      {/* Panels */}
      <div className="span-grid enter d3">
        <div className="panel panel--ledger">
          <div className="panel-head">
            <div className="panel-head-titles">
              <span className="panel-title">The Ledger</span>
              <span className="section-index">01 · Holdings</span>
            </div>
            <Scope />
          </div>
          {scope === 'mutual' && mfSummary && (
            <div className="mf-summary">
              <div className="mf-sum-item">
                <span className="mf-sum-label">Total Investments</span>
                <span className="mf-sum-value">{mask(formatCurrency(mfSummary.invested, currency))}</span>
              </div>
              <div className="mf-sum-item">
                <span className="mf-sum-label">Portfolio Value</span>
                <span className="mf-sum-value">{mask(formatCurrency(mfSummary.current, currency))}</span>
              </div>
              <div className="mf-sum-item">
                <span className="mf-sum-label">Profit / Loss</span>
                <span className={`mf-sum-value ${mfSummary.pnl >= 0 ? 'up' : 'down'}`}>
                  {mask(formatCurrency(mfSummary.pnl, currency))}
                </span>
              </div>
              <div className="mf-sum-item">
                <span className="mf-sum-label">P/L %</span>
                <span className={`mf-sum-value ${mfSummary.pnl >= 0 ? 'up' : 'down'}`}>
                  {mfSummary.invested > 0 ? mask(formatPercent((mfSummary.pnl / mfSummary.invested) * 100)) : '—'}
                </span>
              </div>
              <div className="mf-sum-item">
                <span className="mf-sum-label">XIRR</span>
                <span className="mf-sum-value">{mfSummary.xirrAvg != null ? mask(formatPercent(mfSummary.xirrAvg)) : '—'}</span>
              </div>
            </div>
          )}
          {scope === 'mutual' ? (
            <MFLedger rows={scopePositions} currency={currency} hideValues={hideValues} live={live} />
          ) : (
            <table className="table table--ledger">
              <thead>
                <tr>
                  <Th field="symbol">Symbol</Th>
                  <Th field="qty">Qty</Th>
                  <Th field="buy">Buy</Th>
                  <Th field="ltp">Last Trade</Th>
                  <Th field="value">Value</Th>
                  <Th field="pnl">P&L</Th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => {
                  const pnlUp = r.pnl != null && r.pnl >= 0
                  return (
                    <tr key={r.id}>
                      <td className="sym" title={r.symbol}>{mask(r.symbol)}</td>
                      <td>{mask(fmtUnits(r.qty))}</td>
                      <td>{mask(formatCurrency(r.buy, currency))}</td>
                      <td>
                        {r.ltp != null && r.buy > 0 && r.ltp !== r.buy ? (
                          <span className={`ltp ltp--${r.ltp > r.buy ? 'up' : 'down'}`}>
                            <span className="ltp-arrow" aria-hidden="true">{r.ltp > r.buy ? '▲' : '▼'}</span>
                            {mask(formatCurrency(r.ltp, currency))}
                          </span>
                        ) : r.ltp != null ? (
                          <span className="ltp ltp--flat">{mask(formatCurrency(r.ltp, currency))}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{mask(formatCurrency(r.value, currency))}</td>
                      <td className={r.pnl != null ? (pnlUp ? 'up' : 'down') : 'muted'}>
                        {r.pnl != null ? mask(`${pnlUp ? '+' : ''}${formatCurrency(r.pnl, currency)}`) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel panel--alloc">
          <div className="panel-head">
            <div className="panel-head-titles">
              <span className="panel-title">Allocation Mix</span>
              <span className="section-index">02 · Exposure</span>
            </div>
            <Scope />
          </div>
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.allocations}
                  dataKey="value"
                  nameKey="symbol"
                  innerRadius={68}
                  outerRadius={116}
                  paddingAngle={2}
                  stroke="transparent"
                >
                  {stats.allocations.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                {!hideValues && (
                  <Tooltip formatter={(v) => formatCurrency(v == null ? 0 : Number(v), currency)} contentStyle={TOOLTIP_STYLE} />
                )}
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="alloc-list alloc-list--research">
            <div className="alloc-list-head">
              <span className="panel-title">Top holdings · research</span>
              <span className="section-index">{stats.allocations.length} shown</span>
            </div>
            {researchRows.length === 0 ? (
              <div className="muted">No valued holdings yet.</div>
            ) : (
              researchRows.map(({ a, p, pnl, pct }) => {
                const open = researchOpen === a.symbol
                const pnlUp = pnl != null && pnl >= 0
                return (
                  <div className="research-row" key={a.symbol}>
                    <button
                      className="research-main"
                      onClick={() => setResearchOpen(open ? null : a.symbol)}
                      aria-expanded={open}
                    >
                      <span className="research-sym">{mask(a.symbol)}</span>
                      <span className="research-pct">{mask(formatPercent(pct))}</span>
                      {pnl != null && (
                        <span className={`research-pnl${pnlUp ? ' up' : ' down'}`}>
                          {mask(`${pnlUp ? '+' : ''}${formatCurrency(pnl, currency)}`)}
                        </span>
                      )}
                      <span className={`research-chev${open ? ' research-chev--open' : ''}`} aria-hidden="true">
                        ›
                      </span>
                    </button>
                    {open && p && <ResearchDrawer p={p} />}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Expandable research drawer: resolves the canonical screener.in company path
 *  on open (cached), then shows section links + secondary sources. */
function ResearchDrawer({ p }: { p: Position }) {
  const [links, setLinks] = useState<ResearchLink[] | null>(null)

  useEffect(() => {
    if (p.type === 'mutual-fund') return
    let alive = true
    setLinks(null)
    resolveScreenerCompanyPath(p.ticker).then((base) => {
      if (alive) setLinks(screenerSectionLinks(base))
    })
    return () => {
      alive = false
    }
  }, [p.ticker, p.type])

  const other = marketLinks(p)

  return (
    <div className="research-drawer">
      {p.type !== 'mutual-fund' && (
        <div className="research-group">
          <div className="research-group-title">FOR MORE INFO</div>
          <div className="research-links">
            {links ? (
              links.map((l) => (
                <a className="research-link" key={l.label} href={l.url} target="_blank" rel="noreferrer">
                  {l.label} ↗
                </a>
              ))
            ) : (
              <span className="muted">Locating on screener.in…</span>
            )}
          </div>
        </div>
      )}
      {other.length > 0 && (
        <div className="research-group">
          <div className="research-group-title">Other sources</div>
          <div className="research-links">
            {other.map((l) => (
              <a className="research-link" key={l.label} href={l.url} target="_blank" rel="noreferrer">
                {l.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Mutual-fund ledger — layout maps to the holdings export: Scheme, AMC, Folio, Units, Values, Returns, XIRR. */
function MFLedger({
  rows,
  currency,
  hideValues,
  live,
}: {
  rows: ReturnType<typeof useStore>['positions']
  currency: Currency
  hideValues: boolean
  live: Record<string, LiveQuote>
}) {
  const [sort, setSort] = useState<{ field: string; dir: SortDir } | null>(null)
  const mask = (s: string) => (hideValues ? '••••••' : s)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const num = (x: PositionLike) =>
        sort.field === 'value'
          ? valueOf(x, currency, live)
          : sort.field === 'units'
            ? x.quantity
            : sort.field === 'invested'
              ? x.invested
              : mfReturnPct(x, currency, live) ?? -Infinity
      switch (sort.field) {
        case 'scheme':
          return (a.name || a.ticker).localeCompare(b.name || b.ticker) * dir
        default:
          return (num(a) - num(b)) * dir
      }
    })
  }, [rows, sort])

  const toggle = (field: string) =>
    setSort((prev) => {
      if (!prev || prev.field !== field) return { field, dir: 'asc' } as { field: string; dir: SortDir }
      if (prev.dir === 'asc') return { field, dir: 'desc' }
      return null
    })

  const icon = (field: string) => {
    if (!sort || sort.field !== field) return '↕'
    return sort.dir === 'asc' ? '▲' : '▼'
  }
  const cls = (field: string) =>
    sort && sort.field === field ? 'th-sort th-sort--active' : 'th-sort'

  const Th = ({ field, children }: { field: string; children: string }) => (
    <th>
      <button className={cls(field)} onClick={() => toggle(field)}>
        {children}
        <span className="th-sort-icon">{icon(field)}</span>
      </button>
    </th>
  )

  return (
    <table className="table">
      <thead>
        <tr>
          <Th field="scheme">Scheme</Th>
          <Th field="units">Units</Th>
          <Th field="invested">Invested</Th>
          <Th field="value">Current Value</Th>
          <Th field="returns">Returns</Th>
          <Th field="xirr">XIRR</Th>
          <th>AMC / Folio</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => {
          const value = valueOf(p, currency, live)
          return (
            <tr key={p.id}>
              <td className="sym">
                <span className="mf-name" data-full={p.name || p.ticker}>
                  {mask(p.name || p.ticker)}
                </span>
              </td>
              <td>{mask(fmtUnits(p.quantity))}</td>
              <td>{mask(formatCurrency(p.invested, currency))}</td>
              <td>{mask(formatCurrency(value, currency))}</td>
              <td className={valueOf(p, currency, live) >= p.invested ? 'up' : 'down'}>
                {mask(formatPercent(mfReturnPct(p, currency, live) ?? 0))}
              </td>
              <td className={p.xirr != null ? (p.xirr >= 0 ? 'up' : 'down') : 'muted'}>
                {p.xirr != null ? mask(formatPercent(p.xirr)) : '—'}
              </td>
              <td className="muted">
                {mask([p.amc, p.folio].filter(Boolean).join(' · ') || '—')}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

type PositionLike = ReturnType<typeof useStore>['positions'][number]

function fmtUnits(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function valueOf(p: PositionLike, _currency: Currency, live: Record<string, LiveQuote>): number {
  const price = livePriceOf(p, live)
  return price != null ? price * p.quantity : p.invested
}

/** General return: (current value − invested) ÷ invested × 100. */
function mfReturnPct(p: PositionLike, currency: Currency, live: Record<string, LiveQuote>): number | null {
  if (p.invested <= 0) return null
  return ((valueOf(p, currency, live) - p.invested) / p.invested) * 100
}

/** Latest refresh time across all live quotes, in IST. */
function lastRefreshTime(live: Record<string, LiveQuote>): string {
  const ats = Object.values(live).map((q) => q.at)
  if (ats.length === 0) return '—'
  const max = Math.max(...ats)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(max))
}

interface TickerCellData {
  sym: string
  val: string
  delta: number | null
  pct: number | null
}

function tickerItems(
  positions: ReturnType<typeof useStore>['positions'],
  currency: Currency,
  hideValues: boolean,
  live: Record<string, LiveQuote>,
): TickerCellData[] {
  const mask = (s: string) => (hideValues ? '••••••' : s)
  return positions
    .map((p) => {
      const price = livePriceOf(p, live)
      const value = price != null ? price * p.quantity : p.invested
      const delta = price != null ? value - p.invested : null
      const pct = price != null && p.invested > 0 ? ((delta! / p.invested) * 100) : null
      return { sym: mask(p.ticker), val: mask(formatCurrency(value, currency)), delta, pct }
    })
    .slice(0, 24)
}

function TickerCell({ t, hideValues }: { t: TickerCellData; hideValues: boolean }) {
  const up = t.delta != null && t.delta >= 0
  return (
    <div className="ticker-item">
      <span className="ticker-sym">{t.sym}</span>
      <span className="ticker-val">{t.val}</span>
      <span className={`ticker-delta ${up ? 'up' : 'down'}`}>
        {hideValues ? '••••••' : t.pct != null ? `${up ? '+' : ''}${t.pct.toFixed(2)}%` : '—'}
      </span>
    </div>
  )
}