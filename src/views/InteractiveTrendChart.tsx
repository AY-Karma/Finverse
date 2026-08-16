import { useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

const DAY_MS = 24 * 60 * 60 * 1000
const FALLBACK_WIDTH = 1000
const FALLBACK_HEIGHT = 340
const PLOT_TOP = 28
const PLOT_RIGHT = 24
const PLOT_BOTTOM = 48
const DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
const DAY_FORMATTER = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' })
const MONTH_FORMATTER = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' })
const TIME_FORMATTER = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' })

export type TrendRow = { at: number } & Record<string, number | undefined>

export interface TrendLine {
  key: string
  label: string
  color: string
  dashed?: boolean
}

interface InteractiveTrendChartProps {
  rows: TrendRow[]
  lines: TrendLine[]
  valueFormatter: (value: number) => string
  yAxisLabel: string
  includeZero?: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeRows(rows: TrendRow[]): TrendRow[] {
  const byTime = new Map<number, TrendRow>()
  for (const row of [...rows].sort((a, b) => a.at - b.at)) {
    if (Number.isFinite(row.at)) byTime.set(row.at, row)
  }
  return Array.from(byTime.values())
}

function niceStep(range: number, targetTicks = 4): number {
  const rough = Math.max(range / targetTicks, Number.EPSILON)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

function yDomain(values: number[], includeZero: boolean): { min: number; max: number; ticks: number[] } {
  let minimum = values.length ? Math.min(...values) : 0
  let maximum = values.length ? Math.max(...values) : 1
  if (includeZero) {
    minimum = Math.min(0, minimum)
    maximum = Math.max(0, maximum)
  }
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.08, 1)
    minimum -= padding
    maximum += padding
  }
  const step = niceStep(maximum - minimum)
  const niceMin = Math.floor(minimum / step) * step
  const niceMax = Math.ceil(maximum / step) * step
  const ticks: number[] = []
  for (let tick = niceMin; tick <= niceMax + step / 2 && ticks.length < 7; tick += step) ticks.push(Number(tick.toPrecision(12)))
  return { min: niceMin, max: niceMax, ticks }
}

function tickIndices(length: number, maximum = 5): number[] {
  if (length <= 1) return [0]
  const count = Math.min(maximum, length)
  return Array.from(new Set(Array.from({ length: count }, (_, index) => Math.round(index * (length - 1) / (count - 1)))))
}

function dateLabel(at: number, span: number): string {
  if (span < 2 * DAY_MS) return TIME_FORMATTER.format(new Date(at))
  if (span > 240 * DAY_MS) return MONTH_FORMATTER.format(new Date(at))
  return DAY_FORMATTER.format(new Date(at))
}

export function InteractiveTrendChart({ rows, lines, valueFormatter, yAxisLabel, includeZero = false }: InteractiveTrendChartProps) {
  const chartId = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [chartSize, setChartSize] = useState({ width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT })
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const updateSize = () => {
      const bounds = svg.getBoundingClientRect()
      const width = Math.max(280, Math.round(bounds.width))
      const height = Math.max(220, Math.round(bounds.height))
      setChartSize((current) => current.width === width && current.height === height ? current : { width, height })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(svg)
    window.addEventListener('resize', updateSize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [])
  const { width: chartWidth, height: chartHeight } = chartSize
  const chartRows = useMemo(() => normalizeRows(rows), [rows])
  const values = useMemo(
    () => chartRows.flatMap((row) => lines.map((line) => row[line.key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))),
    [chartRows, lines],
  )
  const domain = yDomain(values, includeZero)
  const labels = domain.ticks.map(valueFormatter)
  const plotLeft = clamp(Math.max(...labels.map((label) => label.length), yAxisLabel.length) * 6.6 + 22, 68, 132)
  const plotWidth = chartWidth - plotLeft - PLOT_RIGHT
  const plotHeight = chartHeight - PLOT_TOP - PLOT_BOTTOM
  const firstAt = chartRows[0]?.at ?? 0
  const lastAt = chartRows[chartRows.length - 1]?.at ?? firstAt
  const timeSpan = Math.max(lastAt - firstAt, 1)
  const domainRange = Math.max(domain.max - domain.min, 1)
  const xAt = (at: number) => chartRows.length <= 1 ? plotLeft + plotWidth / 2 : plotLeft + ((at - firstAt) / timeSpan) * plotWidth
  const yAt = (value: number) => PLOT_TOP + (1 - (value - domain.min) / domainRange) * plotHeight
  const pathFor = (key: string) => {
    let started = false
    return chartRows.flatMap((row) => {
      const value = row[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        started = false
        return []
      }
      const command = started ? 'L' : 'M'
      started = true
      return [`${command}${xAt(row.at).toFixed(1)},${yAt(value).toFixed(1)}`]
    }).join(' ')
  }
  const primaryLine = lines[0]
  const primaryPoints = primaryLine ? chartRows.filter((row) => typeof row[primaryLine.key] === 'number') : []
  const areaPath = primaryLine && primaryPoints.length > 1
    ? `${pathFor(primaryLine.key)} L${xAt(primaryPoints[primaryPoints.length - 1].at).toFixed(1)},${(PLOT_TOP + plotHeight).toFixed(1)} L${xAt(primaryPoints[0].at).toFixed(1)},${(PLOT_TOP + plotHeight).toFixed(1)} Z`
    : ''
  const secondaryLine = lines[1]
  const pairedPoints = primaryLine && secondaryLine ? chartRows.filter((row) => typeof row[primaryLine.key] === 'number' && typeof row[secondaryLine.key] === 'number') : []
  const differencePath = primaryLine && secondaryLine && pairedPoints.length > 1
    ? `${pairedPoints.map((row, index) => `${index === 0 ? 'M' : 'L'}${xAt(row.at).toFixed(1)},${yAt(row[primaryLine.key] as number).toFixed(1)}`).join(' ')} ${[...pairedPoints].reverse().map((row) => `L${xAt(row.at).toFixed(1)},${yAt(row[secondaryLine.key] as number).toFixed(1)}`).join(' ')} Z`
    : ''
  const hovered = hoveredIndex == null ? null : chartRows[hoveredIndex]
  const hoverX = hovered ? xAt(hovered.at) : 0
  const tooltipLeft = clamp((hoverX / chartWidth) * 100, 8, 92)
  const tooltipTransform = tooltipLeft > 68 ? 'translateX(-100%)' : tooltipLeft < 28 ? 'translateX(0)' : 'translateX(-50%)'
  const latest = chartRows[chartRows.length - 1]
  const latestDifference = primaryLine && secondaryLine && typeof latest?.[primaryLine.key] === 'number' && typeof latest?.[secondaryLine.key] === 'number'
    ? (latest[primaryLine.key] as number) - (latest[secondaryLine.key] as number)
    : null

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    if (chartRows.length === 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * chartWidth
    const targetAt = firstAt + clamp((x - plotLeft) / plotWidth, 0, 1) * timeSpan
    let nearest = 0
    for (let index = 1; index < chartRows.length; index += 1) {
      if (Math.abs(chartRows[index].at - targetAt) < Math.abs(chartRows[nearest].at - targetAt)) nearest = index
    }
    setHoveredIndex(nearest)
  }

  return <div className="interactive-trend-chart">
    <div className="interactive-trend-toolbar">
      <span className="interactive-trend-unit">{yAxisLabel}</span>
      <div className="interactive-trend-legend">{lines.map((line) => {
        const latestValue = latest?.[line.key]
        return <span key={line.key}><i style={{ background: line.color }} /><span>{line.label}</span>{typeof latestValue === 'number' && <strong>{valueFormatter(latestValue)}</strong>}</span>
      })}{latestDifference != null && <span className={latestDifference >= 0 ? 'interactive-trend-difference up' : 'interactive-trend-difference down'}><span>Difference</span><strong>{valueFormatter(latestDifference)}</strong></span>}</div>
    </div>
    <svg ref={svgRef} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label={`${yAxisLabel} trend`} onMouseMove={onMove} onMouseLeave={() => setHoveredIndex(null)}>
      <defs><linearGradient id={`trend-area-${chartId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={primaryLine?.color ?? '#5e6ad2'} stopOpacity="0.22" /><stop offset="100%" stopColor={primaryLine?.color ?? '#5e6ad2'} stopOpacity="0" /></linearGradient></defs>
      {domain.ticks.map((tick) => <g key={tick}><line x1={plotLeft} y1={yAt(tick)} x2={chartWidth - PLOT_RIGHT} y2={yAt(tick)} className={includeZero && Math.abs(tick) < Number.EPSILON ? 'interactive-trend-grid interactive-trend-grid--zero' : 'interactive-trend-grid'} /><text x={plotLeft - 12} y={yAt(tick) + 4} textAnchor="end" className="interactive-trend-axis-text">{valueFormatter(tick)}</text></g>)}
      <line x1={plotLeft} y1={PLOT_TOP} x2={plotLeft} y2={chartHeight - PLOT_BOTTOM} className="interactive-trend-axis" />
      <line x1={plotLeft} y1={chartHeight - PLOT_BOTTOM} x2={chartWidth - PLOT_RIGHT} y2={chartHeight - PLOT_BOTTOM} className="interactive-trend-axis" />
      {tickIndices(chartRows.length).map((index) => <g key={`${chartRows[index]?.at}-${index}`}><line x1={xAt(chartRows[index]?.at ?? firstAt)} y1={chartHeight - PLOT_BOTTOM} x2={xAt(chartRows[index]?.at ?? firstAt)} y2={chartHeight - PLOT_BOTTOM + 5} className="interactive-trend-axis" /><text x={xAt(chartRows[index]?.at ?? firstAt)} y={chartHeight - 18} textAnchor="middle" className="interactive-trend-axis-text">{dateLabel(chartRows[index]?.at ?? firstAt, timeSpan)}</text></g>)}
      {areaPath && <path d={areaPath} fill={`url(#trend-area-${chartId})`} className="interactive-trend-area" />}
      {differencePath && <path d={differencePath} className={latestDifference != null && latestDifference < 0 ? 'interactive-trend-gap interactive-trend-gap--loss' : 'interactive-trend-gap interactive-trend-gap--gain'} />}
      {lines.map((line) => <path key={line.key} d={pathFor(line.key)} className={line.dashed ? 'interactive-trend-line interactive-trend-line--dashed' : 'interactive-trend-line'} stroke={line.color} />)}
      {chartRows.length === 1 && lines.map((line) => {
        const pointValue = chartRows[0][line.key]
        return typeof pointValue === 'number' ? <circle key={line.key} cx={xAt(chartRows[0].at)} cy={yAt(pointValue)} r="5" fill={line.color} className="interactive-trend-dot" /> : null
      })}
      {hovered && <g><line x1={hoverX} y1={PLOT_TOP} x2={hoverX} y2={chartHeight - PLOT_BOTTOM} className="interactive-trend-hover-line" />{lines.map((line) => {
        const value = hovered[line.key]
        return typeof value === 'number' && Number.isFinite(value) ? <circle key={line.key} cx={hoverX} cy={yAt(value)} r="5" fill={line.color} className="interactive-trend-dot" /> : null
      })}</g>}
    </svg>
    {hovered && <div className="interactive-trend-tooltip" style={{ left: `${tooltipLeft}%`, transform: tooltipTransform }}><strong>{DATE_FORMATTER.format(new Date(hovered.at))}{timeSpan < 2 * DAY_MS ? ` · ${TIME_FORMATTER.format(new Date(hovered.at))}` : ''}</strong>{lines.map((line) => typeof hovered[line.key] === 'number' ? <span key={line.key}><i style={{ background: line.color }} />{line.label}<b>{valueFormatter(hovered[line.key] as number)}</b></span> : null)}{primaryLine && secondaryLine && typeof hovered[primaryLine.key] === 'number' && typeof hovered[secondaryLine.key] === 'number' && <span className="interactive-trend-tooltip-difference"><i />Difference<b>{valueFormatter((hovered[primaryLine.key] as number) - (hovered[secondaryLine.key] as number))}</b></span>}</div>}
  </div>
}
