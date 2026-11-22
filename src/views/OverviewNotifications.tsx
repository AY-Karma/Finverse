import { useEffect, useMemo, useRef } from 'react'
import { holdingIdentity, ipoWatchDue } from '../monitor'
import { EMPTY_FOLLOWS } from '../monitorFollows'
import { useMarketEvents } from '../useMarketEvents'
import { upcomingEconomicEvents } from '../economicCalendarProtocol'
import { useGlobalEvents } from './EconomicCalendar'
import { sipDueToday } from '../sipPlans'
import { useMonitor } from '../useMonitor'
import type { View } from '../useStore'
import { ActionIcon } from './ActionIcon'
import './overviewNotifications.css'

type Notice = { id: string; title: string; detail: string; open: () => void; done?: () => void }
const eventTime = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

export function OverviewNotifications({ onGoTo, pendingListings = 0, foliosNeedReview = false }: { onGoTo: (view: View, anchor?: string) => void; pendingListings?: number; foliosNeedReview?: boolean }) {
  const controller = useMonitor()
  const panel = useRef<HTMLDetailsElement>(null)
  const today = new Date(controller.now + 19_800_000).toISOString().slice(0, 10)
  const follows = controller.follows ?? EMPTY_FOLLOWS
  const positions = controller.positions ?? []
  // Followed companies' filings and followed economic-calendar days become notifications as they happen.
  const followedPositions = useMemo(() => positions.filter((position) => follows.companies.some((company) => company.identity === holdingIdentity(position))), [positions, follows.companies])
  const { feed } = useMarketEvents(followedPositions, controller.allowExternalData && followedPositions.length > 0, controller.hideValues, true)
  const dayFollowed = follows.days.includes(today)
  const economy = useGlobalEvents(controller.allowExternalData && dayFollowed && !controller.hideValues)
  const dismissed = new Set(follows.dismissed)
  const filingNotices: Notice[] = feed.events.flatMap((event) => {
    const since = follows.companies.find((company) => company.identity === event.instrumentIdentity)?.since
    const id = `filing:${event.id}`
    const published = event.publishedAt ?? Date.parse(`${event.date}T00:00:00+05:30`)
    return event.kind === 'filing' && since !== undefined && published > since && !dismissed.has(id)
      ? [{ id, title: event.holdingName, detail: `New filing · ${event.title}`, open: () => onGoTo('holdings', 'monitor-company'), done: () => controller.dismissFollowNotice(id) }] : []
  })
  const economyNotices: Notice[] = !dayFollowed ? [] : upcomingEconomicEvents(economy?.events ?? [], controller.now, 0).flatMap((event) => {
    const id = `economy:${event.id}`
    return dismissed.has(id) ? [] : [{ id, title: event.title, detail: `${event.allDay ? 'Today' : `${eventTime.format(Date.parse(event.at))} today`} · Economic calendar`, open: () => onGoTo('holdings', 'monitor-economy'), done: () => controller.dismissFollowNotice(id) }]
  })
  const notices: Notice[] = controller.hideValues ? [] : [
    ...economyNotices,
    ...filingNotices,
    ...controller.ipoWatches.filter((watch) => ipoWatchDue(watch, controller.now)).map((watch) => ({ id: `ipo:${watch.id}`, title: watch.name, detail: 'IPO closes today · Saved deadline', open: () => onGoTo('holdings', 'monitor-ipos'), done: () => controller.deleteIpoWatch(watch.id) })),
    ...controller.sipPlans.filter((plan) => sipDueToday(plan, today)).map((plan) => ({ id: `sip:${plan.id}`, title: plan.schemeName, detail: `SIP instalment today · ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(plan.amount)}`, open: () => onGoTo('settings', 'manage-holdings') })),
    ...controller.events.filter((event) => event.reminder && !event.unresolved && event.date === today).map((event) => ({ id: `reminder:${event.id}`, title: event.title, detail: 'Reminder due today', open: () => onGoTo('holdings', 'monitor-company'), done: () => controller.toggleReminder(event.id) })),
    ...controller.alerts.filter((alert) => alert.state === 'open').map((alert) => ({ id: `alert:${alert.id}`, title: alert.holding, detail: [alert.title, alert.metrics[0]?.value].filter(Boolean).join(' · '), open: () => onGoTo('holdings', 'monitor-watch-rules'), done: () => controller.setAlertState(alert.id, 'reviewed') })),
    ...(pendingListings ? [{ id: 'listings', title: 'Review listings', detail: `${pendingListings} ${pendingListings === 1 ? 'holding needs' : 'holdings need'} confirmation`, open: () => onGoTo('settings', 'instrument-review') }] : []),
    ...(foliosNeedReview ? [{ id: 'folios', title: 'Update folios', detail: 'Review or confirm your holdings are unchanged', open: () => onGoTo('settings', 'manage-holdings') }] : []),
  ]

  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) panel.current?.removeAttribute('open') }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])

  return <details ref={panel} className="overview-notifications" onKeyDown={(event) => {
    if (event.key === 'Escape') { panel.current?.removeAttribute('open'); panel.current?.querySelector('summary')?.focus({ preventScroll: true }) }
  }}>
    <summary className="icon-btn overview-bell" data-action-due={notices.length > 0} aria-label={controller.hideValues ? 'Notifications hidden' : `Notifications${notices.length ? `, ${notices.length} actions need attention` : ', no actions due'}`} title="Notifications"><ActionIcon name="bell" /></summary>
    <section className="overview-notification-panel" aria-label="Actions needing attention">
      <h2>Notifications</h2>
      {controller.hideValues ? <p>Turn off Hide values to view your actions.</p> : notices.length ? <ul>{notices.map((notice) => <li key={notice.id}>
        <button type="button" className="overview-notice-link" onClick={() => { panel.current?.removeAttribute('open'); notice.open() }}><strong>{notice.title}</strong><span>{notice.detail}</span></button>
        {notice.done && <button type="button" className="overview-notice-done" disabled={controller.readOnly} aria-label={`Mark ${notice.title} done`} onClick={notice.done}>Done</button>}
      </li>)}</ul> : <p>No actions due today.</p>}
      {controller.statusMessage && <p role="status">{controller.statusMessage}</p>}
    </section>
  </details>
}
