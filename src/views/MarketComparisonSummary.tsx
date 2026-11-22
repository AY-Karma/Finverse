import { COMPARISON_PERIODS, describeComparison, describeMovement, type ComparisonPeriod } from '../marketComparison'
import './marketComparison.css'

export function ComparisonPeriodSwitch({ period, available, onChange }: {
  period: ComparisonPeriod
  available: Record<ComparisonPeriod, boolean>
  onChange: (period: ComparisonPeriod) => void
}) {
  return (
    <div className="scope-switch comparison-periods" role="group" aria-label="Comparison period">
      {COMPARISON_PERIODS.filter(({ id }) => available[id]).map(({ id, label }) => (
        <button type="button" key={id} className={`scope-btn${period === id ? ' scope-btn--active' : ''}`}
          aria-pressed={period === id} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  )
}

function Movement({ value }: { value: number | null }) {
  if (value == null) return <strong>—</strong>
  const { verb, amount } = describeMovement(value)
  return <strong><span className="comparison-verb">{verb}</span>{verb !== 'was flat' && ` ${amount}`}</strong>
}

/** Holdings and benchmark returns over the chart's window, with the outcome in plain words. */
export function MarketComparisonSummary({ portfolio, benchmark, benchmarkLabel }: {
  portfolio: number
  benchmark: number | null
  benchmarkLabel: string
}) {
  const verdict = benchmark == null ? null : describeComparison(portfolio, benchmark, benchmarkLabel)
  const result = !verdict ? '—' : verdict.points ? `${verdict.points.replace(' points', ' pts')} ${verdict.tone === 'up' ? 'ahead' : 'behind'}` : 'In line'
  return (
    <div className="insight-chart-readout comparison-readout">
      <div className="insight-chart-metric comparison-metric comparison-metric--portfolio">
        <span><i aria-hidden="true" />Your holdings</span>
        <Movement value={portfolio} />
        <small>Today’s holdings at past prices, not your P&amp;L</small>
      </div>
      <div className="insight-chart-metric comparison-metric comparison-metric--benchmark">
        <span><i aria-hidden="true" />{benchmarkLabel}</span>
        <Movement value={benchmark} />
        <small>Same dates</small>
      </div>
      <div className="insight-chart-metric comparison-metric comparison-metric--result">
        <span>Result</span>
        <strong className={verdict?.tone}>{result}</strong>
        <small>{verdict?.text ?? 'Waiting for benchmark'}</small>
      </div>
    </div>
  )
}
