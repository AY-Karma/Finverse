import { useEffect, useMemo, useRef, useState } from 'react'
import { buildMarketStories, type MarketStory } from '../marketStories'
import { selectRecapNews, type MarketBriefingStory } from '../marketBriefing'
import { storyEditions, type StoryEdition } from '../recapSchedule'
import { buildRecapStories } from '../recapStories'
import { holdingMoveToday } from '../holdingMarketMoves'
import { dateFormatter } from '../formatters'
import { useStore, type View } from '../useStore'
import { ActionIcon } from './ActionIcon'
import { StoryArtwork } from './StoryArtwork'
import { useStoryHistory } from './useStoryHistory'
import { useMarketBriefing } from './useMarketBriefing'
import { NewsArtwork } from './NewsArtwork'
import { RecapArtwork } from './RecapArtwork'
import { PersonalStoryVisual } from './PersonalStoryVisual'
import { WeeklyStoryVisual } from './WeeklyStoryVisual'
import { MarketStoryChart } from './MarketStoryChart'
import { SectorStoryVisual } from './SectorStoryVisual'
import { useMarketEvents } from '../useMarketEvents'
import type { PreparedHighlights } from './usePreparedHighlights'

const STORY_DURATION = 12_000
const MAX_RECAP_STORIES = 7
const NO_POSITIONS: ReturnType<typeof useStore>['positions'] = []
const TOPIC_LABELS = { policy: 'Policy', china: 'Stocks', global: 'Markets', india: 'Markets', commodities: 'Commodities', earnings: 'Earnings', economy: 'Economy' }
type ViewerStory = Omit<Pick<MarketStory, 'id' | 'kind' | 'eyebrow' | 'title' | 'metric' | 'metricLabel' | 'metricAmount' | 'tone' | 'rows' | 'chart' | 'marketChart' | 'insight' | 'weekly' | 'from' | 'through'>, 'kind'> & { kind: MarketStory['kind'] | 'news'; article?: MarketBriefingStory }

function newsStory(article: MarketBriefingStory, edition: StoryEdition): ViewerStory {
  const day = Number(dateFormatter({ day: 'numeric', timeZone: 'Asia/Kolkata' }).format(article.publishedAt))
  const week = edition.id === 'monthly' ? `Week ${Math.ceil(day / 7)} · ` : ''
  return { id: `news:${article.id}`, kind: 'news', eyebrow: `${week}${article.region} · ${TOPIC_LABELS[article.topic]}`, title: article.title, metric: '', metricLabel: '', tone: 'neutral', rows: [], article }
}

export function MarketStories({ today = holdingMoveToday(), editions: availableEditions, prepared, onClose, onComplete, onNavigate }: {
  today?: string
  editions?: StoryEdition[]
  prepared?: PreparedHighlights
  onClose: () => void
  onComplete: (editionKey?: string) => void
  onNavigate: (view: View) => void
}) {
  const { snapshot, positions, settings } = useStore()
  const editions = availableEditions ?? storyEditions(today)
  const [activeEdition, setActiveEdition] = useState('portfolio')
  const edition = editions.find((item) => item.id === activeEdition) ?? editions[0]
  const recap = edition.id === 'weekly' || edition.id === 'monthly'
  const newsEnabled = settings.allowExternalData && edition.id !== 'portfolio'
  const historyEnabled = settings.allowExternalData && !settings.hideValues && (recap || positions.length > 0)
  const localHistory = useStoryHistory(positions, !prepared && historyEnabled, today, edition)
  const localNews = useMarketBriefing(edition, settings.hideValues ? NO_POSITIONS : positions, !prepared && newsEnabled)
  const localEvents = useMarketEvents(positions, !prepared && settings.allowExternalData && edition.id === 'weekly', settings.hideValues)
  const { history, news, events } = prepared?.[edition.id] ?? { history: localHistory, news: localNews, events: localEvents }
  const ready = history.ready && news.ready && events.ready
  const stories = useMemo<ViewerStory[]>(() => {
    if (!ready) return []
    if (!recap) return settings.hideValues ? [] : buildMarketStories(snapshot, history.histories, edition.through, history.benchmarks)
    const recapData = buildRecapStories(snapshot, history.histories, edition, today, settings.hideValues, events.feed.events)
    if (recapData.length === 1 && recapData[0].kind === 'covered' && !news.items.length && (news.loading || news.failed)) return []
    const articles = selectRecapNews(news.items, { ...edition, cadence: edition.id === 'weekly' ? 'weekly' : 'monthly' }, Math.min(3, MAX_RECAP_STORIES - recapData.length))
    return [...articles.map((article) => newsStory(article, edition)), ...recapData]
  }, [ready, snapshot, history.histories, history.benchmarks, settings.hideValues, today, edition.key, edition.id, edition.from, edition.through, recap, news.items, news.loading, news.failed, events.feed.events])
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({})
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [held, setHeld] = useState(false)
  const [background, setBackground] = useState(document.hidden)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const gesture = useRef<{ x: number; y: number; at: number } | null>(null)
  const index = Math.max(0, stories.findIndex((item) => item.id === selectedIds[edition.key]))
  const story = stories[index]
  const personalStory = story && !story.article && story.kind !== 'market' && story.kind !== 'covered'
  const loading = !ready || history.loading || news.loading || events.loading
  const failed = history.failed || news.failed || events.feed.sourceFailed
  const stopped = paused || held || background || loading || !story
  const followingEdition = editions[editions.findIndex((item) => item.key === edition.key) + 1]

  const changeEdition = (id: string) => { setActiveEdition(id); setElapsed(0); setHeld(false) }
  const retry = () => { if (history.failed) history.retry(); if (news.failed) news.retry(); if (events.feed.sourceFailed) events.refresh() }

  const select = (next: number) => {
    if (next < 0) return
    if (next >= stories.length) {
      if (loading) return
      onComplete(edition.key)
      if (!followingEdition) { onClose(); return }
      setSelectedIds((current) => {
        const updated = { ...current }
        delete updated[followingEdition.key]
        return updated
      })
      changeEdition(followingEdition.id)
      return
    }
    setElapsed(0)
    setSelectedIds((current) => ({ ...current, [edition.key]: stories[next].id }))
    if (next === stories.length - 1 && !loading) onComplete(edition.key)
  }

  useEffect(() => {
    const dialog = dialogRef.current!
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setElapsed(0)
    dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('[aria-label="Close highlights"]')?.focus()
    const visibility = () => setBackground(document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      if (dialog.open) dialog.close()
      document.body.style.overflow = overflow
      document.removeEventListener('visibilitychange', visibility)
      if (focused?.isConnected) focused.focus()
    }
  }, [])

  useEffect(() => setElapsed(0), [story?.id])

  useEffect(() => {
    if (stopped) return
    const timer = window.setInterval(() => setElapsed((current) => Math.min(STORY_DURATION, current + 100)), 100)
    return () => window.clearInterval(timer)
  }, [stopped, story?.id])

  useEffect(() => {
    if (elapsed >= STORY_DURATION && !stopped) select(index + 1)
  }, [elapsed, stopped])

  const privatePortfolio = settings.hideValues && edition.id === 'portfolio'
  const empty = privatePortfolio ? 'Your highlights are private.'
    : loading ? 'Finding market stories…'
      : edition.id === 'portfolio' ? positions.length ? failed ? 'Some price history is unavailable.' : 'No standout story yet.' : 'Your story starts here.'
        : !settings.allowExternalData ? 'Market data is off.'
          : failed ? 'This edition is unavailable.' : 'No recap data available.'
  const emptyMessage = privatePortfolio ? 'Turn off privacy masking to view portfolio stories.'
    : loading ? 'Gathering this edition.'
      : edition.id === 'portfolio' ? positions.length ? failed ? 'Try loading the missing prices again.' : 'Stories appear when the period has enough price history.' : 'Import your holdings to see your portfolio and monthly market highlights.'
        : !settings.allowExternalData ? 'Enable external market data in Settings.'
          : failed ? 'Try loading this edition again.' : 'Stories appear when relevant coverage is available.'
  const headerDate = edition.from
  const featuredMetric = story?.kind === 'winners' || story?.kind === 'laggards' || story?.kind === 'market'
  const metric = story && !story.article && !story.insight && !story.weekly && story.kind !== 'sectors'
    ? <div className="story-metric">{story.metricLabel && <span title={story.metricLabel}>{story.metricLabel}</span>}{story.metric && <strong className={`story-tone--${story.tone}`}>{story.metric}</strong>}</div> : null
  return <dialog ref={dialogRef} className="market-stories" aria-label="Your portfolio and market highlights"
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    onKeyDown={(event) => {
      if (!story) {
        if (event.key === 'ArrowRight' && !loading && followingEdition) { event.preventDefault(); select(0) }
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); select(index + (event.key === 'ArrowRight' ? 1 : -1)) }
      if (event.code === 'Space' && event.target === event.currentTarget) { event.preventDefault(); setPaused((value) => !value) }
    }}>
    <div className={`story-frame story-frame--${story?.kind ?? 'empty'}`}>
      <div className="story-progress" aria-label="Highlights">
        {stories.map((item, i) => <button type="button" key={item.id} aria-label={`Highlight ${i + 1}: ${item.eyebrow}`} aria-current={i === index ? 'step' : undefined} onClick={() => select(i)}>
          <span style={{ width: `${i < index ? 100 : i === index ? elapsed / STORY_DURATION * 100 : 0}%` }} />
        </button>)}
      </div>
      <header className="story-header">
        <img src="/favicon.svg?v=2" width="27" height="27" alt="" />
        <div><strong>{recap ? `${story?.kind === 'covered' ? 'Recap' : personalStory ? 'Portfolio' : 'Markets'} · ${edition.label}` : 'Portfolio'}</strong><span>{edition.id === 'weekly' ? 'The completed trading week' : dateFormatter({ month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${headerDate}T00:00:00Z`))}</span></div>
        {failed && story && <button className="story-icon" type="button" aria-label="Retry highlights" title="Some stories or period prices are unavailable. Retry." onClick={retry}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg></button>}
        {story && <button className="story-icon" type="button" aria-label={paused ? 'Play highlights' : 'Pause highlights'} onClick={() => setPaused((value) => !value)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{paused ? <path d="m9 5 11 7-11 7V5Z" /> : <path d="M8 5v14M16 5v14" />}</svg>
        </button>}
        <button className="story-icon" type="button" aria-label="Close highlights" onClick={onClose}><ActionIcon name="close" /></button>
      </header>
      <div className="story-editions" role="tablist" aria-label="Highlight editions" onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault(); event.stopPropagation()
        const next = (editions.findIndex((item) => item.id === edition.id) + (event.key === 'ArrowRight' ? 1 : -1) + editions.length) % editions.length
        changeEdition(editions[next].id)
        event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
      }}>
        {editions.map((item) => <button key={item.id} id={`story-tab-${item.id}`} type="button" role="tab" aria-selected={edition.id === item.id} aria-controls="story-panel" tabIndex={edition.id === item.id ? 0 : -1} title={item.id === 'monthly' ? 'Previous month. Available throughout the first day of this month in India.' : item.id === 'weekly' ? 'Completed trading week. Available on Saturday and Sunday in India.' : undefined} onClick={() => changeEdition(item.id)}>{item.label}</button>)}
      </div>
      {story ? <section id="story-panel" role="tabpanel" aria-labelledby={`story-tab-${edition.id}`} className={`story-content${story.article ? ' story-content--news' : ''}`} aria-live="polite" aria-atomic="true" key={story.id}
          onFocusCapture={() => setHeld(true)} onBlurCapture={() => setHeld(false)}>
          <h2>{story.article ? <a href={story.article.sourceUrl} target="_blank" rel="noopener noreferrer">{story.title}</a> : story.title}</h2>
          {featuredMetric && metric}
          {story.article && <div className="story-news-meta"><span>{story.article.source}</span><time dateTime={new Date(story.article.publishedAt).toISOString()}>{dateFormatter({ day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(story.article.publishedAt)}</time>{story.article.coverage > 1 && <span>{story.article.coverage} publishers</span>}</div>}
          <div className="story-art-stage" onPointerDown={(event) => {
            if (event.target instanceof Element && event.target.closest('a, button, input, summary')) { gesture.current = null; return }
            gesture.current = { x: event.clientX, y: event.clientY, at: Date.now() }
            event.currentTarget.setPointerCapture?.(event.pointerId)
            setHeld(true)
          }} onPointerUp={(event) => {
            if (event.target instanceof Element && event.target.closest('a, button, input, summary')) return
            const start = gesture.current
            gesture.current = null
            setHeld(false)
            if (!start || Math.abs(event.clientY - start.y) > 60) return
            const distance = event.clientX - start.x
            if (Math.abs(distance) > 45) select(index + (distance < 0 ? 1 : -1))
            else if (Date.now() - start.at < 250) {
              const bounds = event.currentTarget.getBoundingClientRect()
              select(index + (event.clientX < bounds.left + bounds.width * .35 ? -1 : 1))
            }
          }} onPointerCancel={() => { gesture.current = null; setHeld(false) }}>
            {story.kind === 'market' ? <MarketStoryChart points={story.marketChart} label={story.metricLabel} /> : story.kind === 'sectors' ? <SectorStoryVisual story={story} /> : story.weekly ? <WeeklyStoryVisual content={story.weekly} /> : story.insight ? <PersonalStoryVisual insight={story.insight} from={story.from} through={story.through} /> : story.article ? <NewsArtwork topic={story.article.topic} /> : story.kind === 'winners' || story.kind === 'laggards' || story.kind === 'updates' || story.kind === 'covered'
              ? <RecapArtwork kind={story.kind} points={story.chart} /> : <StoryArtwork />}
          </div>
          {!featuredMetric && metric}
          {!story.insight && !story.weekly && story.kind !== 'sectors' && !!story.rows.length && <ul className="story-rows">
            {story.rows.map((row, index) => <li key={`${row.label}:${index}`}>
              {story.kind === 'updates' ? <>
                <div className="story-update-identity"><span title={row.label}>{row.label}</span><span className={`story-update-action story-tone--${row.tone}`}>{row.value === 'Quantity updated' ? 'Qty updated' : row.value}</span></div>
                {row.detail && <strong className={`story-tone--${row.tone}`}>{row.detail}</strong>}
              </> : <><span title={row.label}>{row.label}</span><strong className={`story-tone--${row.tone}`}>{row.value}{row.detail && <small>{row.detail}</small>}</strong></>}
              {story.kind !== 'updates' && <span className={`story-row-bar story-tone--${row.tone}`} aria-hidden="true"><i style={{ width: `${Math.max(1, Math.abs(row.amount) / Math.max(...story.rows.map((item) => Math.abs(item.amount)), 1) * 100)}%` }} /></span>}
            </li>)}
          </ul>}
        </section> : <section id="story-panel" role="tabpanel" aria-labelledby={`story-tab-${edition.id}`} className="story-empty" aria-busy={loading}>
        <ActionIcon name={privatePortfolio ? 'privacy' : 'insights'} />
        <h2>{empty}</h2><p role="status">{emptyMessage}</p>
        {!privatePortfolio && !loading && (edition.id === 'portfolio' && positions.length > 0 && followingEdition ? <div className="story-empty-actions">
          <button className="story-action" type="button" onClick={() => select(0)}>Continue to {followingEdition.label} <span aria-hidden="true">→</span></button>
          {failed && <button className="story-action" type="button" onClick={retry}>Retry</button>}
        </div>
          : failed ? <button className="story-action" type="button" onClick={retry}>Retry</button>
            : !settings.allowExternalData && positions.length > 0 ? <button className="story-action" type="button" onClick={() => onNavigate('settings')}>Open Settings <span aria-hidden="true">↗</span></button>
              : edition.id === 'portfolio' && !positions.length ? <button className="story-action" type="button" onClick={() => onNavigate('overview')}>Open portfolio <span aria-hidden="true">↗</span></button> : null)}
      </section>}
    </div>
  </dialog>
}
