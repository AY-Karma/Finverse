import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { eligibleHoldings, loadMarketFeed, type LoadedMarketFeed, type NewsItem, type NewsRegion } from '../marketNews'
import { groupNewsItems, MAX_NEWS_FOLLOWS, rememberArticles, updateArticleReading, type ArticleReading, type MonitorReadingState, type NewsGroup } from '../monitorReading'
import { classifyHeadline, type HeadlineTone } from '../headlineTone'
import { useStore } from '../useStore'
import { dateFormatter } from '../formatters'
import { MonitorNewsIcon } from './MonitorNewsIcon'
import { ActionIcon } from './ActionIcon'
import './monitorNewsPanel.css'

const EMPTY_FEED: LoadedMarketFeed = { items: [], issues: [], fetchedAt: 0 }
const TONE_LABELS: Record<HeadlineTone, string> = { positive: '+ Positive', negative: '− Negative', mixed: '± Mixed', unknown: '? Unclear' }
const storyDate = dateFormatter({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const updatedTime = dateFormatter({ hour: 'numeric', minute: '2-digit' })
type ReadingPatch = Partial<Pick<ArticleReading, 'openedAt' | 'savedAt' | 'dismissedAt'>>

type MonitorNewsPanelProps = {
  initialQuery?: string; selectedIdentity?: string; selectedRevision?: number
  reading: MonitorReadingState; onReadingChange: (next: MonitorReadingState) => boolean
  onOpenHolding?: (identity: string) => void; readOnly?: boolean
}
type FeedResult = { key: string; value: LoadedMarketFeed }

export function MonitorNewsPanel(props: MonitorNewsPanelProps) {
  const { settings } = useStore()
  return <MonitorNewsContent key={settings.hideValues ? 'masked' : 'visible'} {...props} />
}

function MonitorNewsContent({ initialQuery = '', selectedIdentity, selectedRevision, reading, onReadingChange, onOpenHolding, readOnly = false }: MonitorNewsPanelProps) {
  const { positions, settings } = useStore()
  const holdingsKey = useMemo(() => positions.map((position) => `${position.id}:${position.ticker}:${position.name}:${position.type}:${position.providerSymbol ?? ''}:${position.exchange ?? ''}:${position.currency ?? ''}:${position.instrumentKey ?? ''}:${position.isin ?? ''}`).sort().join('|'), [positions])
  const monitorPositions = useMemo(() => positions, [holdingsKey])
  const holdings = useMemo(() => settings.hideValues ? [] : eligibleHoldings(monitorPositions).sort((a, b) => a.ticker.localeCompare(b.ticker) || a.identity.localeCompare(b.identity)), [monitorPositions, settings.hideValues])
  const selectedHolding = holdings.find((holding) => holding.identity === selectedIdentity)
  const startingQuery = settings.hideValues ? '' : selectedHolding ? selectedHolding.name || selectedHolding.ticker : initialQuery
  const [result, setResult] = useState<FeedResult | null>(null)
  const [pending, setPending] = useState<FeedResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)
  const [searchDraft, setSearchDraft] = useState(startingQuery)
  const [showTools, setShowTools] = useState(false)
  const [activeQuery, setActiveQuery] = useState(startingQuery)
  const [holdingIdentity, setHoldingIdentity] = useState(selectedHolding?.identity ?? '')
  const [queryRegion, setQueryRegion] = useState<NewsRegion | undefined>(selectedHolding?.region)
  const [saveError, setSaveError] = useState('')
  const requestKey = JSON.stringify([holdingsKey, settings.hideValues, settings.allowExternalData, activeQuery, queryRegion])
  const loadedKey = useRef('')
  const handledRefresh = useRef(0)
  const feedRef = useRef<FeedResult | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchToggleRef = useRef<HTMLButtonElement>(null)
  const previousInitialQuery = useRef(initialQuery)
  const initialSeen = useRef(new Set(reading.articles.map((article) => article.key)))
  const returning = useRef(reading.articles.length > 0)
  const current = result?.key === requestKey ? result.value : EMPTY_FEED
  const queued = pending?.key === requestKey ? pending.value : null
  const eligibleTickers = useMemo(() => new Set(holdings.map((holding) => holding.ticker)), [holdings])
  const uniqueHoldings = useMemo(() => {
    const byTicker = new Map<string, typeof holdings[number] | undefined>()
    for (const holding of holdings) byTicker.set(holding.ticker, byTicker.has(holding.ticker) ? undefined : holding)
    return byTicker
  }, [holdings])
  const scopedItems = useCallback((items: NewsItem[]) => items.filter((item) => !activeQuery || item.origin === 'search')
    .map((item) => ({ ...item, matches: [...new Set(item.matches)].filter((ticker) => eligibleTickers.has(ticker)) })), [activeQuery, eligibleTickers])
  const articles = useMemo(() => new Map(reading.articles.map((article) => [article.key, article])), [reading.articles])
  const undo = useMemo(() => settings.hideValues ? undefined : reading.articles.reduce<ArticleReading | undefined>((latest, article) => (article.dismissedAt ?? 0) > (latest?.dismissedAt ?? 0) ? article : latest, undefined), [reading.articles, settings.hideValues])
  const currentGroups = useMemo(() => groupNewsItems(scopedItems(current.items)), [current.items, scopedItems])
  const groups = useMemo(() => currentGroups.filter((group) => !articles.get(group.key)?.dismissedAt), [currentGroups, articles])
  const queuedCount = useMemo(() => {
    if (!queued) return 0
    const currentKeys = new Set(currentGroups.map((group) => group.key))
    return groupNewsItems(scopedItems(queued.items)).filter((group) => !currentKeys.has(group.key)).length
  }, [queued, currentGroups, scopedItems])
  const saved = useMemo(() => settings.hideValues ? [] : reading.articles.filter((article) => article.savedAt).sort((a, b) => b.savedAt! - a.savedAt!), [settings.hideValues, reading.articles])
  const savedGroups = useMemo(() => saved.map((article) => ({ key: article.key, item: { ...article.item, matches: article.item.matches.filter((ticker) => eligibleTickers.has(ticker)) }, sources: [article.item] })), [saved, eligibleTickers])
  const followed = reading.follows.find((follow) => follow.query.toLowerCase() === activeQuery.toLowerCase() && follow.region === (queryRegion ?? 'IN'))
  const readingRef = useRef(reading)
  const onReadingChangeRef = useRef(onReadingChange)
  readingRef.current = reading
  onReadingChangeRef.current = onReadingChange

  useEffect(() => {
    if (settings.hideValues || previousInitialQuery.current === initialQuery) return
    previousInitialQuery.current = initialQuery
    setSearchDraft(initialQuery)
    setActiveQuery(initialQuery)
    setHoldingIdentity('')
    setQueryRegion(undefined)
  }, [initialQuery, settings.hideValues])

  useEffect(() => {
    if (settings.hideValues || !selectedIdentity || !selectedHolding) return
    const query = selectedHolding.name || selectedHolding.ticker
    setSearchDraft(query)
    setActiveQuery(query)
    setHoldingIdentity(selectedHolding.identity)
    setQueryRegion(selectedHolding.region)
  }, [selectedIdentity, selectedRevision, selectedHolding?.name, selectedHolding?.identity, selectedHolding?.region, settings.hideValues])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [requestKey])

  useEffect(() => {
    if (!showTools) return
    searchInputRef.current?.focus()
    const dismissSearch = (event: PointerEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) setShowTools(false)
    }
    document.addEventListener('pointerdown', dismissSearch)
    return () => document.removeEventListener('pointerdown', dismissSearch)
  }, [showTools])

  useEffect(() => {
    setPending(null)
    if (!settings.allowExternalData) {
      feedRef.current = null
      setResult(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const forceRefresh = handledRefresh.current !== refreshCount
    handledRefresh.current = refreshCount
    setLoading(true)
    const acceptFeed = (next: LoadedMarketFeed) => {
      if (controller.signal.aborted) return
      const previous = feedRef.current
      let accepted: FeedResult = { key: requestKey, value: next }
      if (previous?.key === requestKey && previous.value.items.length > 0) {
        if (!next.items.length && next.issues.length) accepted = { ...previous, value: { ...previous.value, issues: next.issues } }
        else if (loadedKey.current === requestKey) {
          const keys = new Set(groupNewsItems(previous.value.items).map((group) => group.key))
          if (groupNewsItems(next.items).some((group) => !keys.has(group.key))) setPending({ key: requestKey, value: next })
          accepted = { ...previous, value: { ...previous.value, issues: next.issues } }
        }
      }
      feedRef.current = accepted
      setResult(accepted)
    }
    void loadMarketFeed(settings.hideValues ? [] : monitorPositions, {
      signal: controller.signal, query: activeQuery, forceRefresh, ...(queryRegion ? { region: queryRegion } : {}), onPartial: acceptFeed,
    }).then((next) => {
      acceptFeed(next)
      if (!controller.signal.aborted) loadedKey.current = requestKey
    }).catch(() => {
      if (!controller.signal.aborted) acceptFeed({ items: [], fetchedAt: 0, issues: [{ source: 'Market wire', message: 'News could not be loaded. Try again later.' }] })
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [monitorPositions, settings.allowExternalData, settings.hideValues, activeQuery, queryRegion, refreshCount, requestKey])

  useEffect(() => {
    if (!current.items.length || readOnly || settings.hideValues) return
    const next = rememberArticles(readingRef.current, current.items, Date.now())
    if (next !== readingRef.current && !onReadingChangeRef.current(next)) setSaveError('News preferences could not be saved.')
  }, [current.items, readOnly, settings.hideValues])

  const save = useCallback((next: MonitorReadingState) => {
    if (readOnly || !onReadingChange(next)) { setSaveError('News preferences could not be saved. Try again after reloading.'); return false }
    setSaveError('')
    return true
  }, [readOnly, onReadingChange])
  const selectQuery = (query: string, region?: NewsRegion) => {
    setSearchDraft(query); setActiveQuery(query); setHoldingIdentity(''); setQueryRegion(region)
  }
  const findHoldingNews = (identity: string) => {
    const holding = holdings.find((item) => item.identity === identity)
    selectQuery(holding ? holding.name || holding.ticker : '', holding?.region)
    setHoldingIdentity(holding?.identity ?? '')
  }
  const update = useCallback((item: NewsItem, patch: ReadingPatch) => save(updateArticleReading(reading, item, patch)), [save, reading])
  const dismiss = useCallback((item: NewsItem) => {
    update(item, { dismissedAt: Date.now() })
  }, [update])
  const toggleFollow = () => {
    if (!activeQuery.trim()) return
    if (!followed && reading.follows.length >= MAX_NEWS_FOLLOWS) { setSaveError('Remove a followed topic before adding another.'); return }
    save({ ...reading, follows: followed ? reading.follows.filter((follow) => follow.id !== followed.id) : [...reading.follows, { id: crypto.randomUUID(), query: activeQuery.trim().slice(0, 120), region: queryRegion ?? 'IN' }] })
  }
  const storyProps = (group: NewsGroup) => ({
    group, state: articles.get(group.key), isNew: returning.current && !initialSeen.current.has(group.key), readOnly,
    onUpdate: update, onDismiss: dismiss,
    holding: settings.hideValues || !onOpenHolding ? undefined : group.item.matches.map((ticker) => uniqueHoldings.get(ticker)).find(Boolean),
    onOpenHolding,
  })

  return <section className="mn-panel" aria-labelledby="monitor-news-heading" aria-busy={loading}>
    <header className={`mn-head${showTools ? ' mn-head--searching' : ''}`}><span className="mn-heading-icon"><MonitorNewsIcon /></span><h2 id="monitor-news-heading" tabIndex={-1}>Market news</h2>
      {settings.allowExternalData && <div className="mn-head-actions">
        <div className="mn-search-control" ref={searchRef} onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setShowTools(false)
        }} onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          setShowTools(false)
          searchToggleRef.current?.focus()
        }}>
          <form id="monitor-news-tools" className={`mn-search${showTools ? ' mn-search--open' : ''}`} role="search" aria-label="Market news search" inert={!showTools} onSubmit={(event) => {
            event.preventDefault()
            selectQuery(searchDraft.trim())
            setShowTools(false)
            searchToggleRef.current?.focus()
          }}>
            <input ref={searchInputRef} type="search" enterKeyHint="search" maxLength={120} aria-label="Search market news" placeholder="Company or topic" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
            {!settings.hideValues && <label className="mn-holding-search" title="Find news for a holding"><span className="mn-sr-only">Find news for a holding</span><ActionIcon name="holdings" /><select aria-label="Find news for a holding" value={holdingIdentity} disabled={holdings.length === 0} onChange={(event) => {
              findHoldingNews(event.target.value)
              setShowTools(false)
              searchToggleRef.current?.focus()
            }}><option value="">Find news for a holding</option>{holdings.map((holding) => <option value={holding.identity} key={holding.identity}>{holding.ticker}{holding.name ? ` · ${holding.name}` : ''}</option>)}</select></label>}
            <button className="mn-search-submit" type="submit" aria-label="Submit news search" title="Search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          </form>
          <button ref={searchToggleRef} className="mn-icon-button" type="button" aria-label="Search market news" title={showTools ? 'Close search' : 'Search market news'} aria-expanded={showTools} aria-controls="monitor-news-tools" onClick={() => setShowTools((value) => !value)}>{showTools ? <CloseIcon /> : <SearchIcon />}</button>
        </div>
        <button className="mn-icon-button mn-refresh" type="button" aria-label="Refresh market news" title="Refresh market news" disabled={loading} onClick={() => setRefreshCount((count) => count + 1)}><RefreshIcon /></button>
      </div>}
    </header>
    <div className="mn-feed-scroll" ref={scrollRef} role="region" aria-label="Market news feed" tabIndex={0}>
    {saveError && <p className="mn-issues" role="alert">{saveError}</p>}
    {!settings.allowExternalData ? <div className="mn-empty"><strong>External data is off</strong><p>Enable external market data in Settings to load news.</p><a className="workspace-action mn-settings" href="/app/settings"><ActionIcon name="settings" />Open Settings</a></div> : <>
      {activeQuery && <div className="mn-query"><strong>{activeQuery}</strong>{!settings.hideValues && <button className="mn-text-button" type="button" disabled={readOnly} aria-pressed={Boolean(followed)} onClick={toggleFollow}>{followed ? 'Following' : 'Follow'}</button>}<button className="workspace-action" type="button" onClick={() => selectQuery('')}>Back to wire</button></div>}
      {!settings.hideValues && reading.follows.length > 0 && <details className="mn-following"><summary>Following <span>{reading.follows.length}</span></summary><ul>{reading.follows.map((follow) => <li key={follow.id}><button className="mn-text-button" type="button" onClick={() => selectQuery(follow.query, follow.region)}>{follow.query}<span>{follow.region}</span></button><button className="mn-icon-button" type="button" disabled={readOnly} aria-label={`Unfollow ${follow.query}`} onClick={() => save({ ...reading, follows: reading.follows.filter((item) => item.id !== follow.id) })}><CloseIcon /></button></li>)}</ul></details>}
      <div className="mn-feed-status" role="status"><span>{loading ? current.items.length ? 'Refreshing…' : 'Loading headlines…' : activeQuery ? 'Company or topic search' : 'Latest headlines'}</span>{current.fetchedAt > 0 && <time dateTime={new Date(current.fetchedAt).toISOString()}>Updated {updatedTime.format(current.fetchedAt)}</time>}</div>
      {queuedCount > 0 && <button className="mn-new-button" type="button" onClick={() => { feedRef.current = pending; setResult(pending); setPending(null) }}>Show {queuedCount} new {queuedCount === 1 ? 'headline' : 'headlines'}</button>}
      {undo && <div className="mn-undo" role="status"><span>Headline dismissed</span><button className="mn-text-button" type="button" disabled={readOnly} onClick={() => update(undo.item, { dismissedAt: undefined })}>Undo</button></div>}
      {current.issues.length > 0 && <div className="mn-issues" role="status">{current.items.length > 0 && <p>Showing available headlines.</p>}{current.issues.map((issue) => <p key={`${issue.source}:${issue.message}`}>{issue.source}: {issue.message}</p>)}</div>}
      {loading && groups.length === 0 ? <div className="mn-loading" aria-label="Loading market news">{[0, 1, 2].map((row) => <div key={row} aria-hidden="true"><i /><i /></div>)}</div> : groups.length > 0 ? <div className="mn-stories">{groups.map((group) => <NewsStory key={group.key} {...storyProps(group)} />)}</div> : <div className="mn-empty"><p>{current.issues.length ? 'Headlines unavailable. Try refreshing.' : activeQuery ? 'No fresh stories found. Try another search or return to the wire.' : 'No fresh stories right now.'}</p></div>}
      {groups.some((group) => group.item.matches.length > 0) && <p className="mn-match-note">Holding labels are headline matches, not verified links.</p>}
    </>}
    {savedGroups.length > 0 && <details className="mn-saved"><summary>Saved articles <span>{savedGroups.length}</span></summary>{savedGroups.map((group) => <NewsStory key={group.key} {...storyProps(group)} />)}</details>}
    </div>
  </section>
}

const NewsStory = memo(function NewsStory({ group, state, isNew, readOnly, onUpdate, onDismiss, holding, onOpenHolding }: {
  group: NewsGroup; state?: ArticleReading; isNew: boolean; readOnly: boolean
  onUpdate: (item: NewsItem, patch: ReadingPatch) => boolean; onDismiss: (item: NewsItem) => void
  holding?: { identity: string; ticker: string }; onOpenHolding?: (identity: string) => void
}) {
  const item = group.item
  const onOpen = () => { if (!readOnly) onUpdate(item, { openedAt: Date.now() }) }
  const tone = classifyHeadline(item.title)
  const explanation = `Estimated headline tone: ${tone.status === 'unknown' ? 'unclear' : tone.status}. ${tone.reason}`
  return <article className={`mn-story${state?.openedAt ? ' mn-story--opened' : ''}`}>
    <div className="mn-story-top"><div className="mn-story-meta"><span>{item.source}</span><time dateTime={item.publishedAt == null ? undefined : new Date(item.publishedAt).toISOString()}>{item.publishedAt == null ? 'Time unavailable' : storyDate.format(item.publishedAt)}</time>{isNew && !state?.openedAt && <span className="mn-new-label">New</span>}</div>
      <div className="mn-story-actions"><button className="mn-icon-button" type="button" disabled={readOnly} aria-label={`${state?.openedAt ? 'Mark unread' : 'Mark read'}: ${item.title}`} title={state?.openedAt ? 'Mark unread' : 'Mark read'} onClick={() => onUpdate(item, { openedAt: state?.openedAt ? undefined : Date.now() })}><ReadIcon read={Boolean(state?.openedAt)} /></button><button className="mn-icon-button" type="button" disabled={readOnly} aria-label={`${state?.savedAt ? 'Unsave' : 'Save'}: ${item.title}`} aria-pressed={Boolean(state?.savedAt)} title={state?.savedAt ? 'Unsave article' : 'Save article'} onClick={() => onUpdate(item, { savedAt: state?.savedAt ? undefined : Date.now() })}><SaveIcon saved={Boolean(state?.savedAt)} /></button><button className="mn-icon-button mn-dismiss" type="button" disabled={readOnly} aria-label={`Dismiss ${item.title}`} title="Dismiss headline" onClick={() => onDismiss(item)}><CloseIcon /></button></div>
    </div>
    <a className="mn-story-title" href={item.sourceUrl} target="_blank" rel="noreferrer" onClick={onOpen}>{item.title} <ArrowIcon /></a>
    <div className="mn-story-tags"><span className={`mn-tone mn-tone-${tone.status}`} role="img" aria-label={explanation} title={explanation}>{TONE_LABELS[tone.status]}</span>{holding ? <button className="mn-text-button mn-company" type="button" aria-label={`View ${holding.ticker}`} title="Headline match. Open company details." onClick={() => onOpenHolding?.(holding.identity)}>{holding.ticker} ↗</button> : item.matches.length > 0 && <span className="mn-story-tag">Headline match · {item.matches.join(' · ')}</span>}</div>
    {group.sources.length > 1 && <details className="mn-sources"><summary>{group.sources.length} sources</summary><ul>{group.sources.map((source) => <li key={source.sourceUrl}><a href={source.sourceUrl} target="_blank" rel="noreferrer" onClick={onOpen}>{source.source} <ArrowIcon /></a></li>)}</ul></details>}
  </article>
})

function RefreshIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M20 12a8 8 0 1 1-8-8 8.5 8.5 0 0 1 5.66 2.34L20 8m0-5v5h-5" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" strokeLinecap="round" /></svg> }
function ArrowIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function CloseIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" strokeLinecap="round" /></svg> }
function SaveIcon({ saved }: { saved: boolean }) { return <svg viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z" /></svg> }
function ReadIcon({ read }: { read: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{read ? <path d="m5 12 4 4L19 6" /> : <circle cx="12" cy="12" r="7" />}</svg> }
