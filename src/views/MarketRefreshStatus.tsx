import { isMarketOpen } from '../live'
import './marketRefresh.css'

interface Props {
  externalEnabled: boolean
  now?: Date
  issue?: string | null
  issueRole?: 'status' | 'alert'
}

export function MarketRefreshStatus({ externalEnabled, now = new Date(), issue, issueRole = 'status' }: Props) {
  const open = isMarketOpen(now)
  return <div className="market-refresh-status">
    <div className={`market-status ${open ? 'market-open' : 'market-closed'}`} role="status">
      <span className={`live-dot${!open ? ' live-dot--market-closed' : ''}`} aria-hidden="true" />
      <span className="market-status-copy">{!externalEnabled ? 'External market data off · showing imported prices' : `Market ${open ? 'open' : 'closed'}`}</span>
    </div>
    <span className="market-refresh-issue hint down" role={issue ? issueRole : undefined} aria-hidden={!issue || undefined}>{issue}</span>
  </div>
}
