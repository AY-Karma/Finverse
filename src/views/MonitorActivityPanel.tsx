import { useMemo, useState } from 'react'
import { assetTypeLabel } from '../instruments'
import { eligibleHoldings } from '../marketNews'
import { buildPortfolioActivity, type HoldingActivity } from '../portfolioActivity'
import { privateValue } from '../privacy'
import type { MonitorAlert, MonitorRecord } from '../monitor'
import type { MonitorController } from '../useMonitor'
import { useStore } from '../useStore'
import { ReminderAction } from './monitorPanels'
import { MonitorNewsIcon } from './MonitorNewsIcon'
import './monitorActivityPanel.css'

type ActivityView = 'brief' | 'holdings' | 'activity'
const VIEWS: { id: ActivityView; label: string }[] = [
  { id: 'brief', label: 'Brief' }, { id: 'holdings', label: 'Holdings' }, { id: 'activity', label: 'Activity' },
]

function valueTrend(value: number | null): 'up' | 'down' | 'neutral' {
  return value == null || value === 0 ? 'neutral' : value > 0 ? 'up' : 'down'
}

function observedLabel(row: HoldingActivity): string {
  if (row.observedAt == null) return row.freshness === 'imported' ? 'Imported price · no market time' : 'Price unavailable'
  const date = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: row.marketTimeZone }).format(row.observedAt)
  return `${date} ${row.marketTimeZone === 'Asia/Kolkata' ? 'IST' : row.marketTimeZone === 'America/New_York' ? 'ET' : 'London'}`
}

export function MonitorActivityPanel({ controller, onSelectNews }: { controller: MonitorController; onSelectNews: (ticker: string) => void }) {
  const { liveQuotes, fxRate, settings } = useStore()
  const [view, setView] = useState<ActivityView>('brief')
  const [filter, setFilter] = useState<'all' | 'open' | 'history'>('all')
  const [visibleCount, setVisibleCount] = useState(6)
  const [reminderCount, setReminderCount] = useState(3)
  const now = controller.now
  const model = useMemo(() => buildPortfolioActivity({ positions: controller.positions, quotes: controller.allowExternalData ? liveQuotes : {}, fxRate: fxRate ?? null, currency: settings.currency, hideValues: controller.hideValues, now }), [controller.positions, controller.allowExternalData, controller.hideValues, liveQuotes, fxRate, settings.currency, now])
  const newsTickers = new Set(eligibleHoldings(controller.positions).map((holding) => holding.ticker))
  const money = (value: number | null, currency = settings.currency) => controller.hideValues ? privateValue('', true) : value == null ? 'Unavailable' : new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  const signedMoney = (value: number | null) => controller.hideValues || value == null ? money(value) : `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`
  const summaryImpact = (value: number) => {
    if (Math.abs(value) < 100_000) return signedMoney(value)
    const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: settings.currency, notation: 'compact', maximumFractionDigits: 2 }).format(Math.abs(value))
    return `${value < 0 ? '−' : '+'}${amount}`
  }
  const percent = (value: number | null) => controller.hideValues ? privateValue('', true) : value == null ? 'Unavailable' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
  const chooseView = (next: ActivityView) => { setView(next); setVisibleCount(6) }
  const alerts = controller.alerts.filter((alert) => filter === 'all' || (filter === 'open' ? alert.state === 'open' : alert.state !== 'open'))
  const activity = [...alerts, ...(filter === 'all' ? controller.quoteRecords : [])].sort((a, b) => b.at - a.at)
  const openAlerts = controller.alerts.filter((alert) => alert.state === 'open')
  const briefRows = controller.hideValues ? model.holdings.filter((row) => row.type !== 'mutual-fund').slice(0, 4) : model.movers.slice(0, 4)
  const navRows = model.holdings.filter((row) => row.type === 'mutual-fund' && row.freshness === 'recent').sort((a, b) => (b.observedAt ?? 0) - (a.observedAt ?? 0))
  const largestImpact = model.summary.largestImpact
  const fundOnly = model.holdings.every((row) => row.type === 'mutual-fund')
  const latestNav = fundOnly ? navRows[0] : undefined
  const notReported = model.counts.total - model.counts.movement
  const breadth = [
    { label: 'Up', count: model.counts.gainers ?? 0, tone: 'up' },
    { label: 'Down', count: model.counts.decliners ?? 0, tone: 'down' },
    { label: 'Flat', count: model.counts.flat ?? 0, tone: 'neutral' },
    { label: 'Not reported', count: notReported, tone: 'unavailable' },
  ]
  const latestObservation = model.summary.latestObservedAt == null ? null : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(model.summary.latestObservedAt)
  const reviewActivity = () => { setFilter('open'); chooseView('activity') }
  const showNews = (ticker: string) => {
    onSelectNews(ticker)
    window.requestAnimationFrame(() => {
      const panel = document.getElementById('monitor-news-heading')?.closest('section')
      panel?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' })
      panel?.querySelector<HTMLSelectElement>('select[aria-label="Find news for a holding"]')?.focus({ preventScroll: true })
    })
  }

  return <section className="pa-panel" aria-labelledby="portfolio-activity-heading">
    <header className="pa-head">
      <div><p className="mp-kicker">Your holdings, in focus</p><h2 id="portfolio-activity-heading">Portfolio activity</h2></div>
      <ReminderAction controller={controller} />
    </header>
    <div className="pa-views" aria-label="Portfolio activity view">
      {VIEWS.map((item) => <button type="button" key={item.id} aria-pressed={view === item.id} onClick={() => chooseView(item.id)}>{item.label}</button>)}
    </div>
    <div className="pa-pulse" role="group" aria-label="Portfolio briefing summary">
      <div className="pa-summary-card pa-summary-lead" data-tone={valueTrend(largestImpact?.dayContribution ?? null)}>
        <span className="pa-summary-label">{fundOnly && !controller.hideValues ? 'Latest published NAV' : 'Largest reported impact'}</span>
        <strong className="pa-summary-value" data-trend={valueTrend(largestImpact?.dayContribution ?? null)} title={largestImpact ? signedMoney(largestImpact.dayContribution) : undefined} aria-label={largestImpact ? signedMoney(largestImpact.dayContribution) : undefined}>{controller.hideValues ? privateValue('', true) : largestImpact ? summaryImpact(largestImpact.dayContribution!) : latestNav ? money(latestNav.price, latestNav.assetCurrency) : model.summary.impactCount ? money(0) : <span className="pa-summary-empty">{fundOnly ? 'Unavailable' : 'Not reported'}</span>}</strong>
        <span className="pa-summary-context">{controller.hideValues ? 'Values and rankings hidden' : largestImpact ? <>{largestImpact.ticker}{largestImpact.changePct != null && <> · <span className="pa-change" data-trend={valueTrend(largestImpact.changePct)}>{percent(largestImpact.changePct)}</span></>}</> : latestNav ? latestNav.name : fundOnly ? 'No recent fund NAV is available' : model.summary.impactCount ? 'Available impact estimates are zero' : 'A reported price change is needed to estimate impact'}</span>
        {(largestImpact || latestNav) && <span className="pa-summary-time">{observedLabel((largestImpact ?? latestNav)!)}</span>}
        <div className="pa-summary-footer"><span>{fundOnly ? 'Daily NAV publication' : `${model.summary.impactCount} of ${model.summary.impactEligibleCount} quote estimates`}</span><button type="button" className="pa-link" onClick={() => chooseView('holdings')}>Details <span aria-hidden="true">↗</span></button></div>
      </div>
      <div className="pa-summary-card">
        <span className="pa-summary-label">Reported moves</span>
        <strong className="pa-summary-value pa-summary-breadth">{controller.hideValues ? privateValue('', true) : <><span className="pa-move-count" data-trend={model.counts.gainers ? 'up' : 'neutral'}>{model.counts.gainers}<small> up</small></span><small> / </small><span className="pa-move-count" data-trend={model.counts.decliners ? 'down' : 'neutral'}>{model.counts.decliners}<small> down</small></span></>}</strong>
        <div className="pa-summary-rail" aria-hidden="true">{!controller.hideValues && breadth.filter((part) => part.count > 0).map((part) => <span key={part.label} data-tone={part.tone} style={{ flexGrow: part.count }} />)}</div>
        {controller.hideValues ? <span className="pa-summary-context">Movement details hidden</span> : <div className="pa-summary-legend"><span>{model.counts.flat} flat</span><span>{notReported} not reported</span></div>}
        <span className="pa-summary-note">{model.counts.movement} of {model.counts.total} holdings report a change</span>
      </div>
      <div className="pa-summary-card">
        <span className="pa-summary-label">Recent observations</span>
        <strong className="pa-summary-value">{model.counts.fresh}<small> / {model.counts.total}</small></strong>
        <div className="pa-summary-rail pa-summary-coverage" aria-hidden="true"><span style={{ width: `${model.counts.total ? model.counts.fresh / model.counts.total * 100 : 0}%` }} /></div>
        <span className="pa-summary-context">{model.summary.quoteCount} {model.summary.quoteCount === 1 ? 'quote' : 'quotes'} · {model.summary.navCount} daily {model.summary.navCount === 1 ? 'NAV' : 'NAVs'}</span>
        <span className="pa-summary-note">{latestObservation ? <>Latest · <time dateTime={new Date(model.summary.latestObservedAt!).toISOString()}>{latestObservation} IST</time></> : controller.allowExternalData ? 'No recent provider observations' : 'External market data is off'}</span>
      </div>
      <button type="button" className="pa-summary-card pa-summary-review" aria-label={`Review ${controller.counts.open} open watch ${controller.counts.open === 1 ? 'alert' : 'alerts'}`} onClick={reviewActivity}>
        <span className="pa-summary-label">To review <span aria-hidden="true">↗</span></span>
        <strong className="pa-summary-value" data-attention={controller.counts.open > 0}>{controller.counts.open}<small> {controller.counts.open === 1 ? 'alert' : 'alerts'}</small></strong>
        <span className="pa-summary-context">{controller.counts.activeRules} active watch {controller.counts.activeRules === 1 ? 'rule' : 'rules'}</span>
        <span className="pa-summary-note">{controller.counts.upcoming} upcoming {controller.counts.upcoming === 1 ? 'reminder' : 'reminders'}</span>
        <span className="pa-summary-review-link">{controller.counts.open ? 'Review alerts' : 'Open activity'} <span aria-hidden="true">→</span></span>
      </button>
    </div>
    {(model.counts.stale > 0 || model.counts.imported > 0 || model.counts.unavailable > 0 || !controller.allowExternalData) && <p className="pa-data-note" role="status">{!controller.allowExternalData ? 'External data is off. Showing imported prices. ' : ''}{model.counts.stale > 0 ? `${model.counts.stale} older quotes. ` : ''}{model.counts.imported > 0 ? `${model.counts.imported} imported prices. ` : ''}{model.counts.unavailable > 0 ? `${model.counts.unavailable} prices unavailable. ` : ''}Only recent provider observations enter the move list.</p>}

    {view === 'brief' && <div className="pa-brief">
      {(model.holdings.some((row) => row.type !== 'mutual-fund') || navRows.length === 0) && <>
      <div className="pa-section-title"><h3>{controller.hideValues ? 'Holding updates' : model.movers.some((row) => row.dayContribution != null) ? 'Largest reported impacts' : 'Reported moves'}</h3><button type="button" className="pa-link" onClick={() => chooseView('holdings')}>All holdings <span aria-hidden="true">↗</span></button></div>
      {briefRows.length > 0 ? <ul className="pa-movers" aria-label={controller.hideValues ? 'Holding updates' : 'Largest reported holding moves'}>{briefRows.map((row) => <li className="pa-mover" data-tone={row.trend} key={row.id}>
        <span className="pa-symbol" aria-hidden="true">{row.type === 'mutual-fund' ? 'MF' : row.ticker.slice(0, 3)}</span>
        <div className="pa-identity"><strong>{row.name || row.ticker}</strong><span>{row.movementLabel} · {row.source ?? 'No provider'} · {observedLabel(row)}</span></div>
        <div className="pa-mover-numbers"><strong className="pa-change" data-trend={valueTrend(row.changePct)}>{percent(row.changePct)}</strong><span className="pa-impact-line"><span>Impact:</span><b className="pa-impact" data-trend={valueTrend(row.dayContribution)}>{signedMoney(row.dayContribution)}</b></span></div>
        {newsTickers.has(row.ticker) && <HoldingNewsAction holding={row} onClick={() => showNews(row.ticker)} />}
      </li>)}</ul> : <div className="pa-empty"><strong>No recent moves reported</strong><p>{model.counts.fresh > 0 ? 'Some providers publish a price or daily NAV without a change. See Holdings for their latest observations.' : 'Refresh prices to see reported changes. Older and imported prices stay in Holdings.'}</p></div>}
      <p className="pa-explainer">{controller.hideValues ? 'Values and movement rankings are hidden.' : 'Ranked by absolute estimated impact where available, then by reported percentage move. Observation dates can differ.'}</p>
      </>}
      {navRows.length > 0 && <>
        <div className="pa-section-title"><h3>Daily NAV updates</h3><span>{navRows.length} {navRows.length === 1 ? 'fund' : 'funds'} observed</span></div>
        <ul className="pa-movers" aria-label="Latest published fund NAVs">{navRows.slice(0, 2).map((row) => <li className="pa-mover" key={row.id}>
          <span className="pa-symbol" aria-hidden="true">MF</span>
          <div className="pa-identity"><strong>{row.name}</strong><span>Published NAV · {observedLabel(row)}</span></div>
          <div className="pa-mover-numbers"><strong>{money(row.price, row.assetCurrency)}</strong><span>per unit</span></div>
        </li>)}</ul>
        <p className="pa-explainer">Daily publications, not intraday quotes.{navRows.length > 2 ? ` See all ${navRows.length} funds in Holdings.` : ''}</p>
      </>}
      <div className="pa-section-title"><h3>Needs review</h3><button type="button" className="pa-link" onClick={reviewActivity}>Review activity <span aria-hidden="true">↗</span></button></div>
      {openAlerts.length > 0 ? <div className="pa-records">{openAlerts.slice(0, 2).map((record) => <ActivityRecord key={record.id} record={record} controller={controller} />)}</div> : <div className="pa-clear"><span aria-hidden="true">✓</span><p>No open watch alerts. Your active rules will flag matching price observations.</p></div>}
      {openAlerts.length > 2 && <p className="pa-explainer">{openAlerts.length - 2} more items in Activity.</p>}
    </div>}

    {view === 'holdings' && <div className="pa-holdings">
      <div className="pa-section-title"><h3>Every holding</h3><span>{model.counts.total} tracked</span></div>
      <div className="pa-table" role="table" aria-label="Holding market observations">
        <div className="pa-table-head" role="row"><span role="columnheader">Holding / as of</span><span role="columnheader">Price / NAV</span><span role="columnheader">Move</span><span role="columnheader">Est. impact</span><span role="columnheader">Weight</span></div>
        {model.holdings.slice(0, visibleCount).map((row) => <div className="pa-table-row" role="row" data-tone={row.trend} key={row.id}>
          <div className="pa-table-identity" role="cell"><strong>{row.name || row.ticker}</strong><span>{assetTypeLabel(row.type)} · {row.source ?? 'No provider'}</span><time dateTime={row.observedAt == null ? undefined : new Date(row.observedAt).toISOString()}>{observedLabel(row)}{row.freshness === 'stale' ? ' · Older quote' : ''}</time>{newsTickers.has(row.ticker) && <HoldingNewsAction holding={row} onClick={() => showNews(row.ticker)} />}</div>
          <div role="cell" data-label="Price / NAV">{money(row.price, row.assetCurrency)}</div>
          <div role="cell" className="pa-direction" data-label={row.movementLabel}><span className="pa-change" data-trend={valueTrend(row.changePct)}>{percent(row.changePct)}</span></div>
          <div role="cell" className="pa-direction" data-label="Est. impact"><span className="pa-impact" data-trend={valueTrend(row.dayContribution)}>{signedMoney(row.dayContribution)}</span></div>
          <div role="cell" data-label="Weight">{controller.hideValues ? privateValue('', true) : row.weightPct == null ? 'Unavailable' : `${row.weightPct.toFixed(1)}%`}</div>
        </div>)}
      </div>
      {visibleCount < model.holdings.length && <button type="button" className="pa-more" onClick={() => setVisibleCount((count) => count + 6)}>Show more holdings · {model.holdings.length - visibleCount} remaining</button>}
      <p className="pa-explainer">NAVs are daily publications. A missing move is unavailable, never zero.{model.counts.fxUnavailable > 0 ? ' FX is unavailable for some holdings; their converted impact and portfolio weights are unavailable.' : ''}</p>
    </div>}

    {view === 'activity' && <div className="pa-ledger">
      <div className="pa-section-title"><h3>Observation log</h3><span>Latest quotes & watch alerts</span></div>
      <div className="pa-filters" aria-label="Filter portfolio activity">
        {(['all', 'open', 'history'] as const).map((item) => <button type="button" key={item} aria-pressed={filter === item} onClick={() => { setFilter(item); setVisibleCount(6) }}>{item === 'all' ? 'All activity' : item === 'open' ? 'To review' : 'History'}</button>)}
      </div>
      <div className="pa-records">{activity.slice(0, visibleCount).map((record) => <ActivityRecord key={record.id} record={record} controller={controller} />)}</div>
      {activity.length === 0 && <div className="pa-empty"><strong>{filter === 'open' ? 'No items to review' : filter === 'history' ? 'No history yet' : 'No observations yet'}</strong><p>{filter === 'history' ? 'Reviewed and snoozed alerts will appear here.' : 'Watch alerts and available quote observations appear after prices refresh.'}</p></div>}
      {visibleCount < activity.length && <button type="button" className="pa-more" onClick={() => setVisibleCount((count) => count + 6)}>Show more activity · {activity.length - visibleCount} remaining</button>}
    </div>}

    <div className="pa-reminders">
      <div className="pa-section-title"><h3>Personal reminders</h3><span>{controller.counts.upcoming} upcoming</span></div>
      {controller.events.length > 0 ? <ul>{controller.events.slice(0, reminderCount).map((event) => <li key={event.id}>
        <time dateTime={event.date}>{new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${event.date}T12:00:00Z`))}</time>
        <div><strong>{event.title}</strong><span>{event.holding}</span></div>
        <button type="button" aria-pressed={event.reminder} aria-label={`${event.reminder ? 'Remove reminder for' : 'Set reminder for'} ${event.title}`} onClick={() => controller.toggleReminder(event.id)}>{event.reminder ? 'Reminder on' : 'Remind me'}</button>
      </li>)}</ul> : <p className="pa-explainer">Add a date to revisit a holding or check an announcement. Reminders stay in this app.</p>}
      {reminderCount < controller.events.length && <button type="button" className="pa-more" onClick={() => setReminderCount((count) => count + 3)}>Show more reminders</button>}
    </div>
  </section>
}

function HoldingNewsAction({ holding, onClick }: { holding: HoldingActivity; onClick: () => void }) {
  return <button type="button" className="pa-news-button" aria-label={`View news for ${holding.name || holding.ticker}`} onClick={onClick}><MonitorNewsIcon /><span>View news</span></button>
}

function ActivityRecord({ record, controller }: { record: MonitorRecord | MonitorAlert; controller: MonitorController }) {
  const isAlert = record.kind === 'price'
  const movement = controller.hideValues ? undefined : record.metrics.find((metric) => metric.trend != null)
  const trend = movement?.trend ?? 'neutral'
  return <article className="pa-record" data-tone={trend}>
    <details>
      <summary><span className="pa-record-kind">{isAlert ? 'Rule' : 'Quote'}</span><span className="pa-record-main"><strong>{record.holding}</strong><span className="pa-record-caption"><span>{record.title}</span>{movement && <span className="pa-record-change" data-trend={trend} aria-label={`${movement.label}: ${movement.value}`}>{movement.value}</span>}</span></span><time dateTime={new Date(record.at).toISOString()}>{new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(record.at)}</time><span className="pa-expand" aria-hidden="true">⌄</span></summary>
      <div className="pa-record-detail"><p>{record.reason}</p><p>{record.evidence}</p><dl>{record.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd data-trend={metric.trend}>{metric.value}</dd></div>)}</dl></div>
    </details>
    {isAlert && <div className="pa-review-actions"><span className="mp-badge" data-state={record.state}>{record.state === 'open' ? 'To review' : record.state === 'reviewed' ? 'Reviewed' : 'Snoozed'}</span>{record.state === 'open' ? <><button type="button" aria-label={`Mark reviewed: ${record.holding}`} onClick={() => controller.setAlertState(record.id, 'reviewed')}>Mark reviewed</button><button type="button" aria-label={`Snooze: ${record.holding}`} onClick={() => controller.setAlertState(record.id, 'snoozed')}>Snooze</button></> : <button type="button" onClick={() => controller.setAlertState(record.id, 'open')}>Reopen item</button>}</div>}
  </article>
}
