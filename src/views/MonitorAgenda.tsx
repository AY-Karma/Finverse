import { useState } from 'react'
import { dateFormatter } from '../formatters'
import type { MarketEvent, MarketEventsFeed } from '../marketEvents'
import type { MonitorController } from '../useMonitor'
import { ReminderAction } from './monitorPanels'
import { ActionIcon } from './ActionIcon'

const shortDate = dateFormatter({ day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
const dateText = (date: string) => shortDate.format(new Date(`${date}T12:00:00Z`))
const monthText = dateFormatter({ month: 'short', timeZone: 'Asia/Kolkata' })
const fullDate = dateFormatter({ day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
const eventLabels = { results: 'Results', meeting: 'Meeting', dividend: 'Dividend', 'corporate-action': 'Corporate action', filing: 'Filing' }

function CalendarDate({ date }: { date: string }) {
  const value = new Date(`${date}T12:00:00Z`)
  return <time className="mp-calendar-date" dateTime={date} aria-label={fullDate.format(value)}><span>{monthText.format(value)}</span><strong>{Number(date.slice(8, 10))}</strong></time>
}
type Props = { controller: MonitorController; feed: MarketEventsFeed; loading: boolean; onRemind: (event: MarketEvent) => void; onOpenHolding: (holdingId: string) => void; onRetry: () => void; reminderRequest?: { holdingId?: string; title?: string; date?: string; revision: number } }

export function MonitorAgenda({ controller, feed, loading, onRemind, onOpenHolding, onRetry, reminderRequest }: Props) {
  const [count, setCount] = useState(4)
  const [reminderCount, setReminderCount] = useState(3)
  const today = new Date(controller.now + 19_800_000).toISOString().slice(0, 10)
  const upcoming = feed.events.filter((event) => event.kind !== 'filing' && event.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const reminders = controller.events.filter((event) => event.reminder)
  const inactive = controller.events.filter((event) => !event.reminder)
  return <section className="mp-panel pa-reminders mp-agenda" aria-labelledby="monitor-upcoming-heading">
    <header className="mp-section-head mp-feature-head"><div className="mp-feature-title"><span className="mp-heading-mark" aria-hidden="true"><ActionIcon name="calendar" /></span><h2 id="monitor-upcoming-heading">Upcoming</h2></div><ReminderAction controller={controller} request={reminderRequest} /></header>
    {controller.hideValues ? <p className="mp-section-note">Company events are hidden.</p> : <>
      {loading && !feed.fetchedAt && <p className="mp-section-note" role="status">Checking announced events…</p>}
      {upcoming.length > 0 && <div className="mp-agenda-list">{upcoming.slice(0, count).map((event) => <div className="mp-agenda-event mp-agenda-event--official" data-kind={event.kind} key={event.id}>
        <CalendarDate date={event.date} />
        <div className="mp-event-body"><div className="mp-event-identity"><button type="button" className="mp-company-link" onClick={() => onOpenHolding(event.holdingId)}>{event.holdingName}</button><span className="mp-event-kind">{eventLabels[event.kind]}</span></div><a className="mp-event-title" href={event.sourceUrl} target="_blank" rel="noreferrer">{event.title}</a><span className="mp-event-source">{event.dateLabel} · {event.source}</span>
          <button type="button" className="mp-small-action mp-event-remind" aria-label={`Remind me: ${event.holdingName} ${event.title}`} onClick={() => onRemind(event)}><ActionIcon name="bell" /><span>Remind me</span></button>
        </div>
      </div>)}</div>}
      {upcoming.length > count && <button type="button" className="mp-section-more" onClick={() => setCount((value) => value + 6)}>Show more events <span aria-hidden="true">↓</span></button>}
      {!loading && !upcoming.length && !feed.issues.length && <p className="mp-section-note">{controller.allowExternalData ? 'No announced NSE events in the next 90 days.' : 'Enable market data to see announced events.'}</p>}
      {feed.issues.length > 0 && <details className="mp-source-issues"><summary>Event coverage {feed.events.length > 0 ? 'is partial' : 'unavailable'}</summary>{feed.issues.map((issue) => <p key={`${issue.source}:${issue.message}`}>{issue.source !== 'Company events' && <strong>{issue.source}: </strong>}{issue.message}</p>)}<p>Holdings stay in your portfolio. Only announced events appear here.</p><button type="button" className="mp-small-action" disabled={loading} onClick={onRetry}>Retry</button></details>}
    </>}
    {reminders.length > 0 && <div className="mp-personal-reminders"><h3>Personal reminders</h3>{reminders.slice(0, reminderCount).map((event) => <div className="mp-agenda-event" key={event.id}><div className="mp-reminder-date"><time dateTime={event.date}>{dateText(event.date)}</time>{event.date <= today && <span>{event.date === today ? 'Today' : 'Overdue'}</span>}</div><div><strong>{event.title}</strong><span>{event.holding}</span></div><button className="mp-small-action" type="button" aria-label={`Turn off reminder: ${event.title}`} onClick={() => controller.toggleReminder(event.id)}>Turn off</button></div>)}{reminders.length > reminderCount && <button className="mp-show-more" type="button" onClick={() => setReminderCount((value) => value + 6)}>Show more reminders</button>}</div>}
    {inactive.length > 0 && <details className="pa-inactive-reminders"><summary>Inactive reminders</summary>{inactive.map((event) => <div className="mp-agenda-event" key={event.id}><div><strong>{event.title}</strong><span>{event.holding} · {dateText(event.date)}</span></div><button type="button" className="mp-small-action" onClick={() => controller.toggleReminder(event.id)}>Restore</button></div>)}</details>}
  </section>
}

export function MonitorDevelopments({ events, onOpenHolding }: { events: MarketEvent[]; onOpenHolding: (holdingId: string) => void }) {
  const filings = events.filter((event) => event.kind === 'filing').sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  if (!filings.length) return null
  return <section className="mp-panel mp-developments" aria-labelledby="monitor-developments-heading"><header className="mp-section-head mp-feature-head"><div className="mp-feature-title"><span className="mp-heading-mark" aria-hidden="true"><ActionIcon name="sources" /></span><h2 id="monitor-developments-heading">Company updates</h2></div><span className="mp-kicker">Exchange filings</span></header>
    <div className="mp-updates-scroll" role="region" aria-label="Company updates feed" tabIndex={0}>
      {filings.map((event) => <article key={event.id}><span className="mp-filing-document" aria-hidden="true"><ActionIcon name="sources" /></span><div className="mp-filing-meta"><button className="mp-company-link" type="button" onClick={() => onOpenHolding(event.holdingId)}>{event.holdingName}</button><span>{event.source} · <time dateTime={event.date}>{dateText(event.date)}</time></span></div><a className="mp-filing-link" href={event.sourceUrl} target="_blank" rel="noreferrer"><span>{event.title}</span><span className="mp-filing-open" aria-hidden="true"><ActionIcon name="external" /></span></a></article>)}
    </div>
  </section>
}
