import type { MonitorController } from '../useMonitor'
import { dateFormatter } from '../formatters'
import { useStore } from '../useStore'

const date = dateFormatter({ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

export function IpoWatchRules({ controller }: { controller: MonitorController }) {
  const { workspaceReadOnly } = useStore()
  if (!controller.ipoWatches.length) return null
  return <section className="ipo-watch-rules" aria-label="IPO watch rules">
    <h3>IPO deadlines</h3>
    {controller.ipoWatches.map((watch) => <div className="ipo-watch-rule" key={watch.id}>
      <div><strong>{controller.hideValues ? 'IPO watch hidden' : watch.name}</strong><p>{controller.hideValues ? 'Deadline hidden' : `Last-day reminder · ${date.format(new Date(`${watch.closeDate}T12:00:00+05:30`))}`}</p></div>
      <button type="button" className="mp-text-button" disabled={workspaceReadOnly} aria-label={controller.hideValues ? 'Remove IPO watch' : `Remove ${watch.name} IPO watch`} onClick={() => controller.deleteIpoWatch(watch.id)}>Remove</button>
    </div>)}
    <p className="mp-muted">Saved deadlines appear in Overview on the closing day.</p>
  </section>
}
