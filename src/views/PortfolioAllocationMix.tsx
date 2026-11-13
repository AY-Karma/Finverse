import { useMemo, useState } from 'react'
import { useStore } from '../useStore'
import { computePortfolioStats, portfolioPulse } from '../valuation'
import { AllocationCard } from './AllocationCard'
import './portfolioAllocationMix.css'

type Scope = 'all' | 'equity' | 'mutual'

export function PortfolioAllocationMix() {
  const { snapshot, settings } = useStore()
  const [scope, setScope] = useState<Scope>('all')
  const positions = useMemo(() => snapshot.positions.filter(position => scope === 'all'
    || (scope === 'mutual' ? position.type === 'mutual-fund' : position.type !== 'mutual-fund')),
  [snapshot.positions, scope])
  const stats = useMemo(() => computePortfolioStats(positions, snapshot.quotes), [positions, snapshot.quotes])
  const pulse = useMemo(() => portfolioPulse(positions, snapshot.quotes), [positions, snapshot.quotes])
  const funds = snapshot.positions.filter(position => position.type === 'mutual-fund').length

  return <section className="panel insight-panel insight-panel--wide portfolio-allocation" aria-label="Allocation mix">
    <div className="panel-head">
      <div className="panel-head-titles"><span className="panel-title">Allocation Mix</span></div>
      <div className="scope-switch" aria-label="Allocation holding type">
        {([
          ['all', 'All', snapshot.positions.length],
          ['equity', 'Equity', snapshot.positions.length - funds],
          ['mutual', 'Mutual Funds', funds],
        ] as const).map(([key, label, count]) => <button type="button" key={key}
          className={`scope-btn${scope === key ? ' scope-btn--active' : ''}`} aria-pressed={scope === key}
          onClick={() => setScope(key)}>{label} {count}</button>)}
      </div>
    </div>
    <AllocationCard key={scope} allocations={stats.allocations} hideValues={settings.hideValues} pulse={pulse} />
  </section>
}
