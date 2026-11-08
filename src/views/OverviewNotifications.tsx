import { useEffect, useRef } from 'react'
import { ipoWatchDue } from '../monitor'
import { useMonitor } from '../useMonitor'
import type { View } from '../useStore'
import { ActionIcon } from './ActionIcon'
import './overviewNotifications.css'

type Notice = { id: string; title: string; detail: string; open: () => void; done?: () => void }

export function OverviewNotifications({ onGoTo, pendingListings = 0, foliosNeedReview = false }: { onGoTo: (view: View, anchor?: string) => void; pendingListings?: number; foliosNeedReview?: boolean }) {
  const controller = useMonitor()
  const panel = useRef<HTMLDetailsElement>(null)
  const today = new Date(controller.now + 19_800_000).toISOString().slice(0, 10)
  const notices: Notice[] = controller.hideValues ? [] : [
    ...controller.ipoWatches.filter((watch) => ipoWatchDue(watch, controller.now)).map((watch) => ({ id: `ipo:${watch.id}`, title: watch.name, detail: 'IPO closes today · Saved deadline', open: () => onGoTo('holdings', 'monitor-ipos-heading'), done: () => controller.deleteIpoWatch(watch.id) })),
    ...controller.events.filter((event) => event.reminder && !event.unresolved && event.date === today).map((event) => ({ id: `reminder:${event.id}`, title: event.title, detail: 'Reminder due today', open: () => onGoTo('holdings', 'monitor-upcoming-heading'), done: () => controller.toggleReminder(event.id) })),
    ...controller.alerts.filter((alert) => alert.state === 'open').map((alert) => ({ id: `alert:${alert.id}`, title: alert.holding, detail: alert.title, open: () => onGoTo('holdings'), done: () => controller.setAlertState(alert.id, 'reviewed') })),
    ...(pendingListings ? [{ id: 'listings', title: 'Review listings', detail: `${pendingListings} ${pendingListings === 1 ? 'holding needs' : 'holdings need'} confirmation`, open: () => onGoTo('settings', 'instrument-review') }] : []),
    ...(foliosNeedReview ? [{ id: 'folios', title: 'Update folios', detail: 'Review or confirm your holdings are unchanged', open: () => onGoTo('settings', 'manage-holdings') }] : []),
  ]

  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) panel.current?.removeAttribute('open') }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])

  return <details ref={panel} className="overview-notifications" onKeyDown={(event) => {
    if (event.key === 'Escape') { panel.current?.removeAttribute('open'); panel.current?.querySelector('summary')?.focus() }
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
