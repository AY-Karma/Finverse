import { useId, useState } from 'react'

export type PreviewSeries = {
  label: string
  color: string
  values: number[]
}

type PreviewChartProps = {
  label: string
  months: string[]
  series: PreviewSeries[]
  formatValue: (value: number) => string
  compact?: boolean
}

const LEFT = 40
const RIGHT = 678
const TOP = 34
const BOTTOM = 208

function chartPoints(values: number[], min: number, max: number) {
  return values.map((value, index) => ({
    x: LEFT + (index / (values.length - 1)) * (RIGHT - LEFT),
    y: BOTTOM - ((value - min) / (max - min)) * (BOTTOM - TOP),
  }))
}

function smoothPath(points: { x: number; y: number }[]) {
  return points.reduce((path, point, index) => {
    if (index === 0) return `M${point.x} ${point.y}`
    const previous = points[index - 1]
    const controlX = (previous.x + point.x) / 2
    return `${path} C${controlX} ${previous.y} ${controlX} ${point.y} ${point.x} ${point.y}`
  }, '')
}

export function LandingPreviewChart({ label, months, series, formatValue, compact = false }: PreviewChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const gradientId = useId()
  const values = series.flatMap((line) => line.values)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const padding = Math.max((high - low) * 0.12, 1)
  const min = low - padding
  const max = high + padding
  const points = series.map((line) => chartPoints(line.values, min, max))
  const firstPath = smoothPath(points[0])
  const activeX = activeIndex === null ? 0 : points[0][activeIndex].x

  return (
    <div className={`preview-chart${compact ? ' preview-chart--compact' : ''}`}>
      <svg
        viewBox="0 0 700 250"
        tabIndex={0}
        aria-label={`${label}. Hover or use arrow keys to inspect sample values.`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          const position = (event.clientX - bounds.left) / bounds.width
          setActiveIndex(Math.max(0, Math.min(months.length - 1, Math.round((position * 700 - LEFT) / (RIGHT - LEFT) * (months.length - 1)))))
        }}
        onPointerLeave={() => setActiveIndex(null)}
        onFocus={() => setActiveIndex((current) => current ?? months.length - 1)}
        onBlur={() => setActiveIndex(null)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          setActiveIndex((current) => Math.max(0, Math.min(months.length - 1, (current ?? months.length - 1) + (event.key === 'ArrowRight' ? 1 : -1))))
        }}
      >
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={series[0].color} stopOpacity=".27"/><stop offset="1" stopColor={series[0].color} stopOpacity="0"/></linearGradient></defs>
        {[42, 94, 146, 198].map((y) => <line key={y} x1={LEFT} x2={RIGHT} y1={y} y2={y} className="chart-grid" />)}
        <path className="chart-area" d={`${firstPath} L${RIGHT} ${BOTTOM} L${LEFT} ${BOTTOM} Z`} fill={`url(#${gradientId})`} />
        {series.map((line, index) => <path key={line.label} className="chart-line" d={smoothPath(points[index])} style={{ stroke: line.color }} />)}
        {activeIndex !== null && <>
          <line className="preview-chart-guide" x1={activeX} x2={activeX} y1={TOP} y2={BOTTOM} />
          {series.map((line, index) => <circle key={line.label} className="preview-chart-point" cx={points[index][activeIndex].x} cy={points[index][activeIndex].y} r="5" fill={line.color} />)}
        </>}
        {[...new Set([0, Math.round((months.length - 1) / 3), Math.round((months.length - 1) * 2 / 3), months.length - 1])].map((index) => (
          <text key={index} x={points[0][index].x} y="242" textAnchor={index === 0 ? 'start' : index === months.length - 1 ? 'end' : 'middle'}>{months[index].toUpperCase()}</text>
        ))}
      </svg>
      {activeIndex !== null && <div className="preview-chart-tooltip" style={{ left: `${Math.max(15, Math.min(78, (activeX / 700) * 100))}%` }}>
        <strong>{months[activeIndex]}</strong>
        {series.map((line) => <span key={line.label}><i style={{ background: line.color }} />{line.label}<b>{formatValue(line.values[activeIndex])}</b></span>)}
      </div>}
    </div>
  )
}
