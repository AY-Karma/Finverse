import { useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../useStore'
import { computePortfolioStats } from '../valuation'
import { AllocationCard } from './AllocationCard'
import './portfolioAllocationMix.css'

type Scope = 'all' | 'equity' | 'mutual'

/** Allocation donut and composition, with a companion panel (price movers) beside it on wide screens. */
export function PortfolioAllocationMix({ children }: { children?: ReactNode }) {
  const { snapshot, settings } = useStore()
  const [scope, setScope] = useState<Scope>('all')
  const positions = useMemo(() => snapshot.positions.filter(position => scope === 'all'
    || (scope === 'mutual' ? position.type === 'mutual-fund' : position.type !== 'mutual-fund')),
  [snapshot.positions, scope])
  const stats = useMemo(() => computePortfolioStats(positions, snapshot.quotes), [positions, snapshot.quotes])
  const funds = snapshot.positions.filter(position => position.type === 'mutual-fund').length

  return <section className="panel insight-panel insight-panel--wide portfolio-allocation" aria-label="Allocation mix">
    <div className="alloc-mix-layout">
      <div className="alloc-mix-main">
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
        <AllocationCard key={scope} allocations={stats.allocations} hideValues={settings.hideValues} />
      </div>
      {children}
    </div>
  </section>
}
