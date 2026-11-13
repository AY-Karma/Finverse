import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { combinedPositionMembers, computePortfolioStats, effectivePrice as livePriceOf, formatCurrency, formatPercent, hasSupportedValuationCurrency, isLiveQuote, positionPnl, positionPnlPct, positionValue, quoteKey } from '../valuation'
import { useStore } from '../useStore'
import { portfolioDataLabels } from '../portfolioDataLabels'
import { investmentWorkspace } from '../investmentWorkspace'
import { hasVerifiedNsePricing, needsInstrumentReview } from '../instruments'
import { getFolioFreshness } from '../importFreshness'
import type { LiveQuote, Position } from '../types'
import type { View } from '../useStore'
import { MarketRefreshStatus } from './MarketRefreshStatus'
import { quoteRefreshIssueText } from '../live'
import { MarketCalendar } from './MarketCalendar'
import { ActionIcon } from './ActionIcon'
import { DitherBar } from './DitherBar'
import { PortfolioWelcome } from './PortfolioWelcome'
import { MarketIndexTicker } from './MarketIndexTicker'
import { OverviewNotifications } from './OverviewNotifications'
import './overviewQuality.css'
const PortfolioPerformance = lazy(() => import('./PortfolioPerformance').then((module) => ({ default: module.PortfolioPerformance })))

const LEDGER_PAGE_SIZE = 25
const EMPTY_QUOTES: Record<string, LiveQuote> = {}
const SESSION_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
function formatCost(value: number, supported: boolean): string {
  return supported ? formatCurrency(value) : 'Unavailable'
}

type Scope = 'all' | 'equity' | 'mutual'
type SortField = 'symbol' | 'qty' | 'buy' | 'ltp' | 'value' | 'pnl'
type SortDir = 'asc' | 'desc'

type LedgerSortGroup = { label: string; options: { value: string; label: string }[] }
const EQUITY_SORT_GROUPS: LedgerSortGroup[] = [
  { label: 'Order', options: [{ value: 'default', label: 'Import order' }] },
  { label: 'Holding', options: [{ value: 'symbol-asc', label: 'Symbol A–Z' }, { value: 'symbol-desc', label: 'Symbol Z–A' }, { value: 'qty-desc', label: 'Quantity: high to low' }, { value: 'qty-asc', label: 'Quantity: low to high' }] },
  { label: 'Price', options: [{ value: 'buy-desc', label: 'Buy price: high to low' }, { value: 'buy-asc', label: 'Buy price: low to high' }, { value: 'ltp-desc', label: 'LTP: high to low' }, { value: 'ltp-asc', label: 'LTP: low to high' }] },
  { label: 'Portfolio', options: [{ value: 'value-desc', label: 'Value: high to low' }, { value: 'value-asc', label: 'Value: low to high' }, { value: 'pnl-desc', label: 'P&L: high to low' }, { value: 'pnl-asc', label: 'P&L: low to high' }] },
]
const FUND_SORT_GROUPS: LedgerSortGroup[] = [
  { label: 'Order', options: [{ value: 'default', label: 'Import order' }] },
  { label: 'Fund', options: [{ value: 'scheme-asc', label: 'Scheme A–Z' }, { value: 'scheme-desc', label: 'Scheme Z–A' }, { value: 'units-desc', label: 'Units: high to low' }, { value: 'units-asc', label: 'Units: low to high' }] },
  { label: 'Portfolio', options: [{ value: 'invested-desc', label: 'Invested: high to low' }, { value: 'invested-asc', label: 'Invested: low to high' }, { value: 'value-desc', label: 'Value: high to low' }, { value: 'value-asc', label: 'Value: low to high' }, { value: 'returns-desc', label: 'Returns: high to low' }, { value: 'returns-asc', label: 'Returns: low to high' }] },
  { label: 'Imported return', options: [{ value: 'xirr-desc', label: 'XIRR: high to low' }, { value: 'xirr-asc', label: 'XIRR: low to high' }] },
]

function LedgerToolbar({ label, groups, value, onSort, page, total, onPage, pagesLabel }: {
  label: string
  groups: LedgerSortGroup[]
  value: string
  onSort: (value: string) => void
  page: number
  total: number
  onPage: (page: number) => void
  pagesLabel: string
}) {
  const menu = useRef<HTMLDetailsElement>(null)
  const options = groups.flatMap((group) => group.options)
  const selected = options.find((option) => option.value === value) ?? options[0]
  const selectedLabel = selected.label.replace(': high to low', ' ↓').replace(': low to high', ' ↑')
  const pageCount = Math.max(1, Math.ceil(total / LEDGER_PAGE_SIZE))
  const close = (restoreFocus = false) => {
    const detail = menu.current
    if (!detail?.open) return
    detail.open = false
    if (restoreFocus) detail.querySelector('summary')?.focus()
  }
  useEffect(() => {
    const detail = menu.current
    const fit = () => {
      if (!detail?.open) return
      const popover = detail.querySelector<HTMLElement>('.benchmark-menu-popover')
      if (!popover) return
      const box = detail.getBoundingClientRect()
      const top = window.visualViewport?.offsetTop ?? 0
      const height = window.visualViewport?.height ?? window.innerHeight
      const below = Math.max(0, top + height - box.bottom - 24)
      const above = Math.max(0, box.top - top - 24)
      const upwards = below < 240 && above > below
      const width = Math.min(296, window.innerWidth - 48)
      popover.style.left = `${Math.min(Math.max(16, box.right - width), window.innerWidth - width - 16) - box.left}px`
      popover.style.top = upwards ? 'auto' : 'calc(100% + 8px)'
      popover.style.bottom = upwards ? 'calc(100% + 8px)' : 'auto'
      popover.style.maxHeight = `${Math.min(420, upwards ? above : below)}px`
    }
    const dismiss = (event: MouseEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) close()
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !detail?.open) return
      event.preventDefault()
      close(true)
    }
    detail?.addEventListener('toggle', fit)
    document.addEventListener('click', dismiss)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, true)
    window.visualViewport?.addEventListener('resize', fit)
    return () => {
      detail?.removeEventListener('toggle', fit)
      document.removeEventListener('click', dismiss)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
      window.visualViewport?.removeEventListener('resize', fit)
    }
  }, [])
  const keyboard = (event: KeyboardEvent<HTMLDetailsElement>) => {
    const detail = menu.current
    if (!detail) return
    if (event.key === 'Escape' && detail.open) {
      event.preventDefault()
      close(true)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = [...detail.querySelectorAll<HTMLButtonElement>('.benchmark-menu-group button')]
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : current < 0 ? Math.max(0, options.findIndex((option) => option.value === value))
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    detail.open = true
    buttons[next]?.focus()
  }
  return <div className="ledger-toolbar">
    <details ref={menu} className="benchmark-menu ledger-sort-menu" onKeyDown={keyboard}
      onBlur={(event) => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close() }}>
      <summary aria-label={`${label}: ${selected.label}`} title={selected.label}><span className="ledger-sort-trigger"><span className="ledger-sort-label">{selectedLabel}</span></span></summary>
      <div className="benchmark-menu-popover">
        {groups.map((group) => <div className="benchmark-menu-group" key={group.label}>{group.label !== 'Order' && <span>{group.label}</span>}
          {group.options.map((option) => <button key={option.value} type="button" className={option.value === value ? 'is-selected' : undefined}
            aria-current={option.value === value ? 'true' : undefined} onClick={() => { onSort(option.value); close(true) }}>
            <span>{option.label}</span><svg className="ledger-sort-check" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7" /></svg>
          </button>)}
        </div>)}
      </div>
    </details>
    {total > LEDGER_PAGE_SIZE && <nav className="ledger-pagination ledger-toolbar-pages" aria-label={pagesLabel}>
      <span className="ledger-page-range" aria-live="polite"><span>{page * LEDGER_PAGE_SIZE + 1}–{Math.min((page + 1) * LEDGER_PAGE_SIZE, total)}</span><span className="ledger-page-total"> / {total}</span></span>
      <div><button className="ledger-page-button" type="button" title="Previous page" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg><span className="sr-only">Previous</span></button><button className="ledger-page-button" type="button" title="Next page" aria-label="Next page" disabled={page === pageCount - 1} onClick={() => onPage(Math.min(pageCount - 1, page + 1))}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg><span className="sr-only">Next</span></button></div>
    </nav>}
  </div>
}

interface LedgerRow {
  id: string
  position: Position
  symbol: string
  qty: number
  buy: number
  costSupported: boolean
  ltp: number | null
  dayMove: number | null
  importedPrice: boolean
  value: number
  pnl: number | null
}

export function Overview({ onGoTo, onRequestImport, highlightsEntry }: { onGoTo: (view: View, anchor?: string) => void; onRequestImport: () => void; highlightsEntry?: ReactNode }) {
  const { positions, rawPositions, settings, refreshNow, snapshot, marketDataResult } = useStore()
  const [scope, setScope] = useState<Scope>('all')
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [refreshAvailableAt, setRefreshAvailableAt] = useState(0)
  const [, setCooldownTick] = useState(0)
  const [ledgerPage, setLedgerPage] = useState(0)
  const [expandedFundId, setExpandedFundId] = useState<string | null>(null)
  const [marketNow, setMarketNow] = useState(() => new Date())
  const hideValues = settings.hideValues
  const navOnly = positions.length > 0 && positions.every((position) => position.type === 'mutual-fund')

  useEffect(() => {
    const timer = window.setInterval(() => setMarketNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const remaining = refreshAvailableAt - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setCooldownTick(Date.now()), remaining)
    return () => window.clearTimeout(timer)
  }, [refreshAvailableAt])

  const onManualRefresh = async () => {
    if (refreshing || refreshAvailableAt > Date.now() || positions.length === 0) return
    setRefreshing(true)
    setRefreshError(null)
    try {
      const result = await refreshNow()
      if (!result.ok && result.reason === 'disabled') return
      if (!result.ok) {
        if (result.reason === 'failed') setRefreshError('No market quote was updated. Try again later.')
        if (result.reason === 'no-live-listings') setRefreshError('No verified NSE match is available for live prices. Imported values are retained.')
        return
      }
      setRefreshAvailableAt(Date.now() + result.retryInMs)
    } catch {
      /* keep the previous quotes on any failure */
    } finally {
      setRefreshing(false)
    }
  }

  const live = settings.allowExternalData ? snapshot.quotes : EMPTY_QUOTES
  const refreshCoolingDown = refreshAvailableAt > Date.now()
  const unmappedBse = positions.filter((position) => position.exchange === 'BSE' && !hasVerifiedNsePricing(position) && hasSupportedValuationCurrency(position))
  const importedPriceIds = new Set(unmappedBse.map((position) => position.id))
  const mappingNotice = unmappedBse.length ? hideValues
    ? 'Some holdings use imported prices. An NSE match is needed for live updates.'
    : `${unmappedBse.length} BSE holding${unmappedBse.length === 1 ? ' uses' : 's use'} imported prices. An NSE match is needed for live updates.` : null
  const marketDataIssue = [mappingNotice, quoteRefreshIssueText(marketDataResult)].filter(Boolean).join(' ') || null

  const MASK = '••••••'
  const mask = (s: string) => (hideValues ? MASK : s)

  const equityCount = positions.filter((p) => p.type !== 'mutual-fund').length
  const mfCount = positions.filter((p) => p.type === 'mutual-fund').length
  const pendingListings = positions.filter(needsInstrumentReview).length
  const foliosNeedReview = snapshot.folios.some((folio) => getFolioFreshness(folio, marketNow.getTime()) === 'old')

  const scopePositions = useMemo(
    () =>
      scope === 'all'
        ? positions
        : positions.filter((p) => (scope === 'mutual' ? p.type === 'mutual-fund' : p.type !== 'mutual-fund')),
    [positions, scope],
  )

  // Raw import rows grouped per combined holding (keyed by the merged position
  // id) so a user can expand any combined ledger row into its original entries.
  const combinedMembers = useMemo(() => combinedPositionMembers(rawPositions), [rawPositions])

  const mfSummary = useMemo(
    () => scope === 'mutual' ? computePortfolioStats(scopePositions, live) : null,
    [scope, scopePositions, live],
  )

  const fundSession = mfCount > 0 && (scope === 'mutual' || equityCount === 0)
  const sessionFolios = useMemo(() => mfCount === 0 ? null : snapshot.folios.map((folio) => ({
      ...folio,
      positions: folio.positions.filter((position) => fundSession
        ? position.type === 'mutual-fund' : position.type !== 'mutual-fund'),
    })), [snapshot.folios, mfCount, fundSession])
  const sessionHoldings = useMemo(() => sessionFolios ? investmentWorkspace.prepareHoldings(sessionFolios) : undefined, [sessionFolios])
  const scopedSession = useMemo(() => sessionFolios
    ? investmentWorkspace.readSnapshot({ folios: sessionFolios, holdings: sessionHoldings, quotes: live }) : null,
  [sessionFolios, sessionHoldings, live])
  const sessionSnapshot = scopedSession ?? snapshot

  // Hooks are all called unconditionally — no early return may happen above these.
  const ledgerRows: LedgerRow[] = useMemo(
    () =>
      scopePositions.map((p) => {
        const price = livePriceOf(p, live)
        const value = price == null ? 0 : price * p.quantity
        const pnl = price == null ? null : value - p.invested
        return {
          id: p.id,
          position: p,
          symbol: p.type === 'mutual-fund' ? p.name || p.ticker : p.ticker,
          qty: p.quantity,
          buy: p.buyPrice,
          costSupported: hasSupportedValuationCurrency(p),
          ltp: price,
          dayMove: dailyPriceMove(p, live).delta,
          importedPrice: importedPriceIds.has(p.id),
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
    setExpandedFundId(null)
  }, [scope, sort])

  useEffect(() => {
    if (ledgerPage >= ledgerPageCount) setLedgerPage(ledgerPageCount - 1)
  }, [ledgerPage, ledgerPageCount])

  if (positions.length === 0) {
    return <PortfolioWelcome onRequestImport={onRequestImport} headingAction={<>{highlightsEntry}<OverviewNotifications onGoTo={onGoTo} /></>} />
  }

  const dataLabels = portfolioDataLabels(sessionSnapshot)
  const dailyMove = dataLabels.sessionValue
  const dailyMoveText = dailyMove == null
    ? '—'
    : `${dailyMove >= 0 ? '+' : ''}${formatCurrency(dailyMove)}`
  const dailyMoveDirection = dailyMove == null || dailyMove === 0 ? '' : dailyMove > 0 ? 'up' : 'down'
  const sessionDate = sessionSnapshot.dailyChangeDate
    ? SESSION_DATE_FORMAT.format(new Date(`${sessionSnapshot.dailyChangeDate}T00:00:00+05:30`)) : null

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

  const renderHeader = (field: SortField, label: string) => (
    <th key={field} aria-sort={sort?.field === field ? sort.dir === 'asc' ? 'ascending' : 'descending' : 'none'}>
      <button className={sortCls(field)} onClick={() => toggleSort(field)}>
        {label}
        <span className="th-sort-icon">{sortIcon(field)}</span>
      </button>
    </th>
  )

  const renderScope = () => (
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

  const renderLedgerHeader = (toolbar?: ReactNode) => <div className="panel-head ledger-head">
    <div className="panel-head-titles"><span className="panel-title">The Ledger</span></div>
    <div className="ledger-controls">{renderScope()}{toolbar}</div>
  </div>

  return (
    <div className={hideValues ? 'peek' : undefined} style={{ display: 'contents' }}>
      <div className="page-head overview-head">
        <div className="overview-heading">
          <div className="overview-title-row">
            <h1 className="page-title">Overview</h1>
            {highlightsEntry}
            {(foliosNeedReview || pendingListings > 0) && <div className="overview-notices">
              {foliosNeedReview && <div className="overview-review overview-review--folios">
                <button className="btn overview-review-action overview-review-action--red" type="button" onClick={() => onGoTo('settings', 'manage-holdings')}>
                  <DitherBar className="overview-review-texture" segments={[{ value: 1, color: 'red' }]} />Update folios
                </button>
                <p className="overview-review-note" role="status">Over 21 days since your last check. Review or confirm no changes.</p>
              </div>}
              {pendingListings > 0 && <div className="overview-review">
                <button className="btn overview-review-action" type="button" onClick={() => onGoTo('settings', 'instrument-review')}>Review listings</button>
                <p className="overview-review-note" role="status">Approve listings to confirm prices &amp; calibration.</p>
              </div>}
            </div>}
          </div>
        </div>
        <div className="page-sub overview-sub">
          <div className="overview-actions">
            {renderScope()}
            <div className="overview-tools"><OverviewNotifications onGoTo={onGoTo} pendingListings={pendingListings} foliosNeedReview={foliosNeedReview} />
              <span className="overview-refresh-control" title={positions.length === 0 ? 'Import a portfolio first' : navOnly ? 'NAVs update at scheduled publication checks' : 'Refresh latest market prices'}>
              <button
                className={`icon-btn${refreshing ? ' icon-btn--spinning' : ''}`}
                onClick={onManualRefresh}
                disabled={refreshing || refreshCoolingDown || positions.length === 0 || navOnly}
                aria-label="Refresh prices now"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <path d="M21 3v6h-6" />
                </svg>
              </button>
              </span>
            </div>
          </div>
          <div className="overview-meta">
            <MarketRefreshStatus externalEnabled={settings.allowExternalData}
              now={marketNow}
              issue={refreshError || marketDataIssue} issueRole={refreshError ? 'alert' : 'status'} />
            <MarketCalendar now={marketNow} />
          </div>
        </div>
      </div>

      <div className="overview-market-strip">
        <section className="scoreboard scoreboard--session-only" aria-label="Session movement">
        <div className="score score--session" role="group" aria-label="Session summary">
          <div className="score-label">
            <button type="button" className="session-insights-link" title="Open Insights" onClick={() => onGoTo('insights')}>
              {fundSession ? dataLabels.isPartialSession ? 'Reported NAV move' : 'NAV move' : dataLabels.isPartialSession ? 'Reported move' : 'Session move'}<ActionIcon name="insights" />
            </button>
          </div>
          <div className={`score-value${hideValues || !dailyMoveDirection ? '' : ` ${dailyMoveDirection}`}`}
            aria-label={hideValues ? 'Session movement hidden' : `${dataLabels.sessionLabel} ${fundSession ? 'published NAV' : dataLabels.isPartialSession ? 'reported holdings' : mfCount > 0 ? 'stocks + ETFs' : 'portfolio'} move: ${dailyMove == null ? 'Unavailable' : dailyMoveText}`}>
            {mask(dailyMove == null ? '—' : dailyMoveText)}
          </div>
          <div className="score-foot score-session-basis" title={hideValues ? undefined : dataLabels.coverageLabel}>
            {sessionDate ? <time dateTime={sessionSnapshot.dailyChangeDate!}>{sessionDate}</time> : fundSession ? 'Awaiting published NAVs' : 'Awaiting updates'}
            {!hideValues && dataLabels.sessionTotal > 0 && (mfCount > 0 || dataLabels.isPartialSession || dataLabels.sessionTotal < sessionSnapshot.positions.length) && <span>{sessionSnapshot.dailyChangeCount} of {dataLabels.sessionTotal} {fundSession ? 'published NAVs' : mfCount > 0 ? 'stocks + ETFs' : dataLabels.sessionHoldings}</span>}
          </div>
        </div>
        </section>
        <MarketIndexTicker allowed={settings.allowExternalData} indexIds={settings.marketIndices} />
      </div>

      {/* Panels */}
      <div className="span-grid">
        <div className="panel panel--ledger">
          {scopePositions.length === 0 ? <>{renderLedgerHeader()}<div className="ledger-empty">
            <p>No {scope === 'mutual' ? 'mutual funds' : 'equity holdings'} in this portfolio.</p>
            <button className="btn btn--secondary" type="button" onClick={() => setScope('all')}>Show all holdings</button>
          </div></> : scope === 'mutual' ? (
            <MFLedger
              rows={scopePositions}
              membersOf={combinedMembers}
              hideValues={hideValues}
              live={live}
              renderHeader={renderLedgerHeader}
              summary={mfSummary && (
                <div className="mf-summary">
                  <div className="mf-sum-item">
                    <span className="mf-sum-label">Total Investments</span>
                    <span className="mf-sum-value">{mask(formatCurrency(mfSummary.invested))}</span>
                  </div>
                  <div className="mf-sum-item">
                    <span className="mf-sum-label">Portfolio Value</span>
                    <span className="mf-sum-value">{mask(mfSummary.pricedCount ? formatCurrency(mfSummary.currentValue) : 'Unpriced')}</span>
                  </div>
                  <div className="mf-sum-item">
                    <span className="mf-sum-label">Profit / Loss</span>
                    <span className={`mf-sum-value ${mfSummary.pnl >= 0 ? 'up' : 'down'}`}>
                      {mask(mfSummary.pricedCount ? formatCurrency(mfSummary.pnl) : 'Unpriced')}
                    </span>
                  </div>
                  <div className="mf-sum-item">
                    <span className="mf-sum-label">P/L %</span>
                    <span className={`mf-sum-value ${mfSummary.pnl >= 0 ? 'up' : 'down'}`}>
                      {mfSummary.pricedCount > 0 ? mask(formatPercent(mfSummary.pnlPct)) : '—'}
                    </span>
                  </div>
                </div>
              )}
            />
          ) : (
            <>
            {renderLedgerHeader(<LedgerToolbar label="Sort holdings" groups={EQUITY_SORT_GROUPS}
                value={sort ? `${sort.field}-${sort.dir}` : 'default'}
                onSort={(value) => {
                  if (value === 'default') setSort(null)
                  else {
                    const [field, dir] = value.split('-') as [SortField, SortDir]
                    setSort({ field, dir })
                  }
                }}
                page={ledgerPage} total={sortedRows.length} onPage={setLedgerPage} pagesLabel="Ledger pages" />)}
            <div className="ledger-table-scroll" tabIndex={0} role="region" aria-label="Holdings ledger">
            <table className="table table--ledger">
              <thead>
                <tr>
                  {renderHeader('symbol', 'Symbol')}
                  {renderHeader('qty', 'Qty')}
                  {renderHeader('buy', 'Buy')}
                  {renderHeader('ltp', 'Last Trade')}
                  {renderHeader('value', 'Value')}
                  {renderHeader('pnl', 'P&L')}
                </tr>
              </thead>
              <tbody>
                {visibleLedgerRows.map((r) => {
                  const pnlUp = r.pnl != null && r.pnl >= 0
                  const fund = r.position.type === 'mutual-fund'
                  const open = fund && expandedFundId === r.id
                  return (
                    <Fragment key={r.id}>
                    <tr className={open ? 'trow--open' : undefined}>
                      <td className="sym" title={mask(r.symbol)}>
                        {fund && <button className={`ledger-caret${open ? ' ledger-caret--open' : ''}`} type="button" aria-label={`Show details for ${mask(r.symbol)}`} aria-expanded={open} onClick={() => setExpandedFundId(open ? null : r.id)}>▾</button>}
                        <span className="ledger-symbol-name">{mask(r.symbol)}</span>
                      </td>
                      <td>{mask(fmtUnits(r.qty))}</td>
                      <td>{mask(formatCost(r.buy, r.costSupported))}</td>
                      <td>
                        <LastTrade price={r.ltp} dayMove={r.dayMove} hideValues={hideValues} imported={r.importedPrice} />
                      </td>
                      <td>{mask(r.ltp == null ? 'Unpriced' : formatCurrency(r.value))}</td>
                      <td className={r.pnl != null ? (pnlUp ? 'up' : 'down') : 'muted'}>
                        {r.pnl != null ? mask(`${pnlUp ? '+' : ''}${formatCurrency(r.pnl)}`) : '—'}
                      </td>
                    </tr>
                    {open && <tr className="trow--nested"><td colSpan={6}><FundDetails fund={r.position} members={combinedMembers.get(r.id) ?? []} live={live} hideValues={hideValues} /></td></tr>}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            </div>
            <div className="ledger-mobile-list">
              {visibleLedgerRows.map((row) => {
                const pnlUp = row.pnl != null && row.pnl >= 0
                const fund = row.position.type === 'mutual-fund'
                const open = fund && expandedFundId === row.id
                const Row = fund ? 'button' : 'div'
                return (
                  <div className="ledger-mobile-item" key={row.id}>
                    <Row className={`ledger-mobile-row ledger-mobile-row--static${fund ? ' ledger-mobile-row--fund' : ''}`} {...(fund ? { type: 'button' as const, 'aria-expanded': open, onClick: () => setExpandedFundId(open ? null : row.id) } : {})}>
                      <span className="ledger-mobile-primary">
                        <span className="ledger-mobile-name" title={mask(row.symbol)}>{fund && <span className="ledger-fund-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>}{mask(row.symbol)}</span>
                        <span className="ledger-mobile-secondary ledger-mobile-meta">
                          <span>Qty {mask(fmtUnits(row.qty))}</span>
                          <span className="ledger-mobile-last-trade"><span>LTP</span><LastTrade price={row.ltp} dayMove={row.dayMove} hideValues={hideValues} imported={row.importedPrice} /></span>
                        </span>
                      </span>
                      <span className="ledger-mobile-primary ledger-mobile-primary--right">
                        <span className="ledger-mobile-value">{mask(row.ltp == null ? 'Unpriced' : formatCurrency(row.value))}{row.importedPrice && !hideValues && <span className="muted"> · Imported</span>}</span>
                        <span className={`ledger-mobile-secondary ${hideValues || row.pnl == null ? '' : pnlUp ? 'up' : 'down'}`}>
                          {row.pnl == null ? 'P&L unavailable' : mask(`${pnlUp ? '+' : ''}${formatCurrency(row.pnl)}`)}
                        </span>
                      </span>
                    </Row>
                    {open && <FundDetails fund={row.position} members={combinedMembers.get(row.id) ?? []} live={live} hideValues={hideValues} />}
                  </div>
                )
              })}
            </div>
            </>
          )}
        </div>

        <div className="panel panel--portfolio">
          <Suspense fallback={<div className="portfolio-performance-placeholder" role="status">Preparing portfolio performance…</div>}>
            <PortfolioPerformance scope={scope} />
          </Suspense>
        </div>
      </div>

    </div>
  )
}

/** Mutual-fund ledger — layout maps to the holdings export: Scheme, AMC, Folio, Units, Values, Returns, XIRR. */
function MFLedger({
  rows,
  membersOf,
  hideValues,
  live,
  summary,
  renderHeader: renderLedgerHeader,
}: {
  rows: ReturnType<typeof useStore>['positions']
  membersOf: Map<string, Position[]>
  hideValues: boolean
  live: Record<string, LiveQuote>
  summary: ReactNode
  renderHeader: (toolbar: ReactNode) => ReactNode
}) {
  const [sort, setSort] = useState<{ field: string; dir: SortDir } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const hasImportedXirr = rows.some((position) => position.xirr != null
    || membersOf.get(position.id)?.some((member) => member.xirr != null))
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
              : sort.field === 'xirr'
                ? x.xirr ?? -Infinity
              : mfReturnPct(x, live) ?? -Infinity
      switch (sort.field) {
        case 'scheme':
          return (a.name || a.ticker).localeCompare(b.name || b.ticker) * dir
        default:
          return (num(a) - num(b)) * dir
      }
    })
  }, [rows, sort, live])

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

  const renderHeader = (field: string, label: string) => (
    <th key={field} aria-sort={sort?.field === field ? sort.dir === 'asc' ? 'ascending' : 'descending' : 'none'}>
      <button className={cls(field)} onClick={() => toggle(field)}>
        {label}
        <span className="th-sort-icon">{icon(field)}</span>
      </button>
    </th>
  )

  return (
    <>
    {renderLedgerHeader(<LedgerToolbar label="Sort funds" groups={hasImportedXirr ? FUND_SORT_GROUPS : FUND_SORT_GROUPS.filter((group) => group.label !== 'Imported return')}
        value={sort ? `${sort.field}-${sort.dir}` : 'default'}
        onSort={(value) => {
          if (value === 'default') setSort(null)
          else {
            const [field, dir] = value.split('-') as [string, SortDir]
            setSort({ field, dir })
          }
        }}
        page={page} total={sorted.length} onPage={setPage} pagesLabel="Mutual fund ledger pages" />)}
    {summary}
    <div className="ledger-table-scroll" tabIndex={0} role="region" aria-label="Mutual fund ledger">
    <table className="table">
      <thead>
        <tr>
          {renderHeader('scheme', 'Scheme')}
          {renderHeader('units', 'Units')}
          {renderHeader('invested', 'Invested')}
          {renderHeader('value', 'Current Value')}
          {renderHeader('returns', 'Returns')}
          {hasImportedXirr && renderHeader('xirr', 'XIRR')}
          <th>AMC / Folio</th>
        </tr>
      </thead>
      <tbody>
        {visibleRows.map((p) => {
          const value = valueOf(p, live)
          const returns = mfReturnPct(p, live)
          const members = membersOf.get(p.id) ?? []
          const expandable = members.length > 1
          const open = expandedId === p.id
          return (
            <Fragment key={p.id}>
              <tr className={open ? 'trow--open' : undefined}>
                <td className="sym">
                  <button
                    className={`ledger-caret${open ? ' ledger-caret--open' : ''}`}
                    onClick={() => setExpandedId(open ? null : p.id)}
                    aria-expanded={open}
                    aria-label={`Show details for ${mask(p.name || p.ticker)}`}
                    title={expandable ? `${members.length} entries merged into this row` : undefined}
                  >
                    ▾
                  </button>
                  <span className="mf-name" data-full={mask(p.name || p.ticker)}>
                    {mask(p.name || p.ticker)}
                  </span>
                </td>
                <td>{mask(fmtUnits(p.quantity))}</td>
                <td>{mask(formatCost(p.invested, hasSupportedValuationCurrency(p)))}</td>
                <td>{mask(livePriceOf(p, live) == null ? 'Unpriced' : formatCurrency(value))}</td>
                <td className={livePriceOf(p, live) == null ? 'muted' : value >= p.invested ? 'up' : 'down'}>
                  {returns == null ? '—' : mask(formatPercent(returns))}
                </td>
                {hasImportedXirr && <td className={p.xirr != null ? (p.xirr >= 0 ? 'up' : 'down') : 'muted'} title={expandable ? 'Merged XIRR requires dated cash flows. Expand to view imported entry XIRRs.' : undefined}>
                  {p.xirr != null ? mask(formatPercent(p.xirr)) : '—'}
                </td>}
                <td className="muted">
                  {mask([p.amc, p.folio].filter(Boolean).join(' · ') || '—')}
                </td>
              </tr>
              {open && (
                <tr className="trow--nested">
                  <td colSpan={hasImportedXirr ? 7 : 6}>
                    <FundDetails fund={p} members={members} live={live} hideValues={hideValues} />
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
    </div>
    <div className="ledger-mobile-list">
      {visibleRows.map((fund) => {
        const value = valueOf(fund, live)
        const returns = mfReturnPct(fund, live)
        const members = membersOf.get(fund.id) ?? []
        const open = expandedId === fund.id
        return (
          <div className="ledger-mobile-item" key={fund.id}>
            <button className="ledger-mobile-row" type="button" onClick={() => setExpandedId(open ? null : fund.id)} aria-expanded={open}>
              <span className="ledger-mobile-primary">
                <span className="ledger-mobile-name">{mask(fund.name || fund.ticker)}</span>
                <span className="ledger-mobile-secondary">{mask(fmtUnits(fund.quantity))} units{!hideValues && fund.amc ? ` · ${fund.amc}` : ''}</span>
              </span>
              <span className="ledger-mobile-primary ledger-mobile-primary--right">
                <span className="ledger-mobile-value">{mask(livePriceOf(fund, live) == null ? 'Unpriced' : formatCurrency(value))}</span>
                <span className={`ledger-mobile-secondary ${hideValues || returns == null ? '' : returns >= 0 ? 'up' : 'down'}`}>
                  {returns == null ? 'Return unavailable' : mask(formatPercent(returns))}
                </span>
                <span className="ledger-mobile-chevron" aria-hidden="true">⌄</span>
              </span>
            </button>
            {open && <FundDetails fund={fund} members={members} live={live} hideValues={hideValues} />}
          </div>
        )
      })}
    </div>
    </>
  )
}

function FundDetails({ fund, members, live, hideValues }: { fund: Position; members: Position[]; live: Record<string, LiveQuote>; hideValues: boolean }) {
  const mask = (text: string) => hideValues ? '••••••' : text
  return <div className="ledger-mobile-detail ledger-fund-detail">
    <div className="ledger-mobile-detail-wide"><span>Scheme</span><strong>{mask(fund.name || fund.ticker)}</strong></div>
    <div><span>Invested</span><strong>{mask(formatCost(fund.invested, hasSupportedValuationCurrency(fund)))}</strong></div>
    {fund.xirr != null && <div><span>Imported XIRR</span><strong>{mask(formatPercent(fund.xirr))}</strong></div>}
    {fund.amc && <div className="ledger-mobile-detail-wide"><span>AMC</span><strong>{mask(fund.amc)}</strong></div>}
    {fund.folio && <div><span>Folio</span><strong>{mask(fund.folio)}</strong></div>}
    {members.length > 1 && <LedgerMembers members={members} live={live} hideValues={hideValues} />}
  </div>
}

/** Original import entries behind a combined holding. */
function LedgerMembers({
  members,
  live,
  hideValues,
}: {
  members: Position[]
  live: Record<string, LiveQuote>
  hideValues: boolean
}) {
  const mask = (s: string) => (hideValues ? '••••••' : s)
  const anyFolio = members.some((m) => (m.folio ?? '').trim() !== '')
  const hasFundEntries = members.some((m) => m.type === 'mutual-fund')
  return (
    <div className="ledger-members">
      <div className="ledger-members-title">Merged {members.length} entries</div>
      {hasFundEntries && <p className="hint">Imported XIRRs belong to individual entries. A merged XIRR requires dated cash flows.</p>}
      <table className="table table--nested">
        <thead>
          <tr>
            <th>Qty</th>
            <th>Buy</th>
            <th>Invested</th>
            <th>Value</th>
            <th>P&L</th>
            {hasFundEntries && <th>XIRR</th>}
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
                <td data-label="Qty">{mask(fmtUnits(m.quantity))}</td>
                <td data-label="Buy">{mask(formatCost(m.buyPrice, hasSupportedValuationCurrency(m)))}</td>
                <td data-label="Invested">{mask(formatCost(m.invested, hasSupportedValuationCurrency(m)))}</td>
                <td data-label="Value">{mask(livePriceOf(m, live) == null ? 'Unpriced' : formatCurrency(v))}</td>
                <td data-label="P&L" className={pnl != null ? (up ? 'up' : 'down') : 'muted'}>
                  {pnl != null ? mask(`${up ? '+' : ''}${formatCurrency(pnl)}`) : '—'}
                </td>
                {hasFundEntries && <td data-label="XIRR" className={m.xirr == null ? 'muted' : m.xirr >= 0 ? 'up' : 'down'}>{m.xirr == null ? '—' : mask(formatPercent(m.xirr))}</td>}
                {anyFolio && <td data-label="Folio" className="muted">{mask((m.folio ?? '').trim() || '—')}</td>}
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
  return positionPnlPct(p, live)
}

function dailyPriceMove(position: Position, live: Record<string, LiveQuote>): { delta: number | null; pct: number | null } {
  const quote = isLiveQuote(position, live) ? live[quoteKey(position)] : undefined
  if (!quote || !Number.isFinite(quote.price) || quote.price < 0) return { delta: null, pct: null }
  const delta = quote.change != null && Number.isFinite(quote.change) ? quote.change : null
  const previous = delta == null ? null : quote.price - delta
  const pct = quote.changePct != null && Number.isFinite(quote.changePct)
    ? quote.changePct
    : delta != null && previous != null && previous > 0 ? delta / previous * 100 : null
  return { delta, pct }
}

function moveTrend(move: number | null): string {
  return move == null || move === 0 ? 'muted' : move > 0 ? 'up' : 'down'
}

function signedPrice(value: number): string {
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`
}

function LastTrade({ price, dayMove, hideValues, imported = false }: { price: number | null; dayMove: number | null; hideValues: boolean; imported?: boolean }) {
  const trend = moveTrend(dayMove)
  return (
    <span className="last-trade">
      <span className={`ltp ltp--${trend}`}>
        {!hideValues && dayMove != null && dayMove !== 0 && <span className="ltp-arrow" aria-hidden="true">{dayMove > 0 ? '▲' : '▼'}</span>}
        {hideValues ? '••••••' : price == null ? '—' : formatCurrency(price)}
      </span>
      <span className={`last-trade-move ${imported ? 'last-trade-source' : ''} ${hideValues ? 'muted' : trend}`} aria-label={hideValues ? 'Day move hidden' : imported ? 'Price source' : 'Day move'}>
        {hideValues ? '••••••' : imported ? 'Imported' : dayMove == null ? '—' : signedPrice(dayMove)}
      </span>
    </span>
  )
}
