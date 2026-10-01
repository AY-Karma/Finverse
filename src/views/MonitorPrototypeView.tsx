import { useEffect, useState } from 'react'
import { MonitorNewsPanel } from './MonitorNewsPanel'
import { ReminderAction, RulesPanel, useMonitorPrototype, type MonitorPrototypeController } from './monitorPrototypePanels'
import './monitorPrototype.css'

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

const holdingIdentity: Record<string, { initials: string; code: string; brand: string; icon: IconName }> = {
  'HDFC Bank': { initials: 'HB', code: 'HDFCBANK · Equity', brand: 'bank', icon: 'bank' },
  TCS: { initials: 'TCS', code: 'TCS · Equity', brand: 'tcs', icon: 'results' },
  'Parag Parikh Flexi Cap': { initials: 'PP', code: 'PPFAS · Mutual fund', brand: 'fund', icon: 'fund' },
  'My portfolio': { initials: 'PF', code: 'Personal reminder', brand: 'portfolio', icon: 'portfolio' },
}

function HoldingIdentity({ holding }: { holding: string }) {
  const identity = holdingIdentity[holding] ?? {
    initials: holding.split(' ').map((word) => word[0]).join('').slice(0, 2),
    code: 'Sample holding', brand: 'portfolio', icon: 'portfolio' as const,
  }
  return (
    <>
      <span className="mp-holding-tile" data-brand={identity.brand} aria-hidden="true">
        {identity.initials}
        <span className="mp-holding-symbol"><Icon name={identity.icon} /></span>
      </span>
      <div className="mp-item-identity"><strong>{holding}</strong><span>{identity.code}</span></div>
    </>
  )
}

function eventDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

function daysAhead(date: string): number {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse('2026-10-01T12:00:00Z')) / 86400000)
}

function countdownLabel(date: string): string {
  const days = daysAhead(date)
  return days === 0 ? 'Today' : `In ${days} ${days === 1 ? 'day' : 'days'}`
}

const eventKinds = {
  Results: { icon: 'results', tone: 'results' },
  Dividend: { icon: 'dividend', tone: 'dividend' },
  Reminder: { icon: 'bell', tone: 'reminder' },
  'Scheme update': { icon: 'notice', tone: 'disclosure' },
} as const

function MonitorTimeline({ controller }: { controller: MonitorPrototypeController }) {
  const [filter, setFilter] = useState<'all' | 'open' | 'history'>('all')
  const dates = [...new Set(controller.events.map((event) => event.date))].sort()
  const alerts = controller.alerts.filter((alert) => filter === 'all' || (filter === 'open' ? alert.state === 'open' : alert.state !== 'open'))
  return (
    <div className="mp-timeline-layout">
      <section className="mp-timeline" aria-labelledby="mp-timeline-title">
        <div className="mp-section-head">
          <div><p className="mp-kicker">Activity & upcoming events</p><h2 id="mp-timeline-title">Portfolio timeline</h2></div>
          <ReminderAction controller={controller} />
        </div>
        <div className="mp-timeline-tabs" aria-label="Timeline activity">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All activity <span>{controller.alerts.length}</span></button>
          <button type="button" aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>To review <span>{controller.counts.open}</span></button>
          <button type="button" aria-pressed={filter === 'history'} onClick={() => setFilter('history')}>History <span>{controller.counts.reviewed + controller.counts.snoozed}</span></button>
        </div>
        <div className="mp-timeline-group">
          <div className="mp-timeline-date"><span className="mp-timeline-dot" /><strong>Today</strong><span>Thu, 1 Oct · Sample activity</span></div>
          <div className="mp-timeline-items">
            {alerts.map((alert) => {
              const trend = alert.metrics?.find((metric) => metric.trend === 'up' || metric.trend === 'down')?.trend
              const tone = alert.kind === 'disclosure' ? 'disclosure' : trend ?? 'up'
              return (
                <article className={`mp-timeline-item mp-timeline-item--${alert.state}`} data-tone={tone} key={alert.id}>
                  <div className="mp-item-header">
                    <HoldingIdentity holding={alert.holding} />
                    <span className="mp-badge" data-state={alert.state}>
                      <Icon name={alert.state === 'reviewed' ? 'check' : alert.state === 'snoozed' ? 'clock' : 'bell'} />
                      {alert.state === 'open' ? 'To review' : alert.state === 'reviewed' ? 'Reviewed' : 'Snoozed'}
                    </span>
                  </div>
                  <div className="mp-item-category" data-tone={tone}>
                    <Icon name={alert.kind === 'disclosure' ? 'notice' : trend === 'down' ? 'down' : 'up'} />
                    <strong>{alert.kind === 'price' ? 'Watch rule triggered' : 'Scheme disclosure'}</strong>
                    <time>{alert.time}</time>
                  </div>
                  <h3>{alert.title}</h3>
                  {alert.kind === 'disclosure' && <p className="mp-timeline-reason">{alert.reason}</p>}
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
                    <details className="mp-source-details"><summary><Icon name="source" />Sample evidence</summary><p>{alert.evidence}</p></details>
                    <div className="mp-actions">
                      {alert.state === 'open' ? (
                        <>
                          <button type="button" className="mp-button mp-button--small" onClick={() => controller.setAlertState(alert.id, 'reviewed')}><Icon name="check" />Mark reviewed</button>
                          <button type="button" className="mp-text-button" onClick={() => controller.setAlertState(alert.id, 'snoozed')}><Icon name="clock" />Snooze</button>
                        </>
                      ) : <button type="button" className="mp-text-button" onClick={() => controller.setAlertState(alert.id, 'open')}>Reopen item</button>}
                    </div>
                  </div>
                </article>
              )
            })}
            {alerts.length === 0 && <div className="mp-empty mp-timeline-empty"><Icon name="check" /><h3>{filter === 'open' ? 'All reviewed for now' : 'No history yet'}</h3><p>{filter === 'open' ? 'Upcoming events are still below.' : 'Reviewed and snoozed items will appear here.'}</p></div>}
          </div>
        </div>
        {dates.map((date) => (
          <div className="mp-timeline-group" key={date}>
            <div className="mp-timeline-date"><span className="mp-timeline-dot mp-timeline-dot--future" /><strong>{eventDate(date)}</strong><span>Upcoming</span></div>
            <div className="mp-timeline-items">
              {controller.events.filter((event) => event.date === date).map((event) => {
                const kind = eventKinds[event.kind]
                return (
                  <article className="mp-timeline-item mp-timeline-item--event" data-tone={kind.tone} key={event.id}>
                    <div className="mp-item-header">
                      <HoldingIdentity holding={event.holding} />
                      <button type="button" className={`mp-event-reminder ${event.reminder ? 'mp-is-selected' : ''}`} aria-pressed={event.reminder} aria-label={`${event.reminder ? 'Remove reminder for' : 'Set reminder for'} ${event.title}`} onClick={() => controller.toggleReminder(event.id)}>
                        <Icon name={event.reminder ? 'check' : 'bell'} /><span>{event.reminder ? 'Reminder on' : 'Remind me'}</span>
                      </button>
                    </div>
                    <div className="mp-event-details">
                      <span className="mp-item-category" data-tone={kind.tone}><Icon name={kind.icon} />{event.kind}</span>
                      <span className="mp-event-countdown">{countdownLabel(event.date)}</span>
                    </div>
                    <h3>{event.title}</h3>
                  </article>
                )
              })}
            </div>
          </div>
        ))}
      </section>
      <aside className="mp-timeline-sidebar" aria-label="Watch rules and news">
        <div className="mp-panel"><RulesPanel controller={controller} /></div>
        <MonitorNewsPanel />
      </aside>
    </div>
  )
}

export function MonitorPrototypeView({ onExit }: { onExit?: () => void }) {
  const controller = useMonitorPrototype()
  const [refreshCount, setRefreshCount] = useState(0)
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('variant') !== 'B') {
      url.searchParams.set('variant', 'B')
      window.history.replaceState(window.history.state, '', url)
    }
  }, [])

  const exitPreview = () => {
    if (onExit) { onExit(); return }
    const url = new URL(window.location.href)
    url.searchParams.delete('preview')
    url.searchParams.delete('variant')
    window.history.pushState({}, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  const refresh = () => { controller.simulateRefresh(); setRefreshCount((count) => count + 1) }
  const reset = () => { controller.reset(); setRefreshCount(0) }

  return (
    <div className="mp-page mp-variant-b">
      <header className="mp-hero">
        <div className="mp-hero-top">
          <p className="mp-eyebrow">04 · Monitor</p>
          <div className="mp-preview-disclosure"><span className="mp-preview-dot" />Timeline preview</div>
        </div>
        <div className="mp-hero-main">
          <div><h1>Portfolio watch</h1><p>Follow the changes. Plan what comes next.</p></div>
          <div className="mp-hero-actions">
            <button className="mp-button" type="button" onClick={refresh}><Icon name="refresh" />Refresh sample</button>
            <button className="mp-text-button" type="button" onClick={exitPreview}>Exit preview <span aria-hidden="true">↗</span></button>
          </div>
        </div>
        <div className="mp-watch-status">
          <div className="mp-watch-summary">
            <span><Icon name="bell" /><strong>{controller.counts.open}</strong> to review</span>
            <span><Icon name="fund" /><strong>{controller.counts.activeRules}</strong> active rules</span>
            <span><Icon name="calendar" /><strong>{controller.events.length}</strong> upcoming</span>
          </div>
          <div className="mp-sample-controls">
            <span>{refreshCount === 0 ? 'Sample · 1 Oct 2026, 09:42 IST' : `Sample refresh ${refreshCount} · 1 Oct 2026`}</span>
            <button type="button" className="mp-text-button" onClick={reset}>Reset demo</button>
          </div>
        </div>
        <p className="mp-data-note">Timeline and watch rules use sample data. News uses the app's existing feed.</p>
      </header>
      <MonitorTimeline controller={controller} />
      <footer className="mp-preview-state"><p aria-live="polite" role="status">{controller.statusMessage}</p><span>{controller.counts.reviewed} reviewed · {controller.counts.snoozed} snoozed</span></footer>
    </div>
  )
}
