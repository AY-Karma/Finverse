import { useEffect, useMemo, useState } from 'react'
import { loadMarketFeed, type LoadedMarketFeed, type NewsItem } from '../marketNews'
import { filterNewsEvents, pageCount, pagedEvents, sentimentForTitle, titleParts, type NewsFeedFilters } from '../monitorFeed'
import { useStore } from '../useStore'
import { ImportView } from './ImportView'

const EMPTY_FEED: LoadedMarketFeed = { items: [], issues: [], fetchedAt: 0 }

export function HoldingsView() {
  const { folios, positions, settings, removeFolio, undoLastImport, exportPortfolio } = useStore()
  const [feed, setFeed] = useState<LoadedMarketFeed | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [activeQuery, setActiveQuery] = useState('')
  const holdingsKey = useMemo(
    () => positions.map((position) => `${position.id}:${position.ticker}:${position.name}:${position.type}`).sort().join('|'),
    [positions],
  )
  const monitorPositions = useMemo(() => positions, [holdingsKey])

  useEffect(() => {
    if (!settings.allowExternalData || positions.length === 0) {
      setFeed(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    void loadMarketFeed(monitorPositions, { signal: controller.signal, query: activeQuery })
      .then((next) => {
        if (!controller.signal.aborted) setFeed(next)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFeed({
            ...EMPTY_FEED,
            issues: [{ source: 'Market wire', message: 'News could not be loaded. Try again later.' }],
            fetchedAt: Date.now(),
          })
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [monitorPositions, refreshCount, settings.allowExternalData, activeQuery])

  const current = feed ?? EMPTY_FEED
  const visible = (items: NewsItem[]) => items.filter((item) => !dismissed.has(item.id))
  const dismissItem = (id: string) => setDismissed((currentDismissed) => new Set(currentDismissed).add(id))
  // A deep dive replaces the wire view entirely so the search result is unmistakable.
  const feedItems = visible(current.items).filter((item) => !activeQuery || item.origin === 'search')

  return (
    <>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">02 · Monitor</div>
          <h1 className="page-title">Portfolio watch</h1>
        </div>
        <p className="page-sub">The Indian market wire with your holdings flagged, plus on-demand company deep dives. Overview remains the single place for portfolio value and performance.</p>
      </div>

      {positions.length === 0 ? (
        <>
          <section className="panel holdings-empty enter d1">
            <strong>Start with a portfolio</strong>
            <span className="hint">Import a spreadsheet to follow the market wire and watch your stocks.</span>
            <button className="btn btn--primary" type="button" onClick={() => setImportOpen(true)}>Import holdings</button>
          </section>
          {importOpen && <section className="panel holdings-import enter" aria-label="Import holdings"><ImportView compact /></section>}
        </>
      ) : (
        <>
          {!settings.allowExternalData ? (
            <section className="panel monitor-consent enter d1">
              <div>
                <span className="score-label">External data is off</span>
                <strong>Portfolio Monitor is private until you opt in.</strong>
                <span className="hint">Enabling it fetches public market news. Quantities, values and cost basis stay in this browser.</span>
              </div>
              <span className="section-index">Enable in Settings</span>
            </section>
          ) : (
            <>
              <MonitorStatusStrip
                loading={loading}
                fetchedAt={current.fetchedAt}
                storyCount={feedItems.length}
                onRefresh={() => setRefreshCount((count) => count + 1)}
              />

              {current.issues.length > 0 && (
                <div className="monitor-issues enter" role="status">
                  {current.issues.map((issue) => <span key={`${issue.source}:${issue.message}`}>{issue.source}: {issue.message}</span>)}
                </div>
              )}

              <NewsFeedPanel
                events={feedItems}
                positions={positions}
                loading={loading}
                activeQuery={activeQuery}
                onSelectQuery={setActiveQuery}
                onDismiss={dismissItem}
              />
            </>
          )}

          <ManageHoldings
            folios={folios}
            hasPositions={positions.length > 0}
            importOpen={importOpen}
            onToggleImport={() => setImportOpen((open) => !open)}
            onExport={exportPortfolio}
            onUndoImport={undoLastImport}
            onRemoveFolio={removeFolio}
          />
        </>
      )}
    </>
  )
}

function MonitorStatusStrip({ loading, fetchedAt, storyCount, onRefresh }: {
  loading: boolean
  fetchedAt: number
  storyCount: number
  onRefresh: () => void
}) {
  // Tick every 30s so the freshness signal stays honest without a manual refresh.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const ageMinutes = fetchedAt ? Math.round((now - fetchedAt) / 60_000) : null
  const tone = loading ? 'scanning' : ageMinutes == null || ageMinutes > 45 ? 'stale' : ageMinutes <= 10 ? 'live' : 'aging'
  const label = tone === 'scanning' ? 'Scanning' : tone === 'live' ? 'Live' : tone === 'aging' ? 'On watch' : 'Stale'
  const headline = loading
    ? 'Scanning the wire…'
    : storyCount === 0
      ? 'The wire is quiet'
      : tone === 'live'
        ? 'Fresh off the wire'
        : tone === 'aging'
          ? 'Watching the tape'
          : 'Tape went quiet'
  const updatedHint = `${fetchedAt ? `Updated ${formatRelativeTime(fetchedAt)} · ` : ''}Economic Times Markets · Business Standard`

  return <section className="panel monitor-status enter d1" aria-label="Portfolio monitor status">
    <div className="monitor-status-copy">
      <span className="score-label">Signal desk</span>
      <strong>{headline}</strong>
      <span className="hint">{storyCount > 0 ? `${storyCount} stories on the tape · ${updatedHint}` : updatedHint}</span>
    </div>
    <div className="monitor-status-side">
      <span className="monitor-signal" title={fetchedAt ? `Last fetch ${new Date(fetchedAt).toLocaleTimeString()}` : 'Not fetched yet'}>
        <i className={`signal-dot signal-dot--${tone}`} aria-hidden />
        <span>{label}</span>
      </span>
      <button className="btn btn--secondary btn--small" type="button" disabled={loading} onClick={onRefresh}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  </section>
}

function SkeletonList({ rows }: { rows: number }) {
  return <div className="monitor-skeletons" aria-hidden="true">
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} className="monitor-skeleton">
        <i style={{ width: `${64 - index * 6}%`, animationDelay: `${index * 0.12}s` }} />
        <i style={{ width: `${40 + (index % 3) * 10}%`, animationDelay: `${index * 0.12 + 0.06}s` }} />
      </div>
    ))}
  </div>
}

function formatRelativeTime(value: number): string { const minutes = Math.max(0, Math.round((Date.now() - value) / 60_000)); return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago` }
function formatEventTime(value: number | undefined): string { return value == null ? '—' : new Date(value).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) }

function NewsFeedPanel({ events, positions, loading, activeQuery, onSelectQuery, onDismiss }: {
  events: NewsItem[]
  positions: ReturnType<typeof useStore>['positions']
  loading?: boolean
  activeQuery: string
  onSelectQuery: (query: string) => void
  onDismiss: (id: string) => void
}) {
  const [searchDraft, setSearchDraft] = useState('')
  const [filters, setFilters] = useState<NewsFeedFilters>({ query: '', ticker: 'all', sentiment: 'all', sort: 'latest' })
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const holdings = useMemo(() => [...new Map(positions.map((position) => [position.ticker, position])).values()].sort((left, right) => left.ticker.localeCompare(right.ticker)), [positions])
  const filtered = useMemo(() => filterNewsEvents(events, filters), [events, filters])
  const pages = pageCount(filtered.length, pageSize)
  const currentPage = Math.min(page, pages)
  const pageEvents = pagedEvents(filtered, currentPage, pageSize)
  const updateFilters = (next: Partial<NewsFeedFilters>) => { setFilters((current) => ({ ...current, ...next })); setPage(1) }
  const first = filtered.length ? (currentPage - 1) * pageSize + 1 : 0
  const last = Math.min(currentPage * pageSize, filtered.length)

  return <section className="panel monitor-feed enter d2">
    <div className="monitor-tools-head">
      <span className="panel-title">Focus tools</span>
      <span className="monitor-tools-legend"><span><i>1</i>Search any company or topic</span><span><i>2</i>Rows per page below</span></span>
    </div>
    <form className="monitor-search" role="search" onSubmit={(event) => { event.preventDefault(); onSelectQuery(searchDraft.trim()) }}>
      <input
        type="search"
        value={searchDraft}
        onChange={(event) => setSearchDraft(event.target.value)}
        placeholder="Search any company or topic — e.g. Infosys, IPO, gold"
        aria-label="Search market news"
      />
      <button className="btn btn--secondary btn--small" type="submit">Search news</button>
      {activeQuery && <button className="btn btn--ghost btn--small" type="button" onClick={() => { setSearchDraft(''); onSelectQuery('') }}>Back to wire</button>}
    </form>

    <div className="monitor-feed-head">
      <div>
        <span className={`panel-title${activeQuery ? ' panel-title--deep' : ''}`}>{activeQuery ? `Deep dive · ${activeQuery}` : 'Live wire'}</span>
        <span className="hint">Fresh Indian market news. Stories about your stocks carry their ticker. Read the source before acting.</span>
      </div>
      <div className="monitor-feed-actions">
        <details className={`monitor-menu${filters.query || filters.ticker !== 'all' || filters.sentiment !== 'all' || filters.sort !== 'latest' ? ' monitor-menu--active' : ''}`}>
          <summary aria-label="Sort and filter news"><FilterIcon /><span>Sort &amp; filter</span></summary>
          <div className="monitor-popover monitor-popover--filters">
            <label>Order
              <select value={filters.sort} onChange={(event) => updateFilters({ sort: event.target.value as NewsFeedFilters['sort'] })}>
                <option value="latest">Latest first</option>
                <option value="company">Your holdings first</option>
              </select>
            </label>
            <label>Direction
              <select value={filters.sentiment} onChange={(event) => updateFilters({ sentiment: event.target.value as NewsFeedFilters['sentiment'] })}>
                <option value="all">All signals</option>
                <option value="positive">▲ Positive</option>
                <option value="negative">▼ Negative</option>
                <option value="neutral">● Neutral</option>
              </select>
            </label>
            <label>Holding
              <select value={filters.ticker} onChange={(event) => updateFilters({ ticker: event.target.value })}>
                <option value="all">All stories</option>
                {holdings.map((holding) => <option key={holding.ticker} value={holding.ticker}>{holding.ticker}{holding.name ? ` · ${holding.name}` : ''}</option>)}
              </select>
            </label>
            <label>Contains
              <input type="search" value={filters.query} onChange={(event) => updateFilters({ query: event.target.value })} placeholder="Headline or source" />
            </label>
          </div>
        </details>
      </div>
    </div>

    <div className="monitor-feed-meta"><span>{first}-{last} of {filtered.length} stories</span><label>Show <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}><option value={10}>10</option><option value={15}>15</option><option value={20}>20</option><option value={25}>25</option></select> per page</label></div>
    {loading && events.length === 0 ? (
      <SkeletonList rows={4} />
    ) : !pageEvents.length ? (
      <p className="monitor-empty hint">{activeQuery && events.length === 0
        ? `No fresh stories found for ${activeQuery}. Try another spelling or clear the search.`
        : events.length ? 'No stories match these filters.' : 'No fresh stories right now. Refresh to scan the wire again.'}</p>
    ) : (
      <div className="monitor-events">{pageEvents.map((item) => <NewsEvent item={item} key={item.id} onDismiss={onDismiss} />)}</div>
    )}
    {pages > 1 && !loading && <nav className="monitor-pagination" aria-label="News pages"><button className="icon-btn" type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)}><ChevronIcon direction="left" /></button><span>Page {currentPage} of {pages}</span><button className="icon-btn" type="button" aria-label="Next page" disabled={currentPage === pages} onClick={() => setPage((value) => value + 1)}><ChevronIcon direction="right" /></button></nav>}
  </section>
}

function NewsEvent({ item, onDismiss }: { item: NewsItem; onDismiss: (id: string) => void }) {
  const sentiment = sentimentForTitle(item.title)
  const primaryMatch = item.matches[0]
  return <article className={`monitor-event monitor-event--${sentiment}${primaryMatch ? ' monitor-event--owned' : ''}`}>
    <div className="monitor-event-main">
      <div className="monitor-event-meta">
        <span className="sym">{primaryMatch ?? 'WIRE'}</span>
        <span className={`monitor-sentiment monitor-sentiment--${sentiment}`}><SignalIcon sentiment={sentiment} />{sentiment}</span>
        {primaryMatch && item.matches.length > 1 && <span className="monitor-owned-extra">+{item.matches.length - 1}</span>}
        <span>{item.source}</span>
        <span>{formatEventTime(item.publishedAt)}</span>
      </div>
      <a href={item.sourceUrl} target="_blank" rel="noreferrer">{titleParts(item.title).map((part, index) => <span className={part.sentiment === 'neutral' ? '' : `news-title-number news-title-number--${part.sentiment}`} key={`${part.text}:${index}`}>{part.text}</span>)}<ExternalIcon /></a>
      {item.summary && item.summary !== item.title && <p>{item.summary}</p>}
    </div>
    <button className="icon-btn monitor-dismiss" type="button" aria-label={`Dismiss ${item.title}`} onClick={() => onDismiss(item.id)}><CloseIcon /></button>
  </article>
}

function SignalIcon({ sentiment }: { sentiment: 'positive' | 'negative' | 'neutral' }) { return sentiment === 'neutral' ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={sentiment === 'positive' ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg> }
function FilterIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M7 12h10m-7 6h4" strokeLinecap="round" /></svg> }
function ChevronIcon({ direction }: { direction: 'left' | 'right' }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={direction === 'left' ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'} strokeLinecap="round" strokeLinejoin="round" /></svg> }
function ExternalIcon() { return <svg className="news-external-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function CloseIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" strokeLinecap="round" strokeLinejoin="round" /></svg> }

function ManageHoldings({ folios, hasPositions, importOpen, onToggleImport, onExport, onUndoImport, onRemoveFolio }: { folios: ReturnType<typeof useStore>['folios']; hasPositions: boolean; importOpen: boolean; onToggleImport: () => void; onExport: ReturnType<typeof useStore>['exportPortfolio']; onUndoImport: () => void; onRemoveFolio: (id: string) => void }) {
  return <section className="panel holdings-manage enter d4"><div className="panel-head"><div><span className="panel-title">Manage holdings</span><span className="hint">Imports, local folios and exports</span></div><button className="btn btn--secondary btn--small" type="button" aria-expanded={importOpen} onClick={onToggleImport}>{importOpen ? 'Close import' : 'Import holdings'}</button></div>{importOpen && <div className="holdings-import"><ImportView compact /></div>}<div className="manage-actions"><button className="btn btn--secondary btn--small" type="button" disabled={!hasPositions} onClick={() => onExport('csv')}>Export CSV</button><button className="btn btn--secondary btn--small" type="button" disabled={!hasPositions} onClick={() => onExport('json')}>Backup JSON</button><button className="btn btn--ghost btn--small" type="button" onClick={onUndoImport}>Undo import</button></div>{folios.length > 0 && <div className="folio-list">{folios.map((folio) => <div className="folio-row" key={folio.id}><div className="folio-marker" /><div className="folio-copy"><span className="sym">{folio.name}</span><span className="hint">{folio.positions.length} holding{folio.positions.length === 1 ? '' : 's'} · {new Date(folio.importedAt).toLocaleDateString()}</span></div><button className="btn-remove" type="button" aria-label={`Remove ${folio.name}`} onClick={() => onRemoveFolio(folio.id)}>×</button></div>)}</div>}</section>
}
