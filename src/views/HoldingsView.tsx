import { useEffect, useMemo, useState } from 'react'
import { type HoldingMonitorEvent, type LoadedHoldingBriefing, loadHoldingBriefing } from '../holdingMonitor'
import { filterNewsEvents, pageCount, pagedEvents, sentimentForTitle, titleParts, type NewsFeedFilters } from '../monitorFeed'
import { useStore } from '../useStore'
import { ImportView } from './ImportView'

const EMPTY_BRIEFING: LoadedHoldingBriefing = {
  attention: [],
  upcoming: [],
  updates: [],
  issues: [],
  fetchedAt: 0,
  coverage: { eligibleHoldings: 0, matchedHoldings: 0, unsupportedHoldings: 0 },
}

export function HoldingsView() {
  const { folios, positions, settings, removeFolio, undoLastImport, exportPortfolio } = useStore()
  const [briefing, setBriefing] = useState<LoadedHoldingBriefing | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const holdingsKey = useMemo(
    () => positions.map((position) => `${position.id}:${position.ticker}:${position.type}`).sort().join('|'),
    [positions],
  )

  useEffect(() => {
    if (!settings.allowExternalData || positions.length === 0) {
      setBriefing(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    void loadHoldingBriefing(positions, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setBriefing(next)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBriefing({
            ...EMPTY_BRIEFING,
            issues: [{ source: 'Portfolio Monitor', message: 'Updates could not be loaded. Try again later.' }],
            fetchedAt: Date.now(),
          })
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [holdingsKey, positions, refreshCount, settings.allowExternalData])

  const current = briefing ?? EMPTY_BRIEFING
  const visible = (events: HoldingMonitorEvent[]) => events.filter((event) => !dismissed.has(event.id))
  const dismissEvent = (id: string) => setDismissed((currentDismissed) => new Set(currentDismissed).add(id))
  const newsUpdates = visible(current.updates)

  return (
    <>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">02 · Monitor</div>
          <h1 className="page-title">Portfolio watch</h1>
        </div>
        <p className="page-sub">Recent portfolio news matched to holdings in this browser. Overview remains the single place for portfolio value and performance.</p>
      </div>

      {positions.length === 0 ? (
        <>
          <section className="panel holdings-empty enter d1">
            <strong>Start with a portfolio</strong>
            <span className="hint">Import a spreadsheet to monitor corporate events around your holdings.</span>
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
                <span className="hint">Enabling it sends public instrument identifiers to market-data sources. Quantities, values and cost basis stay in this browser.</span>
              </div>
              <span className="section-index">Enable in Settings</span>
            </section>
          ) : (
            <>
              <section className="monitor-toolbar enter d1" aria-label="Portfolio monitor controls">
                <div>
                  <span className="score-label">Portfolio Monitor</span>
                  <strong>{loading ? 'Checking public feeds…' : current.fetchedAt ? `Updated ${formatRelativeTime(current.fetchedAt)}` : 'Ready to check public feeds'}</strong>
                </div>
                <button className="btn btn--secondary btn--small" type="button" disabled={loading} onClick={() => setRefreshCount((count) => count + 1)}>
                  {loading ? 'Refreshing…' : 'Refresh updates'}
                </button>
              </section>

              {current.issues.length > 0 && (
                <div className="monitor-issues enter" role="status">
                  {current.issues.map((issue) => <span key={`${issue.source}:${issue.message}`}>{issue.source}: {issue.message}</span>)}
                </div>
              )}

              <section className="monitor-signal-bar enter d2" aria-label="Portfolio monitor status">
                <span><SignalIcon sentiment="negative" />{visible(current.attention).length} needs attention</span>
                <span><SignalIcon sentiment="positive" />{current.coverage.matchedHoldings}/{current.coverage.eligibleHoldings} holdings matched</span>
                <span>{newsUpdates.length} stories ready to review</span>
              </section>

              <NewsFeedPanel events={newsUpdates} positions={positions} onDismiss={dismissEvent} />

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

function NewsFeedPanel({ events, positions, onDismiss }: { events: HoldingMonitorEvent[]; positions: ReturnType<typeof useStore>['positions']; onDismiss: (id: string) => void }) {
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

  return <section className="panel monitor-feed enter d3">
    <div className="monitor-feed-head"><div><span className="panel-title">Portfolio news</span><span className="hint">Matched public coverage. Read the source before acting.</span></div><div className="monitor-feed-actions"><span className="monitor-source"><SourceIcon /> Google News</span><details className="monitor-menu"><summary aria-label="Sort news"><SortIcon /><span>Sort</span></summary><div className="monitor-popover"><label>Order<select value={filters.sort} onChange={(event) => updateFilters({ sort: event.target.value as NewsFeedFilters['sort'] })}><option value="latest">Latest first</option><option value="company">Company name</option></select></label></div></details><details className="monitor-menu"><summary aria-label="Filter news"><FilterIcon /><span>Filter</span></summary><div className="monitor-popover monitor-popover--filters"><label>Search<input type="search" value={filters.query} onChange={(event) => updateFilters({ query: event.target.value })} placeholder="Headline or source" /></label><label>Holding<select value={filters.ticker} onChange={(event) => updateFilters({ ticker: event.target.value })}><option value="all">All present holdings</option>{holdings.map((holding) => <option key={holding.ticker} value={holding.ticker}>{holding.ticker}{holding.name ? ` · ${holding.name}` : ''}</option>)}</select></label><label>Direction<select value={filters.sentiment} onChange={(event) => updateFilters({ sentiment: event.target.value as NewsFeedFilters['sentiment'] })}><option value="all">All signals</option><option value="positive">▲ Positive</option><option value="negative">▼ Negative</option><option value="neutral">● Neutral</option></select></label></div></details></div></div>
    <div className="monitor-feed-meta"><span>{first}-{last} of {filtered.length} stories</span><label>Show <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}><option value={10}>10</option><option value={15}>15</option><option value={20}>20</option><option value={25}>25</option></select> per page</label></div>
    {!pageEvents.length ? <p className="monitor-empty hint">No stories match these filters. Try another holding or clear the search.</p> : <div className="monitor-events">{pageEvents.map((event) => <NewsEvent event={event} key={event.id} onDismiss={onDismiss} />)}</div>}
    {pages > 1 && <nav className="monitor-pagination" aria-label="News pages"><button className="icon-btn" type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)}><ChevronIcon direction="left" /></button><span>Page {currentPage} of {pages}</span><button className="icon-btn" type="button" aria-label="Next page" disabled={currentPage === pages} onClick={() => setPage((value) => value + 1)}><ChevronIcon direction="right" /></button></nav>}
  </section>
}

function NewsEvent({ event, onDismiss }: { event: HoldingMonitorEvent; onDismiss: (id: string) => void }) {
  const sentiment = sentimentForTitle(event.title)
  return <article className={`monitor-event monitor-event--${sentiment}`}><div className="monitor-event-main"><div className="monitor-event-meta"><span className="sym">{event.ticker}</span><span className={`monitor-sentiment monitor-sentiment--${sentiment}`}><SignalIcon sentiment={sentiment} />{sentiment}</span><span>{event.source}</span><span>{formatEventTime(event.publishedAt)}</span></div><a href={event.sourceUrl} target="_blank" rel="noreferrer">{titleParts(event.title).map((part, index) => <span className={part.sentiment === 'neutral' ? '' : `news-title-number news-title-number--${part.sentiment}`} key={`${part.text}:${index}`}>{part.text}</span>)}<ExternalIcon /></a>{event.summary && event.summary !== event.title && <p>{event.summary}</p>}</div><button className="icon-btn monitor-dismiss" type="button" aria-label={`Dismiss ${event.title}`} onClick={() => onDismiss(event.id)}><CloseIcon /></button></article>
}

function SignalIcon({ sentiment }: { sentiment: 'positive' | 'negative' | 'neutral' }) { return sentiment === 'neutral' ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={sentiment === 'positive' ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg> }
function FilterIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M7 12h10m-7 6h4" strokeLinecap="round" /></svg> }
function SortIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 5v14m0 0-3-3m3 3 3-3M16 19V5m0 0-3 3m3-3 3 3" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function SourceIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14.5-4.6M20 4v4h-4M20 12a8 8 0 0 1-14.5 4.6M4 20v-4h4" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function ChevronIcon({ direction }: { direction: 'left' | 'right' }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={direction === 'left' ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'} strokeLinecap="round" strokeLinejoin="round" /></svg> }
function ExternalIcon() { return <svg className="news-external-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function CloseIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" strokeLinecap="round" /></svg> }

function ManageHoldings({ folios, hasPositions, importOpen, onToggleImport, onExport, onUndoImport, onRemoveFolio }: { folios: ReturnType<typeof useStore>['folios']; hasPositions: boolean; importOpen: boolean; onToggleImport: () => void; onExport: ReturnType<typeof useStore>['exportPortfolio']; onUndoImport: () => void; onRemoveFolio: (id: string) => void }) {
  return <section className="panel holdings-manage enter d4"><div className="panel-head"><div><span className="panel-title">Manage holdings</span><span className="hint">Imports, local folios and exports</span></div><button className="btn btn--secondary btn--small" type="button" aria-expanded={importOpen} onClick={onToggleImport}>{importOpen ? 'Close import' : 'Import holdings'}</button></div>{importOpen && <div className="holdings-import"><ImportView compact /></div>}<div className="manage-actions"><button className="btn btn--secondary btn--small" type="button" disabled={!hasPositions} onClick={() => onExport('csv')}>Export CSV</button><button className="btn btn--secondary btn--small" type="button" disabled={!hasPositions} onClick={() => onExport('json')}>Backup JSON</button><button className="btn btn--ghost btn--small" type="button" onClick={onUndoImport}>Undo import</button></div>{folios.length > 0 && <div className="folio-list">{folios.map((folio) => <div className="folio-row" key={folio.id}><div className="folio-marker" /><div className="folio-copy"><span className="sym">{folio.name}</span><span className="hint">{folio.positions.length} holding{folio.positions.length === 1 ? '' : 's'} · {new Date(folio.importedAt).toLocaleDateString()}</span></div><button className="btn-remove" type="button" aria-label={`Remove ${folio.name}`} onClick={() => onRemoveFolio(folio.id)}>×</button></div>)}</div>}</section>
}

function formatRelativeTime(value: number): string { const minutes = Math.max(0, Math.round((Date.now() - value) / 60_000)); return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago` }
function formatEventTime(value: number | undefined): string { return value == null ? 'time unavailable' : new Date(value).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) }
