import { useEffect, useState } from 'react'
import { isMarketOpen } from '../live'
import './marketRefresh.css'

interface Props {
  externalEnabled: boolean
  refreshing: boolean
  lastCheckedAt?: number | null
  nextRefreshAt?: number | null
}

export function MarketRefreshStatus({ externalEnabled, refreshing, lastCheckedAt, nextRefreshAt }: Props) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 1000)
    return () => window.clearInterval(timer)
  }, [])
  const open = isMarketOpen(new Date(now))
  const currentTime = Math.max(now, lastCheckedAt ?? 0)
  return <div className="market-refresh-status">
    <div className={`market-status ${open ? 'market-open' : 'market-closed'}`} role="status">
      <span className={`live-dot${refreshing ? ' live-dot--fetching' : !open ? ' live-dot--market-closed' : ''}`} aria-hidden="true" />
      <span className="market-status-copy">{!externalEnabled ? 'External market data off · showing imported prices'
        : refreshing ? 'Checking prices…' : `Market ${open ? 'open' : 'closed'}`}</span>
    </div>
    {externalEnabled && open && !refreshing && nextRefreshAt != null && <span className="market-refresh-next">Next refresh in {Math.max(0, Math.ceil((nextRefreshAt - currentTime) / 1000))}s</span>}
  </div>
}
