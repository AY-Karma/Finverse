import { useState } from 'react'
import { SkeletonRows } from './SkeletonRows'
import { dateFormatter } from '../formatters'
import type { MarketEvent, MarketEventsFeed } from '../marketEvents'
import type { MonitorController } from '../useMonitor'
import { ActionIcon } from './ActionIcon'
import { NotifyToggle } from './NotifyToggle'

const shortDate = dateFormatter({ day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
const dateText = (date: string) => shortDate.format(new Date(`${date}T12:00:00Z`))
const monthText = dateFormatter({ month: 'short', timeZone: 'Asia/Kolkata' })
const fullDate = dateFormatter({ day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
const FILING_SOURCES = new Set(['NSE filings', 'NSE issuer reference'])
const OUT_OF_SCOPE = /^(Mutual fund notices|Asset type not covered|\S+ listings are not covered)/
const eventLabels = { results: 'Results', meeting: 'Meeting', dividend: 'Dividend', 'corporate-action': 'Corporate action', filing: 'Filing' }

function CalendarDate({ date }: { date: string }) {
  const value = new Date(`${date}T12:00:00Z`)
  return <time className="mp-calendar-date" dateTime={date} aria-label={fullDate.format(value)}><span>{monthText.format(value)}</span><strong>{Number(date.slice(8, 10))}</strong></time>
}

type Props = {
  controller: MonitorController; feed: MarketEventsFeed; loading: boolean; pending: boolean
  onRemind: (event: MarketEvent) => void; onOpenHolding: (holdingId: string) => void; onRetry: () => void
}

/** Announced events and exchange filings for owned NSE listings, with the user's own reminders. */
export function CompanyUpdates({ controller, feed, loading, pending, onRemind, onOpenHolding, onRetry }: Props) {
  const [count, setCount] = useState(4)
  const [reminderCount, setReminderCount] = useState(3)
  const today = new Date(controller.now + 19_800_000).toISOString().slice(0, 10)
  const coverage = feed.issues.filter((issue) => issue.source === 'Company events')
  const partialCoverage = coverage.some((issue) => OUT_OF_SCOPE.test(issue.message))
  const attention = coverage.filter((issue) => !OUT_OF_SCOPE.test(issue.message))
  const filingNotes = feed.issues.filter((issue) => FILING_SOURCES.has(issue.source))
  const failures = feed.issues.filter((issue) => issue.source !== 'Company events' && !FILING_SOURCES.has(issue.source))
  const upcoming = feed.events.filter((event) => event.kind !== 'filing' && event.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const filings = feed.events.filter((event) => event.kind === 'filing').sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  const reminders = controller.events.filter((event) => event.reminder)
  const inactive = controller.events.filter((event) => !event.reminder)
  const hidden = controller.hideValues

  return <div className="mc-company">
    {hidden ? <p className="mp-section-note">Company updates are hidden.</p>
      : !controller.allowExternalData ? <p className="mp-section-note">Market data is paused. Reload this tab to see company updates.</p>
      : pending ? <SkeletonRows rows={4} label="Loading company updates" className="mc-skeleton" /> : <>
        {upcoming.length > 0 && <div className="mc-group">
          <h3 className="mc-group-label">Upcoming</h3>
          <div className="mp-agenda-list">{upcoming.slice(0, count).map((event) => <div className="mp-agenda-event mp-agenda-event--official" data-kind={event.kind} key={event.id}>
            <CalendarDate date={event.date} />
            <div className="mp-event-body"><div className="mp-event-identity"><button type="button" className="mp-company-link" onClick={() => onOpenHolding(event.holdingId)}>{event.holdingName}</button><span className="mp-event-kind">{eventLabels[event.kind]}</span></div><a className="mp-event-title" href={event.sourceUrl} target="_blank" rel="noreferrer">{event.title}</a><span className="mp-event-source">{event.dateLabel} · {event.source}</span>
              <button type="button" className="mp-small-action mp-event-remind" aria-label={`Remind me: ${event.holdingName} ${event.title}`} onClick={() => onRemind(event)}><ActionIcon name="bell" /><span>Remind me</span></button>
            </div>
          </div>)}</div>
          {upcoming.length > count && <button type="button" className="mp-section-more" onClick={() => setCount((value) => value + 6)}>Show more events <span aria-hidden="true">↓</span></button>}
        </div>}
        {filings.length > 0 && <div className="mc-group">
          <h3 className="mc-group-label">Filings</h3>
          <div className="mp-updates-scroll" role="region" aria-label="Company filings" tabIndex={0}>
            {filings.map((event) => <article key={event.id}><div className="mp-filing-meta"><button className="mp-company-link" type="button" onClick={() => onOpenHolding(event.holdingId)}>{event.holdingName}</button><span className="mp-filing-when"><NotifyToggle on={controller.follows.companies.some((company) => company.identity === event.instrumentIdentity)} disabled={controller.readOnly}
              label={`Notify me about new ${event.holdingName} filings`} onToggle={() => controller.toggleCompanyFollow({ identity: event.instrumentIdentity, name: event.holdingName })} />{event.source} · <time dateTime={event.date}>{dateText(event.date)}</time></span></div><a className="mp-filing-link" href={event.sourceUrl} target="_blank" rel="noreferrer"><span>{event.title}</span><span className="mp-filing-open" aria-hidden="true"><ActionIcon name="external" /></span></a></article>)}
          </div>
        </div>}
        {!upcoming.length && !filings.length && !failures.length && <p className="mp-section-note">No announced events or recent filings for your NSE holdings.</p>}
        {filingNotes.length > 0 && <p className="mp-section-note">{filingNotes.map((issue) => issue.message).join(' ')}</p>}
        {failures.length > 0 && <details className="mp-source-issues"><summary>{upcoming.length || filings.length ? 'Some company sources are unavailable' : 'Company sources unavailable'}</summary>{failures.map((issue) => <p key={`${issue.source}:${issue.message}`}><strong>{issue.source}: </strong>{issue.message}</p>)}<button type="button" className="mp-small-action" disabled={loading} onClick={onRetry}>Retry</button></details>}
        {attention.length > 0 && <details className="mp-source-issues"><summary>Some holdings need attention</summary>{attention.map((issue) => <p key={issue.message}>{issue.message}</p>)}</details>}
        {partialCoverage && <p className="mp-coverage-line">Covers NSE-listed stocks and ETFs. Funds and other listings are not included.</p>}
      </>}
    {reminders.length > 0 && <div className="mc-group mp-personal-reminders"><h3 className="mc-group-label">Your reminders</h3>{reminders.slice(0, reminderCount).map((event) => <div className="mp-agenda-event" key={event.id}><div className="mp-reminder-date"><time dateTime={event.date}>{dateText(event.date)}</time>{event.date <= today && <span>{event.date === today ? 'Today' : 'Overdue'}</span>}</div><div><strong>{event.title}</strong><span>{event.holding}</span></div><button className="mp-small-action" type="button" aria-label={`Turn off reminder: ${event.title}`} onClick={() => controller.toggleReminder(event.id)}>Turn off</button></div>)}{reminders.length > reminderCount && <button className="mp-show-more" type="button" onClick={() => setReminderCount((value) => value + 6)}>Show more reminders</button>}</div>}
    {inactive.length > 0 && <details className="pa-inactive-reminders"><summary>Inactive reminders</summary>{inactive.map((event) => <div className="mp-agenda-event" key={event.id}><div><strong>{event.title}</strong><span>{event.holding} · {dateText(event.date)}</span></div><div className="mp-reminder-actions"><button type="button" className="mp-small-action" onClick={() => controller.toggleReminder(event.id)}>Restore</button><button type="button" className="mp-small-action mp-reminder-delete" aria-label={`Delete inactive reminder: ${event.title}`} onClick={() => controller.deleteInactiveReminder(event.id)}>Delete</button></div></div>)}</details>}
  </div>
}
