import { useMemo, useState } from 'react'
import { usePortfolioBackcast } from '../usePortfolioBackcast'
import { useStore } from '../useStore'
import { formatCurrency, formatPercent } from '../valuation'
import { HiddenValuesState } from './HiddenValuesState'
import { InteractiveTrendChart } from './InteractiveTrendChart'

type Scope = 'all' | 'equity' | 'mutual'

export function PortfolioPerformance({ scope = 'all' }: { scope?: Scope }) {
  const { snapshot, settings } = useStore()
  const [selectedMode, setSelectedMode] = useState<'backcast' | 'tracked'>('backcast')
  const positions = useMemo(() => scope === 'all' ? snapshot.positions : snapshot.positions.filter((position) => (
    scope === 'mutual' ? position.type === 'mutual-fund' : position.type !== 'mutual-fund'
  )), [scope, snapshot.positions])
  const { backcast, history, loading, requestMore, observationLabel } = usePortfolioBackcast({
    positions, quotes: snapshot.quotes, allowExternalData: settings.allowExternalData,
  })
  const mode = scope === 'all' ? selectedMode : 'backcast'
  const trackedAvailable = scope === 'all' && snapshot.history.length >= 2
  const performanceHistory = mode === 'tracked' ? snapshot.history : history
  const latest = performanceHistory[performanceHistory.length - 1]
  const gap = latest ? latest.value - latest.invested : null
  const gapPct = latest?.invested > 0 && gap != null ? gap / latest.invested * 100 : null
  const value = (amount: number) => formatCurrency(amount)
  const axisCurrency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 })
  const axisValue = (amount: number) => axisCurrency.format(amount)

  return (
    <section className="portfolio-performance chart-open" aria-label="Portfolio performance">
      <div className="panel-head portfolio-performance-head">
        <div className="panel-head-titles"><span className="panel-title">Portfolio performance</span></div>
        <div className="segmented-control" aria-label="Performance history method">
          <button type="button" className={mode === 'backcast' ? 'is-active' : ''} onClick={() => setSelectedMode('backcast')} aria-pressed={mode === 'backcast'}>Backcast</button>
          <button type="button" className={mode === 'tracked' ? 'is-active' : ''} onClick={() => setSelectedMode('tracked')} aria-pressed={mode === 'tracked'} disabled={!trackedAvailable} title={scope !== 'all' ? 'Tracked balances cover all holdings' : trackedAvailable ? 'Use saved daily portfolio balances' : 'Available after two market-day snapshots'}>Tracked</button>
        </div>
      </div>
      {settings.hideValues ? <HiddenValuesState /> : <>
        {mode === 'tracked' && <p className="performance-method-note">Balances include cash flows and account changes.{snapshot.history.some((balance) => balance.dataQuality) && ' Earlier data may be unverified.'}</p>}
        {mode === 'backcast' && performanceHistory.length >= 2 && backcast && backcast.holdingsIncluded < backcast.holdingsTotal && <p className="performance-method-note performance-coverage">History covers {backcast.holdingsIncluded} of {backcast.holdingsTotal} holdings · {backcast.coveragePct.toFixed(0)}% of priced INR value.</p>}
        {performanceHistory.length >= 2 && <div className="insight-chart-readout">
          <div className="insight-chart-metric insight-chart-metric--value">
            <span><i aria-hidden="true" />Portfolio value</span><strong>{latest ? value(latest.value) : '—'}</strong>
            <small>{mode === 'backcast' ? observationLabel : 'Latest observation'}</small>
          </div>
          <div className="insight-chart-metric insight-chart-metric--invested">
            <span><i aria-hidden="true" />Invested capital</span><strong>{latest ? value(latest.invested) : '—'}</strong>
            <small>{mode === 'tracked' ? 'Cost recorded at each snapshot' : "Cost of today's holdings"}</small>
          </div>
          <div className="insight-chart-metric insight-chart-metric--gap">
            <span>Value − invested</span><strong className={gap == null ? '' : gap >= 0 ? 'up' : 'down'}>{gap == null ? '—' : `${gap >= 0 ? '+' : ''}${value(gap)}`}</strong>
            <small>{gapPct == null ? 'Current difference' : formatPercent(gapPct)}</small>
          </div>
        </div>}
        <div className="insight-chart insight-chart--performance">
          {performanceHistory.length >= 2 ? <InteractiveTrendChart
            key={`${scope}:${mode}`}
            rows={performanceHistory.map((item) => ({ at: item.at, value: item.value, invested: item.invested }))}
            lines={[{ key: 'value', label: 'Portfolio value', color: 'var(--chart-value)' }, { key: 'invested', label: 'Invested capital', color: 'var(--chart-invested)', dashed: true }]}
            valueFormatter={value}
            axisFormatter={axisValue}
            differenceFormatter={value}
            differenceLabel="Value − invested"
            yAxisLabel="Value"
            appearance="insight"
            onReachStart={mode === 'backcast' && backcast ? requestMore : undefined}
          /> : <div className="chart-empty chart-empty--tracking"><i aria-hidden="true" /><strong>{positions.length === 0 ? 'No holdings in this view' : loading ? 'Building your historical series' : settings.allowExternalData ? 'Historical prices are unavailable' : 'External market data is off'}</strong><span>{positions.length === 0 ? 'Select another holding type to see its performance.' : loading ? 'Matching current holdings with historical closes.' : mode === 'tracked' ? 'Tracked balances appear after two market-day snapshots.' : settings.allowExternalData ? 'Use tracked snapshots as they accumulate, or try again later.' : 'Enable it in Settings or use saved tracked balances.'}</span></div>}
        </div>
      </>}
    </section>
  )
}
