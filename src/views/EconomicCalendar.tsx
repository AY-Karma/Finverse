import { useEffect, useState } from 'react'
import { isEconomicEvent, upcomingEconomicEvents, type EconomicEvent } from '../economicCalendarProtocol'
import { SkeletonRows } from './SkeletonRows'
import { NotifyToggle } from './NotifyToggle'

type Feed = { events: EconomicEvent[]; failed: boolean }

const CACHE_MS = 30 * 60_000
let cached: { at: number; feed: Feed } | null = null

async function loadGlobalEvents(signal: AbortSignal): Promise<Feed> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.feed
  try {
    const response = await fetch('/api/economicCalendar', { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) })
    if (!response.ok) throw new Error('Economic calendar unavailable.')
    const payload = await response.json() as { events?: unknown }
    if (!Array.isArray(payload.events)) throw new Error('Invalid economic calendar.')
    const feed = { events: payload.events.filter(isEconomicEvent), failed: false }
    cached = { at: Date.now(), feed }
    return feed
  } catch {
    signal.throwIfAborted()
    return { events: [], failed: true }
  }
}

/** Global events load once per half hour; the official India and Fed schedule needs no request. */
export function useGlobalEvents(allowed: boolean): Feed | null {
  const [feed, setFeed] = useState<Feed | null>(() => cached && Date.now() - cached.at < CACHE_MS ? cached.feed : null)
  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    void loadGlobalEvents(controller.signal).then(setFeed, () => {})
    return () => controller.abort()
  }, [allowed])
  return allowed ? feed : { events: [], failed: true }
}

const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const dayLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
const istDate = (instant: number) => new Date(instant + 19_800_000).toISOString().slice(0, 10)
const REGION_NAMES = { IN: 'India', US: 'United States', EU: 'Euro area', GB: 'United Kingdom', JP: 'Japan', CN: 'China' } as const

function groupLabel(date: string, now: number): string {
  if (date === istDate(now)) return 'Today'
  if (date === istDate(now + 86_400_000)) return 'Tomorrow'
  return dayLabel.format(new Date(`${date}T06:30:00Z`))
}

/** The week's high-impact global releases plus officially scheduled RBI, MoSPI and Fed events, grouped by IST day. */
export function EconomicCalendar({ allowed, now, followedDays, onToggleDay, readOnly = false }: { allowed: boolean; now: number; followedDays: string[]; onToggleDay: (day: string) => void; readOnly?: boolean }) {
  const feed = useGlobalEvents(allowed)
  if (!feed) return <SkeletonRows rows={4} label="Loading economic calendar" className="mc-skeleton" />
  const events = upcomingEconomicEvents(feed.events, now)
  const days = [...new Map(events.map((event) => [istDate(Date.parse(event.at)), [] as EconomicEvent[]])).entries()]
  for (const event of events) days.find(([date]) => date === istDate(Date.parse(event.at)))![1].push(event)
  return <div className="mc-econ">
    {feed.failed && <p className="mc-note" role="status">Global releases are unavailable right now. Scheduled RBI, MoSPI and Fed events are shown.</p>}
    {days.length ? <div className="mc-list" role="region" aria-label="Economic calendar" tabIndex={0}>
      {days.map(([date, items]) => <div className="mc-group" key={date}>
        <h3 className="mc-group-label">{groupLabel(date, now)}<NotifyToggle on={followedDays.includes(date)} disabled={readOnly} label={`Notify me about ${groupLabel(date, now).toLowerCase() === 'today' ? "today's" : `${groupLabel(date, now)}`} events`} onToggle={() => onToggleDay(date)} /></h3>
        {items.map((event) => <article className="mc-row" key={event.id}>
          <span className="mc-when">{event.allDay ? 'All day' : time.format(Date.parse(event.at))}</span>
          <span className="mc-region" title={REGION_NAMES[event.region]}>{event.region}</span>
          <a className="mc-title" href={event.sourceUrl} target="_blank" rel="noreferrer" title={`Source: ${event.source}`}>{event.title}</a>
          {(event.forecast || event.previous) && <span className="mc-figures">{event.forecast && <span>Fcst <strong>{event.forecast}</strong></span>}{event.previous && <span>Prev <strong>{event.previous}</strong></span>}</span>}
        </article>)}
      </div>)}
    </div> : <p className="mc-empty">No major scheduled events in the next few weeks.</p>}
    <p className="mc-source">Times in IST · Dates may change</p>
  </div>
}
