import { Activity, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useStore, type View } from '../useStore'
import { holdingMoveToday } from '../holdingMarketMoves'
import { storyEditions } from '../recapSchedule'
import { usePreparedHighlights } from './usePreparedHighlights'
import './marketStories.css'

const loadMarketStories = () => import('./MarketStories').then((module) => ({ default: module.MarketStories }))
const MarketStories = lazy(loadMarketStories)
const SEEN_KEY = 'finverse:highlights-seen:v2'

export function MarketStoriesEntry({ navigate, children }: { navigate: (view: View) => void; children?: (entry: ReactNode) => ReactNode }) {
  const { settings, positions } = useStore()
  const hasPortfolio = positions.length > 0
  const [open, setOpen] = useState(false)
  const [visited, setVisited] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [today, setToday] = useState(holdingMoveToday)
  const prepared = usePreparedHighlights(today, preparing)
  const [seenEditions, setSeenEditions] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null')
      if (Array.isArray(saved)) return saved.filter((key): key is string => typeof key === 'string').slice(-48)
      const legacy = localStorage.getItem('finverse:highlights-seen:v1')
      return legacy ? [`portfolio:${legacy.slice(0, 7)}`] : []
    } catch { return [] }
  })
  const editions = storyEditions(today).filter((item) => settings.allowExternalData || item.id === 'portfolio')
  const seen = editions.every((item) => seenEditions.includes(item.key))
  useEffect(() => {
    if (!hasPortfolio) { setOpen(false); setVisited(false); setPreparing(false) }
  }, [hasPortfolio])
  useEffect(() => {
    const midnight = new Date(`${today}T00:00:00+05:30`).getTime() + 86_400_000
    const timer = window.setTimeout(() => setToday(holdingMoveToday()), Math.max(1000, midnight - Date.now()))
    return () => window.clearTimeout(timer)
  }, [today])
  const complete = (key = `portfolio:${today.slice(0, 7)}`) => {
    setSeenEditions((current) => {
      const next = [...current.filter((item) => item !== key), key].slice(-48)
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)) } catch { /* The viewer also works without storage. */ }
      return next
    })
  }

  const prepare = () => { setPreparing(true); void loadMarketStories().catch(() => {}) }
  const entry = hasPortfolio ? <button className={`stories-entry${seen ? ' stories-entry--seen' : ''}`} type="button"
      aria-label="Open your portfolio and market highlights" aria-haspopup="dialog" aria-expanded={open}
      title="Your highlights" onPointerEnter={prepare} onFocus={prepare} onTouchStart={prepare}
      onClick={() => { prepare(); setVisited(true); setOpen((current) => !current) }}>
      <span className="stories-avatar" aria-hidden="true"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="16" rx="3" /><path d="m9 15 3-4 3 2M9 8h6M2 8v8m20-8v8" /></svg></span></span>
      <span className="stories-entry-copy"><strong>Your highlights</strong><small>Portfolio &amp; market</small></span>
      {!seen && <span className="stories-entry-dot" aria-label="Unread highlights" />}
    </button> : null

  return <>
    {children ? children(entry) : entry}
    {hasPortfolio && visited && <Activity mode={open ? 'visible' : 'hidden'}><Suspense fallback={<span className="stories-loading" role="status">Opening highlights…</span>}>
      <MarketStories today={today} prepared={prepared} onClose={() => setOpen(false)} onComplete={complete} onNavigate={(view) => { setOpen(false); navigate(view) }} />
    </Suspense></Activity>}
  </>
}
