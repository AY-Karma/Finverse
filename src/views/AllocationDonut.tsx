import { CHART_COLORS, type ChartColor } from '../chartPalette'
import './allocationDonut.css'

export interface DonutSlice { symbol: string; value: number }
export interface DonutCallout { name: string; weight: string; value: string }

const SLICE_COLORS: ChartColor[] = ['blue', 'green', 'orange', 'pink', 'purple', 'red', 'yellow', 'grey']
const SIZE = 220
const CENTER = SIZE / 2
const OUTER = 94
const INNER = 60
const POP = 5
/** Leader line bends just outside the popped ring, then runs level to just past the chart edge. */
const ELBOW = OUTER + POP + 12
const LINE_OVERHANG = 6

const polar = (radius: number, angle: number) => ({ x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) })

function arcPath(start: number, end: number, outer: number) {
  // A full circle cannot be drawn as one arc; stop just short of closing it.
  const sweep = Math.min(end - start, Math.PI * 2 - 1e-4)
  const large = sweep > Math.PI ? 1 : 0
  const [o1, o2] = [polar(outer, start), polar(outer, start + sweep)]
  const [i1, i2] = [polar(INNER, start + sweep), polar(INNER, start)]
  return `M${o1.x},${o1.y} A${outer},${outer} 0 ${large} 1 ${o2.x},${o2.y} L${i1.x},${i1.y} A${INNER},${INNER} 0 ${large} 0 ${i2.x},${i2.y} Z`
}

/** Angles start at 12 o'clock and run clockwise. */
function sliceAngles(slices: DonutSlice[]) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0) || 1
  let start = -Math.PI / 2
  return slices.map((slice) => {
    const end = start + (Math.max(0, slice.value) / total) * Math.PI * 2
    const angles = { start, end, mid: (start + end) / 2 }
    start = end
    return angles
  })
}

/** Solid allocation donut; on desktop the hovered slice gets a leader-line callout beside the chart, never over it. */
export function AllocationDonut({ slices, active, onActiveChange, callout }: {
  slices: DonutSlice[]
  active: number | null
  onActiveChange: (index: number | null) => void
  callout: DonutCallout | null
}) {
  const angles = sliceAngles(slices)
  const focus = active != null ? angles[active] : undefined
  const side = focus && Math.cos(focus.mid) < 0 ? -1 : 1
  const anchor = focus && polar(OUTER + POP + 3, focus.mid)
  const bend = focus && polar(ELBOW, focus.mid)
  const elbow = bend && { x: bend.x, y: Math.min(SIZE - 8, Math.max(8, bend.y)) }
  const lineEnd = elbow && { x: side > 0 ? SIZE + LINE_OVERHANG : -LINE_OVERHANG, y: elbow.y }

  return (
    <div className="allocation-donut" role="img" aria-label="Portfolio allocation. Hover a segment for details.">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} onPointerLeave={() => onActiveChange(null)}>
        {slices.map((slice, index) => (
          <path key={slice.symbol} d={arcPath(angles[index].start, angles[index].end, OUTER + (active === index ? POP : 0))}
            fill={CHART_COLORS[SLICE_COLORS[index % SLICE_COLORS.length]]}
            className={active != null && active !== index ? 'allocation-donut-slice is-muted' : 'allocation-donut-slice'}
            onPointerEnter={() => onActiveChange(index)} />
        ))}
        {callout && anchor && elbow && lineEnd && <g className="allocation-donut-leader" aria-hidden="true">
          <circle cx={anchor.x} cy={anchor.y} r="2" />
          <path d={`M${anchor.x},${anchor.y} L${elbow.x},${elbow.y} L${lineEnd.x},${lineEnd.y}`} pathLength={1} />
        </g>}
      </svg>
      {callout && lineEnd && (
        <div className={`allocation-callout allocation-callout--${side > 0 ? 'right' : 'left'}`} aria-hidden="true"
          style={{ left: `${(lineEnd.x / SIZE) * 100}%`, top: `${(lineEnd.y / SIZE) * 100}%` }}>
          <span className="allocation-callout-name" title={callout.name}>{callout.name}</span>
          <span className="allocation-callout-figures"><strong>{callout.weight}</strong>{callout.value}</span>
        </div>
      )}
    </div>
  )
}
