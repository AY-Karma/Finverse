import { useEffect, useMemo, useRef, useState } from 'react'
import { eligibleHoldings, loadMarketFeed, type LoadedMarketFeed, type NewsItem } from '../marketNews'
import { filterNewsEvents, pageCount, pagedEvents, titleParts, type NewsFeedFilters } from '../monitorFeed'
import { useStore } from '../useStore'
import { MonitorNewsIcon } from './MonitorNewsIcon'
import './monitorNewsPanel.css'

const EMPTY_FEED: LoadedMarketFeed = { items: [], issues: [], fetchedAt: 0 }
const PAGE_SIZE = 3

export function MonitorNewsPanel({ initialQuery = '', selectedTicker, selectedRevision }: { initialQuery?: string; selectedTicker?: string; selectedRevision?: number }) {
  const { positions, settings } = useStore()
  const holdingsKey = useMemo(() => positions.map((position) => `${position.id}:${position.ticker}:${position.name}:${position.type}:${position.providerSymbol ?? ''}:${position.exchange ?? ''}:${position.currency ?? ''}`).sort().join('|'), [positions])
  const monitorPositions = useMemo(() => positions, [holdingsKey])
  const holdings = useMemo(() => [...new Map(eligibleHoldings(monitorPositions).map((holding) => [holding.ticker, holding])).values()].sort((left, right) => left.ticker.localeCompare(right.ticker)), [monitorPositions])
  const selectedHolding = holdings.find((holding) => holding.ticker === selectedTicker)
  const startingQuery = selectedHolding ? selectedHolding.name || selectedHolding.ticker : initialQuery
  const [feed, setFeed] = useState<LoadedMarketFeed | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)
  const [searchDraft, setSearchDraft] = useState(startingQuery)
  const [showTools, setShowTools] = useState(false)
  const [activeQuery, setActiveQuery] = useState(startingQuery)
  const [scope, setScope] = useState<'holdings' | 'market'>('holdings')
  const [holdingTicker, setHoldingTicker] = useState(selectedHolding?.ticker ?? '')
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [filters, setFilters] = useState<NewsFeedFilters>({ query: '', ticker: 'all', sentiment: 'all', sort: 'latest' })
  const [page, setPage] = useState(1)
  const activeRegion = holdings.find((holding) => holding.ticker === holdingTicker)?.region
  const previousInitialQuery = useRef(initialQuery)

  useEffect(() => {
    if (previousInitialQuery.current === initialQuery) return
    previousInitialQuery.current = initialQuery
    setSearchDraft(initialQuery)
    setActiveQuery(initialQuery)
    setHoldingTicker('')
    setFilters({ query: '', ticker: 'all', sentiment: 'all', sort: 'latest' })
    setPage(1)
  }, [initialQuery])

  useEffect(() => {
    if (!selectedTicker || !selectedHolding) return
    const query = selectedHolding.name || selectedHolding.ticker
    setSearchDraft(query)
    setActiveQuery(query)
    setHoldingTicker(selectedHolding.ticker)
    setScope('holdings')
    setFilters({ query: '', ticker: 'all', sentiment: 'all', sort: 'latest' })
    setPage(1)
  }, [selectedTicker, selectedRevision, selectedHolding?.name, selectedHolding?.ticker, selectedHolding?.region])

  useEffect(() => {
    setFeed(null)
    if (!settings.allowExternalData || monitorPositions.length === 0) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    void loadMarketFeed(monitorPositions, {
      signal: controller.signal,
      query: activeQuery,
      ...(activeRegion ? { region: activeRegion } : {}),
      onPartial: (next) => {
        if (!controller.signal.aborted) setFeed(next)
      },
    })
      .then((next) => {
        if (!controller.signal.aborted) setFeed(next)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFeed({ ...EMPTY_FEED, fetchedAt: Date.now(), issues: [{ source: 'Market wire', message: 'News could not be loaded. Try again later.' }] })
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [monitorPositions, settings.allowExternalData, activeQuery, activeRegion, refreshCount])

  const current = feed ?? EMPTY_FEED
  const eligibleTickers = new Set(holdings.map((holding) => holding.ticker))
  const events = current.items
    .filter((item) => !dismissed.has(item.id) && (!activeQuery || item.origin === 'search'))
    .map((item) => ({ ...item, matches: [...new Set(item.matches)].filter((ticker) => eligibleTickers.has(ticker)) }))
  const matchedHoldings = new Set(events.flatMap((item) => item.matches)).size
  const scopedEvents = scope === 'holdings' && !activeQuery ? events.filter((item) => item.matches.length > 0) : events
  const filtered = filterNewsEvents(scopedEvents, filters)
  const pages = pageCount(filtered.length, PAGE_SIZE)
  const currentPage = Math.min(page, pages)
  const pageEvents = pagedEvents(filtered, currentPage, PAGE_SIZE)
  const updateFilters = (next: Partial<NewsFeedFilters>) => {
    setFilters((value) => ({ ...value, ...next }))
    setPage(1)
  }
  const selectQuery = (query: string) => {
    setActiveQuery(query)
    setHoldingTicker('')
    setFilters((value) => ({ ...value, ticker: 'all' }))
    setPage(1)
  }
  const findHoldingNews = (ticker: string) => {
    const holding = holdings.find((item) => item.ticker === ticker)
    const query = holding ? holding.name || holding.ticker : ''
    setSearchDraft(query)
    selectQuery(query)
    setHoldingTicker(holding?.ticker ?? '')
    setScope('holdings')
  }
  const enabled = settings.allowExternalData && positions.length > 0
  const first = filtered.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0
  const last = Math.min(currentPage * PAGE_SIZE, filtered.length)

  return <section className="mn-panel" aria-labelledby="monitor-news-heading">
    <header className="mn-head">
      <span className="mn-heading-icon"><MonitorNewsIcon /></span>
      <div>
        <h2 id="monitor-news-heading">Portfolio news</h2>
        <p>Holdings in the headlines</p>
      </div>
      {enabled && <div className="mn-head-actions">
        <button className="mn-icon-button" type="button" aria-label="Search and filter market news" title="Search and filter market news" aria-expanded={showTools} aria-controls="monitor-news-tools" onClick={() => setShowTools((value) => !value)}><SearchIcon /></button>
        <button className="mn-icon-button" type="button" aria-label="Refresh market news" title="Refresh market news" disabled={loading} onClick={() => setRefreshCount((count) => count + 1)}><RefreshIcon /></button>
      </div>}
    </header>

    <div className="mn-scope-row" role="group" aria-label="News scope">
      <div className="mn-scope">
        <button type="button" aria-pressed={scope === 'holdings'} disabled={!enabled} onClick={() => { setScope('holdings'); setPage(1) }}>Holdings</button>
        <button type="button" aria-pressed={scope === 'market'} disabled={!enabled} onClick={() => { setScope('market'); setSearchDraft(''); selectQuery('') }}>Market</button>
      </div>
    </div>
    <label className="mn-holding-search"><span className="mn-sr-only">Find news for a holding</span><select aria-label="Find news for a holding" value={holdingTicker} disabled={!enabled || holdings.length === 0} onChange={(event) => findHoldingNews(event.target.value)}>
      <option value="">Find news for a holding</option>
      {holdings.map((holding) => <option value={holding.ticker} key={holding.ticker}>{holding.ticker} · {holding.name}</option>)}
    </select></label>

    {!enabled ? <div className="mn-empty">
      <strong>{positions.length === 0 ? 'Add holdings to follow the wire' : 'External data is off'}</strong>
      <p>{positions.length === 0 ? 'Import your portfolio in Settings to see its news here.' : 'Enable external market data in Settings to load news.'}</p>
      <a className="mn-settings" href="/app/settings">Open Settings <ArrowIcon /></a>
    </div> : <>
      <div id="monitor-news-tools" hidden={!showTools}>
      <form className="mn-search" role="search" onSubmit={(event) => { event.preventDefault(); selectQuery(searchDraft.trim()) }}>
        <input type="search" aria-label="Search market news" placeholder="Company or topic" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
        <button className="mn-button" type="submit">Search</button>
      </form>
      <div className="mn-filter-row">
        <label className="mn-holding-filter"><span className="mn-sr-only">Filter news by holding</span><select value={filters.ticker} onChange={(event) => updateFilters({ ticker: event.target.value })}>
          <option value="all">All stories</option>
          {holdings.map((holding) => <option value={holding.ticker} key={holding.ticker}>{holding.ticker}</option>)}
        </select></label>
        <details className="mn-filters">
          <summary><FilterIcon /> Filters</summary>
          <div className="mn-filter-fields">
            <label>Order<select value={filters.sort} onChange={(event) => updateFilters({ sort: event.target.value as NewsFeedFilters['sort'] })}><option value="latest">Latest first</option><option value="company">By holding</option></select></label>
            <label>Headline language<select value={filters.sentiment} onChange={(event) => updateFilters({ sentiment: event.target.value as NewsFeedFilters['sentiment'] })}><option value="all">All headlines</option><option value="positive">Positive words</option><option value="negative">Negative words</option><option value="neutral">Neutral words</option></select></label>
            <label>Contains<input type="search" value={filters.query} onChange={(event) => updateFilters({ query: event.target.value })} placeholder="Headline or source" /></label>
          </div>
        </details>
      </div>
      </div>
      {activeQuery && <div className="mn-query"><strong>Search: {activeQuery}</strong><button className="mn-text-button" type="button" onClick={() => { setSearchDraft(''); selectQuery('') }}>Back to wire</button></div>}
      <div className="mn-coverage">
        <strong>{loading && feed == null ? 'Checking holding mentions...' : holdings.length ? `${matchedHoldings} of ${holdings.length} holdings mentioned` : 'No eligible company holdings'}</strong>
        <p>{activeQuery ? 'Search results may include other companies. Matches use headline names and tickers.' : 'Matches use headline names and tickers. Coverage varies by publisher.'}</p>
        {positions.some((position) => position.type === 'mutual-fund') && <p>Mutual funds use NAV updates; constituent news is not available.</p>}
      </div>
      <div className="mn-feed-status" role="status">
        <span>{loading ? 'Scanning the wire…' : `${first}–${last} of ${filtered.length} stories`}</span>
        {current.fetchedAt > 0 && <time dateTime={new Date(current.fetchedAt).toISOString()}>Updated {new Date(current.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>}
      </div>
      {current.issues.length > 0 && <div className="mn-issues" role="status">{current.issues.map((issue) => <p key={`${issue.source}:${issue.message}`}>{issue.source}: {issue.message}</p>)}</div>}
      {loading && scopedEvents.length === 0 ? <div className="mn-loading" aria-label="Loading market news">{[0, 1, 2].map((row) => <div key={row} aria-hidden="true"><i /><i /></div>)}</div> : pageEvents.length > 0 ? <div className="mn-stories">
        {pageEvents.map((item) => <NewsStory key={item.id} item={item} onDismiss={() => setDismissed((value) => new Set(value).add(item.id))} />)}
      </div> : <div className="mn-empty"><p>{activeQuery && events.length === 0 ? `No fresh stories found for ${activeQuery}. Try another spelling or return to the wire.` : scopedEvents.length ? 'No stories match these filters.' : scope === 'holdings' ? 'No holding names found in the wire. Choose a holding to search its news, or open Market for the full wire.' : 'No fresh stories right now. Refresh to scan the wire again.'}</p></div>}
      <footer className="mn-footer">
        <span>Publisher sources · latest headlines</span>
        {pages > 1 && <nav aria-label="Market news pages"><button className="mn-icon-button" type="button" aria-label="Previous news page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronIcon direction="left" /></button><span>{currentPage} / {pages}</span><button className="mn-icon-button" type="button" aria-label="Next news page" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronIcon direction="right" /></button></nav>}
      </footer>
    </>}
  </section>
}

function NewsStory({ item, onDismiss }: { item: NewsItem; onDismiss: () => void }) {
  return <article className="mn-story">
    <div className="mn-story-top"><span className="mn-story-tag" title={item.matches.length ? `Headline mentions ${item.matches.join(', ')}` : 'No portfolio holding names matched in this headline'}>{item.matches.length ? item.matches.join(' · ') : item.origin === 'search' ? 'SEARCH' : 'MARKET'}</span><button className="mn-icon-button mn-dismiss" type="button" aria-label={`Dismiss ${item.title}`} onClick={onDismiss}><CloseIcon /></button></div>
    <a className="mn-story-title" href={item.sourceUrl} target="_blank" rel="noreferrer">{titleParts(item.title).map((part, index) => part.highlighted ? <strong key={index} className={`mn-title-number mn-title-${part.sentiment}`}>{part.text}</strong> : part.text)} <ArrowIcon /></a>
    <div className="mn-story-meta"><span>{item.source}</span><time dateTime={item.publishedAt == null ? undefined : new Date(item.publishedAt).toISOString()}>{item.publishedAt == null ? 'Time unavailable' : new Date(item.publishedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</time></div>
  </article>
}

function RefreshIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5m-4-4a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" strokeLinecap="round" /></svg> }
function FilterIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M7 12h10m-7 6h4" strokeLinecap="round" /></svg> }
function ArrowIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function ChevronIcon({ direction }: { direction: 'left' | 'right' }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={direction === 'left' ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'} strokeLinecap="round" strokeLinejoin="round" /></svg> }
function CloseIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" strokeLinecap="round" /></svg> }
