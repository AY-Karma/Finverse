import { CHART_COLORS, type ChartColor } from '../chartPalette'
import './SegmentBar.css'

interface SegmentBarProps {
  segments: { value: number; color: ChartColor }[]
  /** Value that fills the whole track; defaults to the segment total. */
  scale?: number
  className?: string
  ariaLabel?: string
}

/** Solid horizontal bar made of proportional colored segments. */
export function SegmentBar({ segments, scale, className = '', ariaLabel }: SegmentBarProps) {
  const values = segments.map((segment) => Number.isFinite(segment.value) ? Math.max(0, segment.value) : 0)
  const total = scale ?? values.reduce((sum, value) => sum + value, 0)
  return (
    <span className={`segment-bar ${className}`} role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}>
      {Number.isFinite(total) && total > 0 && segments.map((segment, index) => values[index] > 0 && (
        <i key={index} style={{ width: `${Math.min(100, (values[index] / total) * 100)}%`, background: CHART_COLORS[segment.color] }} />
      ))}
    </span>
  )
}
