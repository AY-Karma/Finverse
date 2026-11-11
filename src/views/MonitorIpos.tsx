import { useEffect, useId, useRef, useState } from 'react'
import { dateFormatter, numberFormatter } from '../formatters'
import type { IpoFeed, IpoIssue } from '../ipoProtocol'
import { useIpos } from '../useIpos'
import { ipoHistorySlug, ipoTrendSlug, useIpoGmpHistory, type HistoryState } from '../useIpoGmpHistory'
import { ActionIcon } from './ActionIcon'
import { IpoGmpSparkline, IpoGmpTrend } from './IpoGmpTrend'
import './monitorIpos.css'

type Period = 'OPEN' | 'UPCOMING' | 'RECENT'
const money = numberFormatter({ style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const percent = numberFormatter({ maximumFractionDigits: 2, signDisplay: 'exceptZero' })
const integer = numberFormatter({ maximumFractionDigits: 0 })
const day = dateFormatter({ day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
const updated = dateFormatter({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const STATUS = { OPEN: 'Open', UPCOMING: 'Upcoming', CLOSED: 'Closed', LISTED: 'Listed', RECENT: 'Recent' }
const BOARDS = [{ value: 'ALL', label: 'All boards' }, { value: 'MAINBOARD', label: 'Mainboard' }, { value: 'SME', label: 'SME' }] as const
type BoardFilter = typeof BOARDS[number]['value']
const SORTS = [{ value: 'NEWEST', label: 'Newest' }, { value: 'OLDEST', label: 'Oldest' }, { value: 'GMP_HIGH', label: 'GMP: highest' }, { value: 'GMP_LOW', label: 'GMP: lowest' }] as const
type SortOrder = typeof SORTS[number]['value']

function IpoSelector<T extends string>({ value, onChange, label, options }: { value: T; onChange: (value: T) => void; label: string; options: readonly { value: T; label: string }[] }) {
  const id = useId()
  const control = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    control.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!control.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  const close = () => { setOpen(false); trigger.current?.focus() }
  return <div ref={control} className="mi-board-filter" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }} onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (!open) { setOpen(true); return }
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    const index = options.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
    options[next]?.focus()
  }}>
    <button ref={trigger} type="button" className="mi-board-trigger" aria-label={label} aria-describedby={`${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
      <span id={`${id}-value`}>{options.find((option) => option.value === value)?.label}</span>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </button>
    {open && <div className="mi-board-menu" id={id} role="listbox" aria-label={label}>
      {options.map((option) => <button type="button" role="option" aria-selected={value === option.value} tabIndex={-1} key={option.value} onClick={() => { onChange(option.value); close() }}>
        <span>{option.label}</span>{value === option.value && <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>}
      </button>)}
    </div>}
  </div>
}

function shortDate(value: string): string { return day.format(new Date(`${value}T12:00:00+05:30`)) }

function priceBand(issue: IpoIssue): string {
  const low = issue.priceMin, high = issue.priceMax
  if (low === null && high === null) return 'Not announced'
  if (low === null || low === high) return money.format(high ?? low!)
  return high === null ? money.format(low) : `${money.format(low)}–${money.format(high)}`
}

function inPeriod(issue: IpoIssue, period: Period, recentFrom: string, today: string): boolean {
  if (period !== 'RECENT') return issue.status === period
  if (issue.status !== 'CLOSED' && issue.status !== 'LISTED') return false
  const date = issue.status === 'LISTED' ? issue.listingDate ?? issue.closeDate : issue.closeDate
  return date !== null && date >= recentFrom && date <= today
}

function issueDate(issue: IpoIssue): string | null {
  if (issue.status === 'LISTED') return issue.listingDate ?? issue.openDate
  if (issue.status === 'OPEN' || issue.status === 'CLOSED') return issue.closeDate ?? issue.openDate
  return issue.openDate
}

function sortIssues(a: IpoIssue, b: IpoIssue, order: SortOrder): number {
  if (order === 'GMP_HIGH' || order === 'GMP_LOW') {
    if (a.gmp === null && b.gmp !== null) return 1
    if (a.gmp !== null && b.gmp === null) return -1
    if (a.gmp && b.gmp) {
      const difference = order === 'GMP_HIGH' ? b.gmp.amount - a.gmp.amount : a.gmp.amount - b.gmp.amount
      if (difference) return difference
    }
  }
  const aDate = issueDate(a), bDate = issueDate(b)
  if (aDate === null && bDate !== null) return 1
  if (aDate !== null && bDate === null) return -1
  return (order === 'OLDEST' ? (aDate ?? '').localeCompare(bDate ?? '') : (bDate ?? '').localeCompare(aDate ?? '')) || a.name.localeCompare(b.name)
}

function dateContext(issue: IpoIssue): string {
  if (issue.status === 'LISTED' && issue.listingDate) return `Listed ${shortDate(issue.listingDate)}`
  if (issue.status === 'CLOSED' && issue.closeDate) return `Closed ${shortDate(issue.closeDate)}`
  if (issue.status === 'OPEN' && issue.closeDate) return `Closes ${shortDate(issue.closeDate)}`
  if (issue.openDate) return `${issue.status === 'UPCOMING' ? 'Opens' : 'Opened'} ${shortDate(issue.openDate)}`
  return 'Dates to be announced'
}

type IpoWatchActions = { watchedIds?: string[]; onWatch?: (issue: IpoIssue) => void; onUnwatch?: (id: string) => void; watchReadOnly?: boolean }

function IssueDetails({ issue, id, historyStatus, onRetryHistory, watchedIds, onWatch, onUnwatch, watchReadOnly }: { issue: IpoIssue; id: string; historyStatus?: 'loading' | 'ready' | 'error'; onRetryHistory: () => void } & IpoWatchActions) {
  const gmp = issue.gmp
  const milestones = ([['Opens', issue.openDate], ['Closes', issue.closeDate], ['Allotment', issue.allotmentDate], ['Listing', issue.listingDate]] as const)
    .filter((entry): entry is readonly [typeof entry[0], string] => entry[1] !== null)
  const missingDates = !issue.allotmentDate && !issue.listingDate ? 'Allotment / listing dates unavailable'
    : !issue.allotmentDate ? 'Allotment date unavailable' : !issue.listingDate ? 'Listing date unavailable' : null
  const hasFacts = issue.lotSize !== null || gmp?.sources !== null && gmp?.sources !== undefined || gmp?.rangeLow !== null && gmp?.rangeLow !== undefined && gmp.rangeHigh !== null

  return <div id={id} className="mi-details" role="region" aria-label={`${issue.name} IPO details`}>
    {onWatch && (issue.status === 'OPEN' || issue.status === 'UPCOMING') && <div className="mi-watch-action">
      <button type="button" className="mp-text-button" disabled={watchReadOnly || !issue.closeDate} onClick={() => watchedIds?.includes(issue.id) ? onUnwatch?.(issue.id) : onWatch(issue)}><ActionIcon name="bell" />{watchedIds?.includes(issue.id) ? 'Stop watching last day' : 'Watch last day'}</button>
      <span>{issue.closeDate ? `Overview reminder on ${shortDate(issue.closeDate)}` : 'Closing date not announced'}</span>
    </div>}
    {hasFacts && <dl className="mi-facts">
      {issue.lotSize !== null && <div><dt>Lot size</dt><dd>{integer.format(issue.lotSize)} shares</dd></div>}
      {gmp?.rangeLow !== null && gmp?.rangeLow !== undefined && gmp.rangeHigh !== null && <div><dt>GMP range</dt><dd>{money.format(gmp.rangeLow)}–{money.format(gmp.rangeHigh)}</dd></div>}
      {gmp?.sources !== null && gmp?.sources !== undefined && <div><dt>Reporting sources</dt><dd>{gmp.sources === 0 ? 'None today' : integer.format(gmp.sources)}</dd></div>}
    </dl>}
    {milestones.length > 0 && <ol className="mi-timeline" aria-label="IPO timeline">
      {milestones.map(([label, date]) => <li key={label}><span>{label}</span><strong>{shortDate(date)}</strong></li>)}
    </ol>}
    {missingDates && <p className="mi-unannounced">{missingDates}</p>}
    <div className="mi-detail-context">{gmp && <p className="mi-gmp-note">
      {issue.status === 'LISTED' && 'Historical GMP · '}<a href={gmp.sourceUrl} target="_blank" rel="noopener noreferrer">{gmp.source}</a>
      {gmp.asOfDate ? ` · As of ${shortDate(gmp.asOfDate)}. Daily reported GMP.` : gmp.observedAt ? ` · Reported ${updated.format(gmp.observedAt)} IST.` : gmp.sourceUpdatedAt ? ` · Page updated ${updated.format(gmp.sourceUpdatedAt)} IST. Quote time unavailable.` : ' · Quote time unavailable.'}
      {issue.status === 'LISTED' && ' Pre-listing quote, not the listed stock price.'}
    </p>}<a className="mi-issue-source" href={issue.sourceUrl} target="_blank" rel="noopener noreferrer">Issue source <ActionIcon name="external" /></a></div>
    {!gmp && historyStatus === 'error' && <div className="mi-history-retry" role="status"><span>Historical GMP could not be loaded.</span><button type="button" className="mp-text-button" onClick={onRetryHistory}>Try again</button></div>}
    <nav className="mi-links" aria-label="Explore IPO research">
      <a href="https://www.investorgain.com/report/ipo-gmp-live/331/" target="_blank" rel="noopener noreferrer"><span><strong>InvestorGain</strong><span>Browse GMP tracker</span></span><ActionIcon name="external" /></a>
      <a href="https://www.chittorgarh.com/" target="_blank" rel="noopener noreferrer"><span><strong>Chittorgarh</strong><span>Browse IPO research</span></span><ActionIcon name="external" /></a>
    </nav>
  </div>
}

function IssueRow({ issue, expanded, trendExpanded, onToggle, onToggleTrend, history, onRetryHistory, ...watchActions }: { issue: IpoIssue; expanded: boolean; trendExpanded: boolean; onToggle: () => void; onToggleTrend: () => void; history?: HistoryState; onRetryHistory: () => void } & IpoWatchActions) {
  const id = useId()
  const trendTrigger = useRef<HTMLButtonElement>(null)
  const historyStatus = history?.status
  const statusInDate = issue.status === 'CLOSED' && issue.closeDate || issue.status === 'LISTED' && issue.listingDate
  return <article className="mi-issue">
    <div className="mi-row" data-expanded={expanded || trendExpanded}>
      <button className="mi-row-toggle" type="button" aria-label={`View ${issue.name} IPO details`} aria-expanded={expanded} aria-controls={expanded ? `${id}-details` : undefined} aria-describedby={`${id}-meta ${id}-price ${id}-gmp`} onClick={onToggle}>
      <span className="mi-company"><span className="mi-name">{issue.name}</span><span id={`${id}-meta`} className="mi-meta"><span>{issue.board === 'SME' ? 'SME' : 'Mainboard'}</span>{!statusInDate && <span className="mi-status" data-status={issue.status}>{STATUS[issue.status]}</span>}<span>{dateContext(issue)}</span></span></span>
        <svg className="mi-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <span className="mi-price" id={`${id}-price`}><span className="mi-inline-label">Price</span><strong>{priceBand(issue)}</strong></span>
      <div className="mi-gmp-group">
      <span className="mi-gmp" id={`${id}-gmp`} data-direction={issue.gmp ? issue.gmp.amount > 0 ? 'positive' : issue.gmp.amount < 0 ? 'negative' : 'flat' : undefined}>
        <span className="mi-inline-label">{issue.status === 'LISTED' ? 'Past GMP' : 'GMP'}</span>
        {issue.gmp ? <span className="mi-gmp-result"><strong>{money.format(issue.gmp.amount)}</strong>{issue.gmp.percent !== null && <span>[{percent.format(issue.gmp.percent)}%]</span>}</span> : <span className="mi-unreported">{issue.status === 'LISTED' ? historyStatus === 'loading' ? 'Loading history…' : historyStatus ? 'History unavailable' : 'View history' : 'Not reported'}</span>}
        {issue.status === 'LISTED' && issue.gmp && <span className="mi-history-label">{issue.gmp.asOfDate ? `As of ${shortDate(issue.gmp.asOfDate)}` : 'Pre-listing'}</span>}
      </span>
        {ipoTrendSlug(issue) && <button className="mi-trend-trigger" ref={trendTrigger} type="button" aria-label={`Show ${issue.name} GMP trend`} aria-expanded={trendExpanded} aria-controls={trendExpanded ? `${id}-trend` : undefined} title={history?.points.length ? 'Daily GMP trend' : history?.status === 'ready' ? 'Daily GMP history is unavailable for this IPO' : history?.status === 'error' ? 'Daily history could not be loaded. Open to retry.' : 'Preparing daily GMP history'} onClick={onToggleTrend}><IpoGmpSparkline points={history?.points ?? []} status={history?.status ?? 'loading'} /></button>}
      </div>
    </div>
    {trendExpanded && <IpoGmpTrend key={issue.id} id={`${id}-trend`} name={issue.name} points={history?.points ?? []} sourceUrl={history?.sourceUrl ?? null} status={historyStatus ?? 'loading'} onRetry={onRetryHistory} onClose={() => { onToggleTrend(); trendTrigger.current?.focus({ preventScroll: true }) }} />}
    {expanded && <IssueDetails issue={issue} id={`${id}-details`} historyStatus={historyStatus} onRetryHistory={onRetryHistory} {...watchActions} />}
  </article>
}

function FeedContext({ feed }: { feed: IpoFeed }) {
  const gmpSource = feed.sources.find((source) => source.name === 'GMP Today' && source.updatedAt)
  const notesId = useId()
  return <footer className="mi-footer">
    <details className="mi-disclaimer" aria-labelledby={notesId}>
      <summary><ActionIcon name="warning" /><h3 id={notesId}>Disclaimer</h3><svg className="mi-disclaimer-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></summary>
      <div className="mi-disclaimer-body">
      <p>{feed.disclaimer ?? 'GMP is reported by public trackers and does not guarantee listing gains.'}</p>
      <div className="mi-disclaimer-groups">
        <div><h4>Data sources</h4><p className="mi-source-line"><a href="https://www.xflot.com/" target="_blank" rel="noopener noreferrer">Xflot</a> supplies issue details. <a href="https://gmptoday.in/" target="_blank" rel="noopener noreferrer">GMP Today</a> supplies reported premiums.</p></div>
        <div><h4>Updates</h4><dl className="mi-update-times">
          {gmpSource?.updatedAt && <div className="mi-source-time"><dt>GMP page updated</dt><dd><time dateTime={new Date(gmpSource.updatedAt).toISOString()}>{updated.format(gmpSource.updatedAt)} IST</time></dd></div>}
          <div><dt>IPO list checked</dt><dd>{feed.fetchedAt ? <time dateTime={new Date(feed.fetchedAt).toISOString()}>{updated.format(feed.fetchedAt)} IST</time> : 'Update time unavailable'}</dd></div>
        </dl><p>Source-page updates are not dealer quote times.</p></div>
        {(feed.warnings.length > 0 || feed.stale) && <div className="mi-coverage"><h4>Coverage</h4>
          {feed.warnings.length > 0 && <ul>{feed.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          {feed.stale && <p>Some sources are dated or could not be refreshed. Showing the last available data.</p>}
        </div>}
      </div>
      </div>
    </details>
  </footer>
}

export function MonitorIpos({ allowed, ...watchActions }: { allowed: boolean } & IpoWatchActions) {
  const { feed, loading, error, refresh } = useIpos(allowed)
  const [period, setPeriod] = useState<Period>('OPEN')
  const [board, setBoard] = useState<BoardFilter>('ALL')
  const [sort, setSort] = useState<SortOrder>('NEWEST')
  const [expanded, setExpanded] = useState<{ id: string; view: 'details' | 'trend' } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const boardIssues = (feed?.issues ?? []).filter((issue) => board === 'ALL' || issue.board === board)
  const today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)
  const recentFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10)
  const compareIssues = (a: IpoIssue, b: IpoIssue) => period === 'UPCOMING' ? a.name.localeCompare(b.name) : sortIssues(a, b, sort)
  const periodIssues = boardIssues.filter((issue) => inPeriod(issue, period, recentFrom, today)).sort(compareIssues)
  const recentCount = boardIssues.filter((issue) => inPeriod(issue, 'RECENT', recentFrom, today)).length
  const sortingGmp = period !== 'UPCOMING' && (sort === 'GMP_HIGH' || sort === 'GMP_LOW')
  const historyTargets = period === 'UPCOMING' ? [] : sortingGmp || showAll ? [...periodIssues] : periodIssues.slice(0, 4)
  const expandedIssue = periodIssues.find((issue) => issue.id === expanded?.id)
  if (expandedIssue && !historyTargets.includes(expandedIssue)) historyTargets.push(expandedIssue)
  const { histories, retry: retryHistory } = useIpoGmpHistory(historyTargets, allowed, expanded?.view === 'trend' ? expanded.id : undefined)
  const filtered = periodIssues.map((issue) => {
    const slug = ipoTrendSlug(issue), history = slug ? histories[slug] : undefined
    return history?.gmp ? { ...issue, gmp: history.gmp } : issue
  }).sort(compareIssues)
  const displayed = showAll ? filtered : filtered.slice(0, 4)
  const sortingHistory = sortingGmp && periodIssues.some((issue) => { const slug = ipoHistorySlug(issue); return slug && histories[slug]?.status === 'loading' })
  const changePeriod = (next: Period) => { setPeriod(next); setExpanded(null); setShowAll(false) }

  return <section className="mp-panel mi-panel" aria-labelledby="monitor-ipos-heading">
    <header className="mp-section-head mp-feature-head mi-heading">
      <div className="mp-feature-title"><span className="mp-heading-mark" aria-hidden="true"><ActionIcon name="holdings" /></span><h2 id="monitor-ipos-heading" tabIndex={-1}>IPOs</h2></div>
      {allowed && <button className="mi-refresh" type="button" onClick={refresh} disabled={loading} aria-label="Refresh IPOs" title={loading ? 'Updating IPOs' : 'Refresh IPOs'}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M16.5 7a7 7 0 0 0-12-2L2.5 7m0-4v4h4m-3 6a7 7 0 0 0 12 2l2-2m0 4v-4h-4" /></svg></button>}
    </header>
    {!allowed ? <div className="mi-message"><p>Market data is paused for this workspace.</p><button type="button" className="mp-text-button" onClick={() => window.location.reload()}>Reload workspace</button></div> : <>
      <div className="mi-filters" data-simple={period === 'UPCOMING'}><IpoSelector label="IPO board" options={BOARDS} value={board} onChange={(value) => { setBoard(value); setExpanded(null); setShowAll(false) }} />{period !== 'UPCOMING' && <IpoSelector label="Sort IPOs" options={SORTS} value={sort} onChange={(value) => { setSort(value); setExpanded(null); setShowAll(false) }} />}</div>
      <div className="mi-controls"><div className="mi-periods" role="group" aria-label="IPO status">
        {(['OPEN', 'UPCOMING', 'RECENT'] as const).map((value) => <button type="button" key={value} aria-pressed={period === value} onClick={() => changePeriod(value)}>{STATUS[value]}</button>)}
      </div>{period === 'RECENT' && <span className="mi-period-scope">Past 7 days</span>}</div>
      {loading && !feed && <div className="mi-loading" role="status"><p>Loading IPOs…</p><span /><span /><span /></div>}
      {error && !feed && <div className="mi-failure" role="status"><span className="mi-failure-icon" aria-hidden="true"><ActionIcon name="warning" /></span><div><strong>IPOs are unavailable</strong><p>{error}</p></div><button type="button" className="mi-retry" onClick={refresh} disabled={loading}>Try again<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M16 7a6.5 6.5 0 0 0-11-2L3 7m0-4v4h4m-3 6a6.5 6.5 0 0 0 11 2l2-2m0 4v-4h-4" /></svg></button></div>}
      {feed && <>
        <p className="mi-availability" data-limited={feed.stale || feed.warnings.length > 0} role={feed.stale || feed.warnings.length ? 'status' : undefined}>{feed.stale ? 'Saved data may be out of date · Unofficial GMP' : feed.warnings.length ? 'Limited coverage · Unofficial GMP' : 'Unofficial GMP'}</p>
        {sortingHistory && <p className="mi-sort-status" role="status">Loading historical GMP for sorting…</p>}
        {displayed.length > 0 ? <div className="mi-list">
          {period !== 'UPCOMING' && <div className="mi-columns" aria-hidden="true"><span>Company</span><span>Price band</span><span>Reported GMP</span></div>}
          {displayed.map((issue) => {
            if (period === 'UPCOMING') return <article className="mi-issue mi-upcoming-row" key={issue.id}><span className="mi-name">{issue.name}</span><span className="mi-meta">{issue.board === 'SME' ? 'SME' : 'Mainboard'}</span></article>
            const slug = ipoTrendSlug(issue)
            const history = slug ? histories[slug] : undefined
            return <IssueRow key={issue.id} issue={issue} history={history} {...watchActions} expanded={expanded?.id === issue.id && expanded.view === 'details'} trendExpanded={expanded?.id === issue.id && expanded.view === 'trend'} onRetryHistory={() => { if (slug) retryHistory(slug) }} onToggle={() => setExpanded(expanded?.id === issue.id && expanded.view === 'details' ? null : { id: issue.id, view: 'details' })} onToggleTrend={() => setExpanded(expanded?.id === issue.id && expanded.view === 'trend' ? null : { id: issue.id, view: 'trend' })} />
          })}
        </div> : <div className="mi-empty"><p>{period === 'OPEN' ? 'No IPOs open for bidding right now.' : period === 'UPCOMING' ? 'No upcoming issues reported for this board.' : 'No recent IPOs reported for this board.'}</p>{period !== 'RECENT' && recentCount > 0 && <button className="mi-empty-action" type="button" aria-label={`Browse ${recentCount} recent ${recentCount === 1 ? 'IPO' : 'IPOs'}`} onClick={() => changePeriod('RECENT')}><span>Browse recent</span><span className="mi-empty-count">{recentCount} {recentCount === 1 ? 'IPO' : 'IPOs'}</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg></button>}</div>}
        {filtered.length > 4 && <button className="mi-more" type="button" onClick={() => { setShowAll(!showAll); setExpanded(null) }}>{showAll ? 'Show less' : `View all ${filtered.length} IPOs`}<span aria-hidden="true">{showAll ? '↑' : '↓'}</span></button>}
        <FeedContext feed={feed} />
      </>}
    </>}
  </section>
}



