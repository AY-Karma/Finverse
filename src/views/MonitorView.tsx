import { useState } from 'react'
import { assetTypeLabel } from '../instruments'
import { monogramTile } from '../logos'
import { useMonitor, type MonitorController } from '../useMonitor'
import { useStore } from '../useStore'
import { MonitorNewsPanel } from './MonitorNewsPanel'
import { ReminderAction, RulesPanel } from './monitorPanels'
import { PortfolioRequiredState } from './PortfolioRequiredState'
import './monitor.css'

type IconName = 'up' | 'down' | 'bank' | 'fund' | 'portfolio' | 'notice' | 'results' | 'dividend' | 'bell' | 'check' | 'clock' | 'refresh' | 'calendar' | 'source'
const iconPaths: Record<IconName, string> = {
  up: 'M3 17l6-6 4 4 8-10M15 5h6v6',
  down: 'M3 7l6 6 4-4 8 10M15 19h6v-6',
  bank: 'M3 9l9-6 9 6H3M5 9v10m5-10v10m4-10v10m5-10v10M3 21h18',
  fund: 'M4 20V10m5 10V6m6 14V12m5 8V3M2 21h20',
  portfolio: 'M8 7V4h8v3M3 7h18v14H3V7m0 6h18m-11 0v3h4v-3',
  notice: 'M7 3h8l4 4v14H5V3h2m8 0v5h4M9 12h6m-6 4h6',
  results: 'M4 20V4h16v16H4m4-4v-4m4 4V8m4 8v-6',
  dividend: 'M12 3v18m4-14h-6a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8',
  bell: 'M6 17h12l-2-3V9a4 4 0 0 0-8 0v5l-2 3m4 3a2 2 0 0 0 4 0',
  check: 'M5 12l4 4L19 6',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  refresh: 'M20 7a9 9 0 1 0 1 9M20 3v5h-5',
  calendar: 'M4 5h16v16H4V5m4-3v6m8-6v6M4 10h16m-12 4h2m4 0h2m-8 3h2',
  source: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2m3 6a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="mp-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={iconPaths[name]} />
    </svg>
  )
}

function HoldingIdentity({ holding, holdingId }: { holding: string; holdingId?: string }) {
  const { positions, settings } = useStore()
  const position = positions.find((item) => item.id === holdingId)
  const isFund = position?.type === 'mutual-fund'
  const initials = isFund || !position
    ? holding.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()
    : position.ticker.toUpperCase().slice(0, 3)
  const identity = position
    ? `${isFund ? position.amc || 'Fund' : position.ticker} · ${assetTypeLabel(position.type)}`
    : holdingId ? 'Holding history' : 'Personal reminder'
  return (
    <>
      <span className="mp-holding-tile" data-brand={isFund ? 'fund' : 'portfolio'} aria-hidden="true">
        <img src={monogramTile(position?.instrumentKey || holdingId || holding, initials, settings.mode)} width="44" height="44" alt="" />
        <span className="mp-holding-symbol"><Icon name={isFund ? 'fund' : position ? 'results' : 'portfolio'} /></span>
      </span>
      <div className="mp-item-identity"><strong>{holding}</strong><span>{identity}</span></div>
    </>
  )
}

function eventDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

function daysAhead(date: string): number {
  const now = new Date()
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12)) / 86400000)
}

function countdownLabel(date: string): string {
  const days = daysAhead(date)
  if (days === 0) return 'Today'
  const count = Math.abs(days)
  return days < 0 ? `${count} ${count === 1 ? 'day' : 'days'} ago` : `In ${count} ${count === 1 ? 'day' : 'days'}`
}

function dateKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function activityDate(date: string): string {
  if (date === dateKey(Date.now())) return 'Today'
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return date === dateKey(yesterday.getTime()) ? 'Yesterday' : eventDate(date)
}

function MonitorTimeline({ controller, initialQuery }: { controller: MonitorController; initialQuery: string }) {
  const [filter, setFilter] = useState<'all' | 'open' | 'history'>('all')
  const [visibleCount, setVisibleCount] = useState(12)
  const dates = [...new Set(controller.events.map((event) => event.date))].sort()
  const alerts = controller.alerts.filter((alert) => filter === 'all' || (filter === 'open' ? alert.state === 'open' : alert.state !== 'open'))
  const activity = [...alerts, ...(filter === 'all' ? controller.quoteRecords : [])].sort((a, b) => b.at - a.at)
  const visibleActivity = activity.slice(0, visibleCount)
  const activityDates = [...new Set(visibleActivity.map((item) => dateKey(item.at)))].sort().reverse()
  const selectFilter = (next: typeof filter) => { setFilter(next); setVisibleCount(12) }
  return (
    <div className="mp-timeline-layout">
      <section className="mp-timeline" aria-labelledby="mp-timeline-title">
        <div className="mp-section-head">
          <div><p className="mp-kicker">Activity & reminders</p><h2 id="mp-timeline-title">Portfolio timeline</h2></div>
          <ReminderAction controller={controller} />
        </div>
        <div className="mp-timeline-tabs" aria-label="Timeline activity">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => selectFilter('all')}>All activity <span>{controller.alerts.length + controller.quoteRecords.length}</span></button>
          <button type="button" aria-pressed={filter === 'open'} onClick={() => selectFilter('open')}>To review <span>{controller.counts.open}</span></button>
          <button type="button" aria-pressed={filter === 'history'} onClick={() => selectFilter('history')}>History <span>{controller.counts.reviewed + controller.counts.snoozed}</span></button>
        </div>
        {activityDates.map((date) => <div className="mp-timeline-group" key={date}>
          <div className="mp-timeline-date"><span className="mp-timeline-dot" /><strong>{activityDate(date)}</strong><span>Portfolio activity</span></div>
          <div className="mp-timeline-items">
            {visibleActivity.filter((item) => dateKey(item.at) === date).map((alert) => {
              const isQuote = alert.kind === 'quote'
              const state = isQuote ? undefined : alert.state
              const trend = alert.metrics?.find((metric) => metric.trend === 'up' || metric.trend === 'down')?.trend
              const tone = trend ?? 'neutral'
              return (
                <article className={`mp-timeline-item mp-timeline-item--${state ?? 'quote'}`} data-tone={tone} key={alert.id}>
                  <div className="mp-item-header">
                    <HoldingIdentity holding={alert.holding} holdingId={alert.holdingId} />
                    {state && <span className="mp-badge" data-state={state}>
                      <Icon name={state === 'reviewed' ? 'check' : state === 'snoozed' ? 'clock' : 'bell'} />
                      {state === 'open' ? 'To review' : state === 'reviewed' ? 'Reviewed' : 'Snoozed'}
                    </span>}
                  </div>
                  <div className="mp-item-category" data-tone={tone}>
                    <Icon name={trend === 'down' ? 'down' : trend === 'up' ? 'up' : 'clock'} />
                    <strong>{isQuote ? 'Latest price / NAV' : 'Watch rule triggered'}</strong>
                    <time dateTime={new Date(alert.at).toISOString()}>{alert.time}</time>
                  </div>
                  <h3>{alert.title}</h3>
                  {isQuote && <p className="mp-timeline-reason">{alert.reason}</p>}
                  {alert.metrics && (
                    <dl className="mp-metrics">
                      {alert.metrics.map((metric) => (
                        <div className="mp-metric" data-trend={metric.trend ?? 'neutral'} key={metric.label}>
                          <dt>{metric.label}</dt>
                          <dd>{(metric.trend === 'up' || metric.trend === 'down') && <Icon name={metric.trend} />}{metric.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <div className="mp-item-bottom">
                    <details className="mp-source-details"><summary><Icon name="source" />{isQuote ? 'Source & timestamp' : 'Rule evidence'}</summary><p>{alert.evidence}</p></details>
                    {!isQuote && <div className="mp-actions">
                      {state === 'open' ? (
                        <>
                          <button type="button" className="mp-button mp-button--small" onClick={() => controller.setAlertState(alert.id, 'reviewed')}><Icon name="check" />Mark reviewed</button>
                          <button type="button" className="mp-text-button" onClick={() => controller.setAlertState(alert.id, 'snoozed')}><Icon name="clock" />Snooze</button>
                        </>
                      ) : <button type="button" className="mp-text-button" onClick={() => controller.setAlertState(alert.id, 'open')}>Reopen item</button>}
                    </div>}
                  </div>
                </article>
              )
            })}
          </div>
        </div>)}
        {visibleActivity.length < activity.length && <button className="mp-button" type="button" onClick={() => setVisibleCount((count) => count + 12)}>Show more activity · {activity.length - visibleActivity.length} remaining</button>}
        {activity.length === 0 && <div className="mp-empty mp-timeline-empty"><Icon name={filter === 'open' ? 'check' : 'clock'} /><h3>{filter === 'open' ? 'No items to review' : filter === 'history' ? 'No history yet' : 'Your timeline is ready'}</h3><p>{filter === 'open' ? 'A matching watch rule will appear here after prices refresh.' : filter === 'history' ? 'Reviewed and snoozed items will appear here.' : 'Create a watch rule or a personal reminder. Available price updates will appear here.'}</p></div>}
        {dates.map((date) => (
          <div className="mp-timeline-group" key={date}>
            <div className="mp-timeline-date"><span className="mp-timeline-dot mp-timeline-dot--future" /><strong>{eventDate(date)}</strong><span>{daysAhead(date) < 0 ? 'Past reminder' : daysAhead(date) === 0 ? 'Today’s reminders' : 'Upcoming'}</span></div>
            <div className="mp-timeline-items">
              {controller.events.filter((event) => event.date === date).map((event) => {
                return (
                  <article className="mp-timeline-item mp-timeline-item--event" data-tone="reminder" key={event.id}>
                    <div className="mp-item-header">
                      <HoldingIdentity holding={event.holding} holdingId={event.holdingId} />
                      <button type="button" className={`mp-event-reminder ${event.reminder ? 'mp-is-selected' : ''}`} aria-pressed={event.reminder} aria-label={`${event.reminder ? 'Remove reminder for' : 'Set reminder for'} ${event.title}`} onClick={() => controller.toggleReminder(event.id)}>
                        <Icon name={event.reminder ? 'check' : 'bell'} /><span>{event.reminder ? 'Reminder on' : 'Remind me'}</span>
                      </button>
                    </div>
                    <div className="mp-event-details">
                      <span className="mp-item-category" data-tone="reminder"><Icon name="bell" />Personal reminder</span>
                      <span className="mp-event-countdown">{countdownLabel(event.date)}</span>
                    </div>
                    <h3>{event.title}</h3>
                  </article>
                )
              })}
            </div>
          </div>
        ))}
        <p className="mp-data-note">Reminders appear here when you open Monitor.</p>
      </section>
      <aside className="mp-timeline-sidebar" aria-label="Watch rules and news">
        <div className="mp-panel"><RulesPanel controller={controller} /></div>
        <MonitorNewsPanel initialQuery={initialQuery} />
      </aside>
    </div>
  )
}

export function MonitorView({ onRequestImport, initialQuery = '' }: { onRequestImport: () => void; initialQuery?: string }) {
  const controller = useMonitor()
  if (controller.positions.length === 0) {
    return <PortfolioRequiredState area="02 · Monitor" description="Bring in your holdings to follow price updates, create watch rules, and read portfolio news." onImport={onRequestImport} />
  }

  return (
    <div className="mp-page">
      <header className="mp-hero">
        <div className="mp-hero-top">
          <p className="mp-eyebrow">02 · Monitor</p>
          <div className="mp-preview-disclosure"><span className="mp-preview-dot" />{controller.allowExternalData ? 'Market data enabled' : <><span>Market data off</span><a href="/app/settings">Settings</a></>}</div>
        </div>
        <div className="mp-hero-main">
          <div><h1>Portfolio watch</h1><p>Follow the changes. Plan what comes next.</p></div>
          <div className="mp-hero-actions">
            <button className="mp-button" type="button" disabled={controller.refreshing || !controller.allowExternalData} onClick={() => void controller.refresh()}><Icon name="refresh" />{controller.refreshing ? 'Refreshing prices…' : 'Refresh prices'}</button>
          </div>
        </div>
        <div className="mp-watch-status">
          <div className="mp-watch-summary">
            <span><Icon name="bell" /><strong>{controller.counts.open}</strong> to review</span>
            <span><Icon name="fund" /><strong>{controller.counts.activeRules}</strong> active rules</span>
            <span><Icon name="calendar" /><strong>{controller.counts.upcoming}</strong> upcoming reminders</span>
          </div>
        </div>
        <p className="mp-data-note">Quotes show their source time. Watch rules are checked when prices refresh.</p>
      </header>
      <MonitorTimeline controller={controller} initialQuery={initialQuery} />
      <footer className="mp-preview-state"><p aria-live="polite" role="status">{controller.statusMessage}</p><span>{controller.counts.reviewed} reviewed · {controller.counts.snoozed} snoozed</span></footer>
    </div>
  )
}
