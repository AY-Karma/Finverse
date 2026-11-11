import { useEffect, useState } from 'react'
import { isMarketOpen } from '../live'
import './marketRefresh.css'

interface Props {
  externalEnabled: boolean
  refreshing: boolean
  lastCheckedAt?: number | null
  nextRefreshAt?: number | null
  issue?: string | null
  issueRole?: 'status' | 'alert'
}

export function MarketRefreshStatus({ externalEnabled, refreshing, lastCheckedAt, nextRefreshAt, issue, issueRole = 'status' }: Props) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 1000)
    return () => window.clearInterval(timer)
  }, [])
  const open = isMarketOpen(new Date(now))
  const currentTime = Math.max(now, lastCheckedAt ?? 0)
  const timing = !externalEnabled ? '' : refreshing ? 'Checking prices…'
    : open && nextRefreshAt != null ? `Next refresh in ${Math.max(0, Math.ceil((nextRefreshAt - currentTime) / 1000))}s` : ''
  return <div className="market-refresh-status" data-periodic={externalEnabled && open}>
    <div className={`market-status ${open ? 'market-open' : 'market-closed'}`} role="status">
      <span className={`live-dot${refreshing ? ' live-dot--fetching' : !open ? ' live-dot--market-closed' : ''}`} aria-hidden="true" />
      <span className="market-status-copy">{!externalEnabled ? 'External market data off · showing imported prices' : `Market ${open ? 'open' : 'closed'}`}</span>
    </div>
    <span className="market-refresh-next" aria-hidden={!timing || undefined}>{timing}</span>
    <span className="market-refresh-issue hint down" role={issue ? issueRole : undefined} aria-hidden={!issue || undefined}>{issue}</span>
  </div>
}
