import { useState } from 'react'
import type { ChartSpec, Currency } from './types'

const CHART_COLORS = ['#4e8ef7', '#2fd08f', '#f5b73d', '#f2698c', '#a78bfa', '#38cfe0', '#fb923c', '#c084fc']
const WIDTH = 520
const HEIGHT = 240
const PLOT = { left: 58, right: 18, top: 14, bottom: 52 }

function fmtValue(n: number, currency: Currency): string {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(n)
  }
  const abs = Math.abs(n)
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

function chartData(spec: ChartSpec): ChartSpec['data'] {
  const bounded = spec.data
    .filter((row) => row && typeof row.label === 'string' && Number.isFinite(row.value))
    .slice(0, 20)
    .map((row) => ({ label: row.label.slice(0, 120), value: row.value }))
  return bounded.length ? bounded : [{ label: 'No data', value: 0 }]
}

export function ChatChart({ spec, currency = 'INR' }: { spec: ChartSpec; currency?: Currency }) {
  const data = chartData(spec)

  return (
    <div className={`chat-chart${spec.kind === 'pie' ? ' chat-chart--pie' : ''}`}>
      {spec.title && <div className="chat-chart-title">{spec.title}</div>}
      {spec.kind === 'pie' ? (
        <div className="chat-chart-pie">
          <div className="chat-chart-pie-plot">
            <PieGraphic data={data} currency={currency} title={spec.title} />
          </div>
          <DataList data={data} currency={currency} />
        </div>
      ) : (
        <CartesianGraphic data={data} currency={currency} kind={spec.kind} title={spec.title} />
      )}
    </div>
  )
}

function CartesianGraphic({
  data,
  currency,
  kind,
  title,
}: {
  data: ChartSpec['data']
  currency: Currency
  kind: 'bar' | 'line'
  title?: string
}) {
  const [activePoint, setActivePoint] = useState<ChartSpec['data'][number] | null>(null)
  const values = data.map((row) => row.value)
  const rawMin = kind === 'bar' ? Math.min(0, ...values) : Math.min(...values)
  const rawMax = kind === 'bar' ? Math.max(0, ...values) : Math.max(...values)
  const padding = rawMin === rawMax ? Math.max(Math.abs(rawMin) * 0.1, 1) : (rawMax - rawMin) * 0.08
  const minimum = rawMin === rawMax ? rawMin - padding : rawMin
  const maximum = rawMin === rawMax ? rawMax + padding : rawMax
  const range = Math.max(maximum - minimum, 1)
  const plotWidth = WIDTH - PLOT.left - PLOT.right
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom
  const y = (value: number) => PLOT.top + ((maximum - value) / range) * plotHeight
  const zeroY = y(Math.max(minimum, Math.min(maximum, 0)))
  const slot = plotWidth / Math.max(data.length, 1)
  const ticks = Array.from({ length: 4 }, (_, index) => maximum - (range * index) / 3)
  const points = data.map((row, index) => `${PLOT.left + slot * (index + 0.5)},${y(row.value)}`).join(' ')

  return (
    <div className="chat-chart-graphic">
    <svg className="chat-chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title ?? kind} chart`}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={PLOT.left} x2={WIDTH - PLOT.right} y1={y(tick)} y2={y(tick)} className="chat-chart-grid" />
          <text x={PLOT.left - 8} y={y(tick) + 4} textAnchor="end" className="chat-chart-axis">{fmtValue(tick, currency)}</text>
        </g>
      ))}
      {kind === 'bar' ? data.map((row, index) => {
        const valueY = y(row.value)
        const top = Math.min(valueY, zeroY)
        const height = Math.max(Math.abs(zeroY - valueY), 1)
        return (
          <rect
            key={`${row.label}:${index}`}
            x={PLOT.left + slot * index + slot * 0.16}
            y={top}
            width={slot * 0.68}
            height={height}
            rx="4"
            fill={CHART_COLORS[index % CHART_COLORS.length]}
            tabIndex={0}
            onMouseEnter={() => setActivePoint(row)}
            onMouseLeave={() => setActivePoint(null)}
            onFocus={() => setActivePoint(row)}
            onBlur={() => setActivePoint(null)}
            onPointerDown={() => setActivePoint(row)}
          >
            <title>{`${row.label}: ${fmtValue(row.value, currency)}`}</title>
          </rect>
        )
      }) : (
        <>
          <polyline points={points} fill="none" stroke={CHART_COLORS[0]} strokeWidth="2.5" strokeLinejoin="round" />
          {data.map((row, index) => (
            <circle
              key={`${row.label}:${index}`}
              cx={PLOT.left + slot * (index + 0.5)}
              cy={y(row.value)}
              r="4"
              fill={CHART_COLORS[0]}
              tabIndex={0}
              onMouseEnter={() => setActivePoint(row)}
              onMouseLeave={() => setActivePoint(null)}
              onFocus={() => setActivePoint(row)}
              onBlur={() => setActivePoint(null)}
              onPointerDown={() => setActivePoint(row)}
            >
              <title>{`${row.label}: ${fmtValue(row.value, currency)}`}</title>
            </circle>
          ))}
        </>
      )}
      {data.map((row, index) => (
        <text
          key={`label:${row.label}:${index}`}
          x={PLOT.left + slot * (index + 0.5)}
          y={HEIGHT - 22}
          textAnchor={data.length > 6 ? 'end' : 'middle'}
          transform={data.length > 6 ? `rotate(-28 ${PLOT.left + slot * (index + 0.5)} ${HEIGHT - 22})` : undefined}
          className="chat-chart-axis chat-chart-axis--label"
        >
          {row.label.length > 12 ? `${row.label.slice(0, 11)}…` : row.label}
        </text>
      ))}
    </svg>
    {activePoint ? <ChartTooltip point={activePoint} currency={currency} /> : null}
    </div>
  )
}

function PieGraphic({ data, currency, title }: { data: ChartSpec['data']; currency: Currency; title?: string }) {
  const [activePoint, setActivePoint] = useState<ChartSpec['data'][number] | null>(null)
  const values = data.map((row) => Math.max(0, row.value))
  const total = values.reduce((sum, value) => sum + value, 0) || 1
  const radius = 78
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="chat-chart-graphic">
    <svg className="chat-chart-svg" viewBox="0 0 240 240" role="img" aria-label={`${title ?? 'Pie'} chart`}>
      <circle cx="120" cy="120" r={radius} fill="none" className="chat-chart-donut-track" strokeWidth="36" />
      {data.map((row, index) => {
        const length = (values[index] / total) * circumference
        const currentOffset = offset
        offset += length
        return (
          <circle
            key={`${row.label}:${index}`}
            cx="120"
            cy="120"
            r={radius}
            fill="none"
            stroke={CHART_COLORS[index % CHART_COLORS.length]}
            strokeWidth="36"
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-currentOffset}
            transform="rotate(-90 120 120)"
            tabIndex={0}
            onMouseEnter={() => setActivePoint(row)}
            onMouseLeave={() => setActivePoint(null)}
            onFocus={() => setActivePoint(row)}
            onBlur={() => setActivePoint(null)}
            onPointerDown={() => setActivePoint(row)}
          >
            <title>{`${row.label}: ${fmtValue(row.value, currency)}`}</title>
          </circle>
        )
      })}
      <text x="120" y="116" textAnchor="middle" className="chat-chart-donut-label">Total</text>
      <text x="120" y="138" textAnchor="middle" className="chat-chart-donut-value">{fmtValue(data.reduce((sum, row) => sum + row.value, 0), currency)}</text>
    </svg>
    {activePoint ? <ChartTooltip point={activePoint} currency={currency} /> : null}
    </div>
  )
}

function ChartTooltip({ point, currency }: { point: ChartSpec['data'][number]; currency: Currency }) {
  return <div className="chat-chart-tooltip" role="status"><strong>{point.label}</strong><span>{fmtValue(point.value, currency)}</span></div>
}

function DataList({ data, currency }: { data: ChartSpec['data']; currency: Currency }) {
  return (
    <ul className="chat-chart-data">
      {data.map((row, index) => (
        <li key={`${row.label}:${index}`}>
          <i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
          <span className="chat-chart-data-label" title={row.label}>{row.label}</span>
          <span className="chat-chart-data-value">{fmtValue(row.value, currency)}</span>
        </li>
      ))}
    </ul>
  )
}
