import { useState } from 'react'
import { dateFormatter } from '../formatters'
import type { MonitorAlert } from '../monitor'
import type { MonitorController } from '../useMonitor'

type Props = { controller: MonitorController; onOpenHolding: (holdingId: string) => void }
const observedTime = dateFormatter({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

export function MonitorAlerts({ controller, onOpenHolding }: Props) {
  const [visibleCount, setVisibleCount] = useState(() => window.matchMedia?.('(max-width: 600px)').matches ? 1 : 3)
  const open = controller.alerts.filter((alert) => alert.state === 'open').sort((a, b) => b.at - a.at)
  const history = controller.alerts.filter((alert) => alert.state !== 'open').sort((a, b) => b.at - a.at)
  if (!open.length && !history.length) return null

  return <section className="mp-panel pa-attention" aria-labelledby="monitor-alerts-heading">
    <header className="mp-section-head"><h2 id="monitor-alerts-heading">Watch alerts</h2><span className="mp-badge">{open.length} open</span></header>
    {open.slice(0, visibleCount).map((alert) => <AlertRecord key={alert.id} alert={alert} controller={controller} onOpenHolding={onOpenHolding} />)}
    {open.length > visibleCount && <button className="mp-show-more" type="button" onClick={() => setVisibleCount((count) => count + 6)}>Show more alerts</button>}
    {history.length > 0 && <details className="pa-history"><summary>Reviewed &amp; snoozed <span>{history.length}</span></summary><AlertHistory alerts={history} controller={controller} onOpenHolding={onOpenHolding} /></details>}
  </section>
}

function AlertHistory({ alerts, ...props }: { alerts: MonitorAlert[] } & Props) {
  const [count, setCount] = useState(6)
  return <>{alerts.slice(0, count).map((alert) => <AlertRecord key={alert.id} alert={alert} {...props} />)}{alerts.length > count && <button type="button" className="mp-show-more" onClick={() => setCount((value) => value + 6)}>Show more history</button>}</>
}

function AlertRecord({ alert, controller, onOpenHolding }: { alert: MonitorAlert } & Props) {
  const movement = controller.hideValues ? undefined : alert.metrics.find((metric) => metric.trend != null)
  const holdingAvailable = !controller.hideValues && controller.positions.some((position) => position.id === alert.holdingId)
  return <article className="pa-record" data-tone={movement?.trend ?? 'neutral'}>
    <details><summary><span className="pa-record-main"><strong>{alert.holding}</strong><span className="pa-record-caption">{alert.title}{movement && <span data-trend={movement.trend}>{movement.value}</span>}</span></span><span aria-hidden="true">⌄</span></summary>
      <div className="pa-record-detail"><p>{alert.evidence}</p><dl>{alert.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd data-trend={metric.trend}>{metric.value}</dd></div>)}</dl></div>
    </details>
    <div className="pa-record-meta"><time dateTime={new Date(alert.at).toISOString()}>{observedTime.format(alert.at)} IST</time>{alert.state !== 'open' && <span>{alert.state === 'reviewed' ? 'Reviewed' : alert.snoozedUntil ? `Snoozed until ${observedTime.format(alert.snoozedUntil)} IST` : 'Snoozed'}</span>}</div>
    <div className="pa-review-actions">
      {alert.state === 'open' ? <><button type="button" aria-label={`Mark reviewed: ${alert.holding}`} onClick={() => controller.setAlertState(alert.id, 'reviewed')}>Mark reviewed</button>
        <details className="mp-snooze-menu"><summary aria-label={`Snooze: ${alert.holding}`}>Snooze</summary><div>{[1, 24].map((hours) => <button key={hours} type="button" onClick={(event) => { if (controller.snoozeAlert(alert.id, Date.now() + hours * 3_600_000)) event.currentTarget.closest('details')?.removeAttribute('open') }}>{hours} {hours === 1 ? 'hour' : 'hours'}</button>)}</div></details></>
        : <button type="button" onClick={() => controller.setAlertState(alert.id, 'open')}>Reopen item</button>}
      {holdingAvailable && <button type="button" className="pa-context-action" aria-label={`Open company: ${alert.holding}`} onClick={() => onOpenHolding(alert.holdingId)}>Company details</button>}
    </div>
  </article>
}
