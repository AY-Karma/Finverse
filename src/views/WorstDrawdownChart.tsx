import { useId } from 'react'
import type { calculatePortfolioRisk } from '../portfolioRisk'
import './WorstDrawdownChart.css'

const DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const PLOT_LEFT = 64
const PLOT_RIGHT = 350
const PLOT_TOP = 30
const PLOT_BOTTOM = 176
const DROP_X = 380

interface WorstDrawdownChartProps {
  points: readonly { at: number; value: number }[]
  risk: ReturnType<typeof calculatePortfolioRisk>
  formatValue: (amount: number) => string
}

export function WorstDrawdownChart({ points, risk, formatValue }: WorstDrawdownChartProps) {
  const chartId = useId()
  const observations = points.filter((point) => Number.isFinite(point.value) && Number.isFinite(new Date(point.at).getTime()))

  if (observations.length < 2) {
    return <p className="worst-drawdown-empty">At least two historical observations are needed to show a drawdown.</p>
  }
  if (risk.worst === 0) {
    return <p className="worst-drawdown-empty">No decline from an earlier peak in the available history.</p>
  }

  const peakIndex = observations.findIndex((point) => point.at === risk.worstPeakAt)
  const troughIndex = observations.findIndex((point, index) => index > peakIndex && point.at === risk.worstAt)
  const peak = observations[peakIndex]
  const trough = observations[troughIndex]
  if (!peak || !trough || peak.value <= 0 || trough.value >= peak.value || trough.at <= peak.at || !Number.isFinite(risk.worst)) {
    return <p className="worst-drawdown-empty">Peak and trough observations are unavailable for this drawdown.</p>
  }

  const interval = observations.slice(peakIndex, troughIndex + 1)
  const drop = Math.abs(risk.worst)
  const peakDate = DATE_FORMATTER.format(new Date(peak.at))
  const troughDate = DATE_FORMATTER.format(new Date(trough.at))
  const peakValue = formatValue(peak.value)
  const troughValue = formatValue(trough.value)
  const xAt = (at: number) => PLOT_LEFT + (at - peak.at) / (trough.at - peak.at) * (PLOT_RIGHT - PLOT_LEFT)
  const yAt = (value: number) => PLOT_TOP + ((peak.value - value) / peak.value * 100) / drop * (PLOT_BOTTOM - PLOT_TOP)
  const path = interval.map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(point.at).toFixed(2)},${yAt(point.value).toFixed(2)}`).join(' ')
  const areaPath = `${path} L${PLOT_RIGHT},${PLOT_TOP} Z`
  const percentage = `${risk.worst.toFixed(1)}%`

  return <figure className="worst-drawdown-chart">
    <div className="worst-drawdown-chart-header">
      <span>Change from peak (%)</span>
      <strong>{drop.toFixed(1)}% fall</strong>
    </div>
    <svg className="worst-drawdown-plot" viewBox="0 0 480 206" role="img" aria-labelledby={`${chartId}-title`} aria-describedby={`${chartId}-description`}>
      <title id={`${chartId}-title`}>{`Worst drawdown of ${percentage}`}</title>
      <desc id={`${chartId}-description`}>Portfolio value relative to its peak, measured in percent. The peak was {peakValue} on {peakDate}. The trough was {troughValue} on {troughDate}, a {drop.toFixed(1)}% fall. The line shows every historical observation between these two points.</desc>
      {[0, -drop / 2, -drop].map((tick, index) => {
        const y = PLOT_TOP + index / 2 * (PLOT_BOTTOM - PLOT_TOP)
        return <g key={index}>
          <line className="worst-drawdown-grid" x1={PLOT_LEFT} x2={DROP_X} y1={y} y2={y} />
          <text className="worst-drawdown-axis" x={PLOT_LEFT - 12} y={y + 4} textAnchor="end">{tick.toFixed(1)}%</text>
        </g>
      })}
      <path className="worst-drawdown-area" d={areaPath} />
      <path className="worst-drawdown-line" d={path} />
      <circle className="worst-drawdown-point worst-drawdown-point--peak" cx={PLOT_LEFT} cy={yAt(peak.value)} r="5">
        <title>{`Peak: ${peakValue}, ${peakDate}, 0.0% baseline`}</title>
      </circle>
      <circle className="worst-drawdown-point worst-drawdown-point--trough" cx={PLOT_RIGHT} cy={yAt(trough.value)} r="5">
        <title>{`Trough: ${troughValue}, ${troughDate}, ${percentage} from peak`}</title>
      </circle>
      <path className="worst-drawdown-drop" d={`M${DROP_X},${PLOT_TOP} V${PLOT_BOTTOM} m-5,-7 l5,7 l5,-7`} />
      <text className="worst-drawdown-annotation" x={DROP_X + 14} y={(PLOT_TOP + PLOT_BOTTOM) / 2 - 2}>
        <tspan>{percentage}</tspan>
        <tspan className="worst-drawdown-annotation-label" x={DROP_X + 14} dy="18">from peak</tspan>
      </text>
    </svg>
    <figcaption>
      <div className="worst-drawdown-endpoints">
        <div className="worst-drawdown-endpoint">
          <span className="worst-drawdown-endpoint-label">Peak <span>0.0%</span></span>
          <strong>{peakValue}</strong>
          <time dateTime={new Date(peak.at).toISOString()}>{peakDate}</time>
        </div>
        <div className="worst-drawdown-endpoint worst-drawdown-endpoint--trough">
          <span className="worst-drawdown-endpoint-label">Trough <span>{percentage}</span></span>
          <strong>{troughValue}</strong>
          <time dateTime={new Date(trough.at).toISOString()}>{troughDate}</time>
        </div>
      </div>
      <p className="worst-drawdown-basis">Today's holdings at historical prices. The percentage fall is the value lost divided by the peak value.</p>
    </figcaption>
  </figure>
}
