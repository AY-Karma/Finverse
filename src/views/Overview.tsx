import { Fragment, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { computePortfolioStats, effectivePrice as livePriceOf, formatCurrency, formatPercent, isLiveQuote, positionPnl, positionPnlPct, positionValue, portfolioPulse, quoteKey } from '../valuation'
import { useStore } from '../useStore'
import type { Currency, LiveQuote, Position } from '../types'
import type { View } from '../useStore'
import {
  isMarketOpen,
  marketStatusText,
} from '../live'
import { AllocationCard } from './AllocationCard'
const HistoryPanel = lazy(() => import('./HistoryPanel').then((module) => ({ default: module.HistoryPanel })))

const LEDGER_PAGE_SIZE = 100

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

export function Overview({ onGoTo, onRequestImport }: { onGoTo: (view: View) => void; onRequestImport: () => void }) {
  const { positions, rawPositions, settings, setSettings, liveQuotes, fxRate, refreshNow, snapshot, marketDataRefreshing } = useStore()
  const currency = settings.currency || 'INR'
  const [scope, setScope] = useState<Scope>('all')
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [refreshAvailableAt, setRefreshAvailableAt] = useState(0)
  const [, setCooldownTick] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [ledgerPage, setLedgerPage] = useState(0)
  const [historyPanelReady, setHistoryPanelReady] = useState(false)
  const hideValues = settings.hideValues

  useEffect(() => {
    if (refreshAvailableAt <= Date.now()) return
    const timer = window.setInterval(() => {
      if (refreshAvailableAt <= Date.now()) window.clearInterval(timer)
      setCooldownTick(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [refreshAvailableAt])

  useEffect(() => {
    const timer = window.setTimeout(() => setHistoryPanelReady(true), 120)
    return () => window.clearTimeout(timer)
  }, [])

  const onManualRefresh = async () => {
    if (refreshing || refreshAvailableAt > Date.now() || positions.length === 0) return
    setRefreshing(true)
    setRefreshError(null)
    try {
      const result = await refreshNow()
      if (!result.ok && result.reason === 'disabled') return
      if (!result.ok) {
        if (result.reason === 'failed') setRefreshError('No market quote was updated. Try again later.')
        return
      }
      setRefreshAvailableAt(Date.now() + result.retryInMs)
    } catch {
      /* keep the previous quotes on any failure */
    } finally {
      setRefreshing(false)
    }
  }

  const live = settings.allowExternalData ? liveQuotes : {}
  const liveCount = Object.keys(live).length
  const fetchingMarketData = refreshing || marketDataRefreshing
  const marketOpen = isMarketOpen()
  const fxReady = currency === 'INR' || !!fxRate?.usdInr
  const refreshCooldownSeconds = Math.max(0, Math.ceil((refreshAvailableAt - Date.now()) / 1000))

  const MASK = '••••••'
  const mask = (s: string) => (hideValues ? MASK : s)

  const equityCount = positions.filter((p) => p.type !== 'mutual-fund').length
  const mfCount = positions.filter((p) => p.type === 'mutual-fund').length

  const scopePositions = useMemo(
    () =>
      scope === 'all'
        ? positions
        : positions.filter((p) => (scope === 'mutual' ? p.type === 'mutual-fund' : p.type !== 'mutual-fund')),
    [positions, scope],
  )

  // Raw import rows grouped per combined holding (keyed by the merged position
  // id) so a user can expand any combined ledger row into its original entries.
  const combinedMembers = useMemo(() => {
    const byKey = new Map<string, Position[]>()
    for (const raw of rawPositions) {
      const k = quoteKey(raw)
      const arr = byKey.get(k)
      if (arr) arr.push(raw)
      else byKey.set(k, [raw])
    }
    const map = new Map<string, Position[]>()
    for (const p of positions) map.set(p.id, byKey.get(quoteKey(p)) ?? [])
    return map
  }, [positions, rawPositions])

  const stats = useMemo(
    () => computePortfolioStats(scopePositions, live),
    [scopePositions, live],
  )

  const pulse = useMemo(
    () => portfolioPulse(positions, live),
    [positions, live],
  )

  // Hooks are all called unconditionally — no early return may happen above these.
  const ledgerRows: LedgerRow[] = useMemo(
    () =>
      scopePositions.map((p) => {
        const price = livePriceOf(p, live)
        const value = positionValue(p, live)
        const pnl = positionPnl(p, live)
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

  const ledgerPageCount = Math.max(1, Math.ceil(sortedRows.length / LEDGER_PAGE_SIZE))
  const visibleLedgerRows = useMemo(
    () => sortedRows.slice(ledgerPage * LEDGER_PAGE_SIZE, (ledgerPage + 1) * LEDGER_PAGE_SIZE),
    [ledgerPage, sortedRows],
  )

  useEffect(() => {
    setLedgerPage(0)
    setExpandedId(null)
  }, [scope, sort])

  useEffect(() => {
    if (ledgerPage >= ledgerPageCount) setLedgerPage(ledgerPageCount - 1)
  }, [ledgerPage, ledgerPageCount])

  const mfSummary = useMemo(() => {
    if (scope !== 'mutual') return null
    const invested = scopePositions.reduce((s, p) => s + p.invested, 0)
    const current = scopePositions.reduce((s, p) => {
      return s + positionValue(p, live)
    }, 0)
    const pnl = current - invested
    const xirrs = scopePositions.map((p) => p.xirr).filter((x): x is number => x != null)
    const xirrAvg = xirrs.length ? xirrs.reduce((s, x) => s + x, 0) / xirrs.length : null
    return { invested, current, pnl, xirrAvg }
  }, [scope, scopePositions, live])

  if (positions.length === 0) {
    return (
      <div className="overview-empty enter">
        <div>
          <div className="page-eyebrow">Finverse · Portfolio workspace</div>
          <h1 className="page-title">See your portfolio clearly.</h1>
          <p className="page-sub">
            Bring in your latest holdings file to see value, allocation, performance, and the market around your investments.
          </p>
        </div>
        <button className="btn btn--primary" type="button" onClick={onRequestImport}>
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
        <button className="btn btn--primary" type="button" onClick={onRequestImport}>
          Import holdings →
        </button>
      </div>
    )
  }

  const pnlUp = stats.pnl >= 0
  const eff = (p: (typeof positions)[number]) => positionPnlPct(p, live)
  const rankedPerformers = scopePositions
    .map((position) => ({ position, pct: eff(position) }))
    .filter((item): item is { position: Position; pct: number } => item.pct != null)
    .sort((a, b) => b.pct - a.pct)
  const best = rankedPerformers[0] ?? null
  const worst = rankedPerformers[rankedPerformers.length - 1] ?? null
  const dailyMove = snapshot.dailyChange
  const dailyMoveText = dailyMove == null
    ? '—'
    : `${dailyMove >= 0 ? '+' : ''}${formatCurrency(dailyMove, currency, fxRate?.usdInr)}`
  const dailyMoveDirection = dailyMove == null || dailyMove === 0 ? '' : dailyMove > 0 ? 'up' : 'down'
  const dailyMoveArrow = dailyMove == null || hideValues ? '' : dailyMove > 0 ? '↑' : dailyMove < 0 ? '↓' : '→'

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
    <div className="scope-switch" role="group" aria-label="Portfolio scope">
      <button type="button" className={`scope-btn${scope === 'all' ? ' scope-btn--active' : ''}`} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
        All
        <span className="scope-count">{positions.length}</span>
      </button>
      <button type="button" className={`scope-btn${scope === 'equity' ? ' scope-btn--active' : ''}`} aria-pressed={scope === 'equity'} onClick={() => setScope('equity')}>
        Equity
        <span className="scope-count">{equityCount}</span>
      </button>
      <button type="button" className={`scope-btn${scope === 'mutual' ? ' scope-btn--active' : ''}`} aria-pressed={scope === 'mutual'} onClick={() => setScope('mutual')}>
        Mutual Funds
        <span className="scope-count">{mfCount}</span>
      </button>
    </div>
  )

  return (
    <div className={hideValues ? 'peek' : undefined} style={{ display: 'contents' }}>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">Portfolio</div>
          <h1 className="page-title">Overview</h1>
        </div>
        <div className="page-sub" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Scope />
          <button
            className={`icon-btn${hideValues ? ' icon-btn--active' : ''}`}
            onClick={() => setSettings({ ...settings, hideValues: !hideValues })}
            title={hideValues ? 'Reveal values (peek mode off)' : 'Hide values (peek mode on)'}
            aria-label={hideValues ? 'Reveal portfolio values' : 'Hide portfolio values'}
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
            title={
              positions.length === 0
                ? 'Import a portfolio first'
                : refreshCooldownSeconds > 0
                  ? `Refresh available in ${refreshCooldownSeconds}s`
                  : 'Refresh latest market prices'
            }
            disabled={refreshing || refreshCooldownSeconds > 0 || positions.length === 0}
            aria-label="Refresh prices now"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          <span
            className={`market-status ${marketOpen ? 'market-open' : fetchingMarketData ? 'offline-fetch' : 'offline'}`}
            role="status"
            aria-live="polite"
          >
            <span className={`live-dot${fetchingMarketData ? ' live-dot--fetching' : liveCount > 0 ? '' : ' live-dot--loading'}`} aria-hidden="true" />
            {marketStatusText(marketOpen, settings.allowExternalData, fxReady, fetchingMarketData)}
            {liveCount > 0 && (
              <span className="market-status-time">· last refresh {lastRefreshTime(live)}</span>
            )}
          </span>
          {refreshError && <span className="hint down" role="alert">{refreshError}</span>}
          <span>
            Net position across {scopePositions.length} holding{scopePositions.length === 1 ? '' : 's'}
            {scope === 'mutual' ? ' — mutual funds' : ''} at current market prices.
          </span>
        </div>
      </div>

      {/* Scoreboard */}
      <div className="scoreboard enter d1">
        <div className="score">
          <div className="score-label">
            <span>Current Value</span>
            {dailyMove == null ? (
              <span className={`live-dot${fetchingMarketData ? ' live-dot--fetching' : liveCount > 0 ? '' : ' live-dot--loading'}`} />
            ) : (
              <span
                className={`current-value-move${hideValues || !dailyMoveDirection ? ' current-value-move--flat' : ` ${dailyMoveDirection}`}`}
                aria-label={hideValues ? "Today's portfolio move hidden" : `Today's portfolio move: ${dailyMoveText}`}
                title="Today's portfolio move"
              >
                <span className="current-value-move-arrow" aria-hidden="true">{dailyMoveArrow}</span>
                <span>{mask(dailyMoveText)}</span>
              </span>
            )}
          </div>
          <div className="score-value">{mask(formatCurrency(stats.currentValue, currency, fxRate?.usdInr))}</div>
          <div className="score-foot">Total market exposure</div>
        </div>
        <div className="score">
          <div className="score-label">Invested</div>
          <div className="score-value">{mask(formatCurrency(stats.invested, currency, fxRate?.usdInr))}</div>
          <div className="score-foot">Cost basis deployed</div>
        </div>
        <div className="score">
          <div className="score-label">Unrealized P&L</div>
          <div className={`score-value ${pnlUp ? 'up' : 'down'}`}>
            {mask(`${pnlUp ? '+' : ''}${formatCurrency(stats.pnl, currency, fxRate?.usdInr)}`)}
          </div>
          <div className={`score-foot ${pnlUp ? 'up' : 'down'}`}>
            {mask(formatPercent(stats.pnlPct))} on cost
          </div>
        </div>
        <div className="score score--performers">
          <div className="performer-half">
            <div className="score-label">Best Performer</div>
            <div className="score-value sym" title={best ? mask(best.position.ticker) : undefined}>{mask(best ? best.position.ticker : '—')}</div>
            <div className={`score-foot ${best ? (best.pct >= 0 ? 'up' : 'down') : ''}`}>
              {best ? mask(`${best.pct >= 0 ? '+' : ''}${best.pct.toFixed(2)}%`) : 'No priced data'}
            </div>
          </div>
          <div className="performer-half">
            <div className="score-label">Worst Performer</div>
            <div className="score-value sym" title={worst ? mask(worst.position.ticker) : undefined}>{mask(worst ? worst.position.ticker : '—')}</div>
            <div className={`score-foot ${worst ? (worst.pct >= 0 ? 'up' : 'down') : ''}`}>
              {worst ? mask(`${worst.pct >= 0 ? '+' : ''}${worst.pct.toFixed(2)}%`) : 'No priced data'}
            </div>
          </div>
        </div>
      </div>

      <div className="daily-brief enter d2">
        <div className="daily-brief-copy">
          <span className="page-eyebrow">Daily read</span>
          <strong>{snapshot.dailyChange == null ? 'Waiting for the market read.' : snapshot.dailyChange >= 0 ? 'Your portfolio is catching a tailwind.' : 'Your portfolio is facing a headwind.'}</strong>
          <span className="hint">{snapshot.dailyChange == null ? 'Refresh prices to see what moved your portfolio today.' : `${snapshot.contributions.filter((item) => item.dailyChange != null).length} holdings reported a daily move. Open Insights for the full contribution story.`}</span>
        </div>
        <div className="daily-brief-stat">
          <span className="score-label">Today</span>
          <strong className={dailyMoveDirection}>{dailyMove == null ? '—' : mask(dailyMoveText)}</strong>
        </div>
        <button type="button" className="btn btn--secondary" onClick={() => onGoTo('insights')}>Open Insights →</button>
      </div>

      {/* Ticker tape */}
      <div className="tiker-wrap enter d3">
        <div className="ticker">
          <div className="ticker-track">
            {tickerItems(scopePositions, currency, hideValues, live, fxRate?.usdInr).map((t, i) => (
              <TickerCell key={i} t={t} hideValues={hideValues} />
            ))}
            {tickerItems(scopePositions, currency, hideValues, live, fxRate?.usdInr).map((t, i) => (
              <TickerCell key={`dup-${i}`} t={t} hideValues={hideValues} />
            ))}
          </div>
        </div>
      </div>

      {/* Panels */}
      <div className="span-grid enter d4">
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
                <span className="mf-sum-value">{mask(formatCurrency(mfSummary.invested, currency, fxRate?.usdInr))}</span>
              </div>
              <div className="mf-sum-item">
                <span className="mf-sum-label">Portfolio Value</span>
                <span className="mf-sum-value">{mask(formatCurrency(mfSummary.current, currency, fxRate?.usdInr))}</span>
              </div>
              <div className="mf-sum-item">
                <span className="mf-sum-label">Profit / Loss</span>
                <span className={`mf-sum-value ${mfSummary.pnl >= 0 ? 'up' : 'down'}`}>
                  {mask(formatCurrency(mfSummary.pnl, currency, fxRate?.usdInr))}
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
            <MFLedger
              rows={scopePositions}
              membersOf={combinedMembers}
              currency={currency}
              hideValues={hideValues}
              live={live}
              usdInrRate={fxRate?.usdInr}
            />
          ) : (
            <>
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
                {visibleLedgerRows.map((r) => {
                  const pnlUp = r.pnl != null && r.pnl >= 0
                  const members = combinedMembers.get(r.id) ?? []
                  const expandable = members.length > 1
                  const open = expandedId === r.id
                  return (
                    <Fragment key={r.id}>
                      <tr className={open ? 'trow--open' : undefined}>
                        <td className="sym" title={r.symbol}>
                          <button
                            className={`ledger-caret${open ? ' ledger-caret--open' : ''}${expandable ? '' : ' ledger-caret--muted'}`}
                            onClick={() => setExpandedId(open ? null : r.id)}
                            disabled={!expandable}
                            aria-expanded={open}
                            aria-label={expandable ? `Show the ${members.length} merged entries for ${r.symbol}` : undefined}
                            title={expandable ? `${members.length} entries merged into this row` : undefined}
                          >
                            ▾
                          </button>
                          {mask(r.symbol)}
                        </td>
                        <td>{mask(fmtUnits(r.qty))}</td>
                        <td>{mask(formatCurrency(r.buy, currency, fxRate?.usdInr))}</td>
                        <td>
                          {r.ltp != null && r.buy > 0 && r.ltp !== r.buy ? (
                            <span className={`ltp ltp--${r.ltp > r.buy ? 'up' : 'down'}`}>
                              <span className="ltp-arrow" aria-hidden="true">{r.ltp > r.buy ? '▲' : '▼'}</span>
                              {mask(formatCurrency(r.ltp, currency, fxRate?.usdInr))}
                            </span>
                          ) : r.ltp != null ? (
                            <span className="ltp ltp--flat">{mask(formatCurrency(r.ltp, currency, fxRate?.usdInr))}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{mask(formatCurrency(r.value, currency, fxRate?.usdInr))}</td>
                        <td className={r.pnl != null ? (pnlUp ? 'up' : 'down') : 'muted'}>
                          {r.pnl != null ? mask(`${pnlUp ? '+' : ''}${formatCurrency(r.pnl, currency, fxRate?.usdInr)}`) : '—'}
                        </td>
                      </tr>
                      {open && expandable && (
                        <tr className="trow--nested">
                          <td colSpan={6}>
                            <LedgerMembers
                              members={members}
                              live={live}
                              currency={currency}
                              usdInrRate={fxRate?.usdInr}
                              hideValues={hideValues}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {sortedRows.length > LEDGER_PAGE_SIZE && <div className="ledger-pagination" aria-label="Ledger pages"><span>{ledgerPage * LEDGER_PAGE_SIZE + 1}–{Math.min((ledgerPage + 1) * LEDGER_PAGE_SIZE, sortedRows.length)} of {sortedRows.length}</span><div><button className="btn btn--secondary" type="button" disabled={ledgerPage === 0} onClick={() => setLedgerPage((page) => Math.max(0, page - 1))}>Previous</button><button className="btn btn--secondary" type="button" disabled={ledgerPage === ledgerPageCount - 1} onClick={() => setLedgerPage((page) => Math.min(ledgerPageCount - 1, page + 1))}>Next</button></div></div>}
            </>
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
          <AllocationCard
            allocations={stats.allocations}
            hideValues={hideValues}
            currency={currency}
            usdInrRate={fxRate?.usdInr}
            pulse={pulse}
          />
        </div>
      </div>

      {historyPanelReady ? (
        <Suspense fallback={<div className="panel history-panel-placeholder">Preparing price history…</div>}>
          <HistoryPanel scope={scope} />
        </Suspense>
      ) : <div className="panel history-panel-placeholder">Preparing price history…</div>}
    </div>
  )
}

/** Mutual-fund ledger — layout maps to the holdings export: Scheme, AMC, Folio, Units, Values, Returns, XIRR. */
function MFLedger({
  rows,
  membersOf,
  currency,
  hideValues,
  live,
  usdInrRate,
}: {
  rows: ReturnType<typeof useStore>['positions']
  membersOf: Map<string, Position[]>
  currency: Currency
  hideValues: boolean
  live: Record<string, LiveQuote>
  usdInrRate?: number | null
}) {
  const [sort, setSort] = useState<{ field: string; dir: SortDir } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const mask = (s: string) => (hideValues ? '••••••' : s)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const num = (x: PositionLike) =>
        sort.field === 'value'
          ? valueOf(x, live)
          : sort.field === 'units'
            ? x.quantity
            : sort.field === 'invested'
              ? x.invested
              : mfReturnPct(x, live) ?? -Infinity
      switch (sort.field) {
        case 'scheme':
          return (a.name || a.ticker).localeCompare(b.name || b.ticker) * dir
        default:
          return (num(a) - num(b)) * dir
      }
    })
  }, [rows, sort])

  const pageCount = Math.max(1, Math.ceil(sorted.length / LEDGER_PAGE_SIZE))
  const visibleRows = useMemo(() => sorted.slice(page * LEDGER_PAGE_SIZE, (page + 1) * LEDGER_PAGE_SIZE), [page, sorted])

  useEffect(() => {
    setPage(0)
    setExpandedId(null)
  }, [sort])

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1)
  }, [page, pageCount])

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
    <>
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
        {visibleRows.map((p) => {
          const value = valueOf(p, live)
          const members = membersOf.get(p.id) ?? []
          const expandable = members.length > 1
          const open = expandedId === p.id
          return (
            <Fragment key={p.id}>
              <tr className={open ? 'trow--open' : undefined}>
                <td className="sym">
                  <button
                    className={`ledger-caret${open ? ' ledger-caret--open' : ''}${expandable ? '' : ' ledger-caret--muted'}`}
                    onClick={() => setExpandedId(open ? null : p.id)}
                    disabled={!expandable}
                    aria-expanded={open}
                    aria-label={expandable ? `Show the ${members.length} merged entries for ${p.name || p.ticker}` : undefined}
                    title={expandable ? `${members.length} entries merged into this row` : undefined}
                  >
                    ▾
                  </button>
                  <span className="mf-name" data-full={p.name || p.ticker}>
                    {mask(p.name || p.ticker)}
                  </span>
                </td>
                <td>{mask(fmtUnits(p.quantity))}</td>
                <td>{mask(formatCurrency(p.invested, currency, usdInrRate))}</td>
                <td>{mask(formatCurrency(value, currency, usdInrRate))}</td>
                <td className={valueOf(p, live) >= p.invested ? 'up' : 'down'}>
                  {mask(formatPercent(mfReturnPct(p, live) ?? 0))}
                </td>
                <td className={p.xirr != null ? (p.xirr >= 0 ? 'up' : 'down') : 'muted'}>
                  {p.xirr != null ? mask(formatPercent(p.xirr)) : '—'}
                </td>
                <td className="muted">
                  {mask([p.amc, p.folio].filter(Boolean).join(' · ') || '—')}
                </td>
              </tr>
              {open && expandable && (
                <tr className="trow--nested">
                  <td colSpan={7}>
                    <LedgerMembers
                      members={members}
                      live={live}
                      currency={currency}
                      usdInrRate={usdInrRate}
                      hideValues={hideValues}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
    {sorted.length > LEDGER_PAGE_SIZE && <div className="ledger-pagination" aria-label="Mutual fund ledger pages"><span>{page * LEDGER_PAGE_SIZE + 1}–{Math.min((page + 1) * LEDGER_PAGE_SIZE, sorted.length)} of {sorted.length}</span><div><button className="btn btn--secondary" type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button><button className="btn btn--secondary" type="button" disabled={page === pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button></div></div>}
    </>
  )
}

/** Inline breakdown of a combined ledger row: the original import entries
 *  (each qty, cost basis, invested, value and P&L) that were merged. */
function LedgerMembers({
  members,
  live,
  currency,
  usdInrRate,
  hideValues,
}: {
  members: Position[]
  live: Record<string, LiveQuote>
  currency: Currency
  usdInrRate?: number | null
  hideValues: boolean
}) {
  const mask = (s: string) => (hideValues ? '••••••' : s)
  const anyFolio = members.some((m) => (m.folio ?? '').trim() !== '')
  return (
    <div className="ledger-members">
      <div className="ledger-members-title">Merged {members.length} entries</div>
      <table className="table table--nested">
        <thead>
          <tr>
            <th>Qty</th>
            <th>Buy</th>
            <th>Invested</th>
            <th>Value</th>
            <th>P&L</th>
            {anyFolio && <th>Folio</th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const v = positionValue(m, live)
            const pnl = positionPnl(m, live)
            const up = pnl != null && pnl >= 0
            return (
              <tr key={m.id}>
                <td>{mask(fmtUnits(m.quantity))}</td>
                <td>{mask(formatCurrency(m.buyPrice, currency, usdInrRate))}</td>
                <td>{mask(formatCurrency(m.invested, currency, usdInrRate))}</td>
                <td>{mask(formatCurrency(v, currency, usdInrRate))}</td>
                <td className={pnl != null ? (up ? 'up' : 'down') : 'muted'}>
                  {pnl != null ? mask(`${up ? '+' : ''}${formatCurrency(pnl, currency, usdInrRate)}`) : '—'}
                </td>
                {anyFolio && <td className="muted">{mask((m.folio ?? '').trim() || '—')}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type PositionLike = ReturnType<typeof useStore>['positions'][number]

function fmtUnits(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function valueOf(p: PositionLike, live: Record<string, LiveQuote>): number {
  return positionValue(p, live)
}

/** General return: (current value − invested) ÷ invested × 100. */
function mfReturnPct(p: PositionLike, live: Record<string, LiveQuote>): number | null {
  if (p.invested <= 0) return null
  return ((valueOf(p, live) - p.invested) / p.invested) * 100
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
  usdInrRate?: number | null,
): TickerCellData[] {
  const mask = (s: string) => (hideValues ? '••••••' : s)
  return positions
    .map((p) => {
      const value = positionValue(p, live)
      const delta = positionPnl(p, live)
      const pct = positionPnlPct(p, live)
      return { sym: mask(p.ticker), val: mask(formatCurrency(value, currency, usdInrRate)), delta, pct }
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
