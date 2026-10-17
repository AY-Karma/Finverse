import { useEffect, useRef } from 'react'
import { backingSize, paintColumn } from '../components/dither-kit/dither-paint'
import { seedOfColor, type DitherColor } from '../components/dither-kit/palette'
import { useChartDimensions } from '../components/dither-kit/use-chart-dimensions'
import './DitherBar.css'

interface DitherBarProps {
  segments: { value: number; color: DitherColor }[]
  scale?: number
  className?: string
  ariaLabel?: string
}

export function DitherBar({ segments, scale, className = '', ariaLabel }: DitherBarProps) {
  const { ref, size } = useChartDimensions<HTMLSpanElement>()
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvas.current
    if (!element || size.width <= 0 || size.height <= 0) return
    const context = element.getContext('2d')
    if (!context) return

    const { cols, rows } = backingSize(size.width, size.height)
    element.width = cols
    element.height = rows
    const values = segments.map((segment) => Number.isFinite(segment.value) ? Math.max(0, segment.value) : 0)
    const total = scale ?? values.reduce((sum, value) => sum + value, 0)
    if (!Number.isFinite(total) || total <= 0) return

    let start = 0
    let accumulated = 0
    segments.forEach((segment, index) => {
      accumulated += values[index]
      const end = Math.min(cols, Math.round(accumulated / total * cols))
      const seed = seedOfColor(segment.color)
      for (let x = start; x < end; x++) {
        paintColumn(context, x, 0, rows, seed, { variant: 'gradient', intensity: 0, dim: 1, stacked: true })
      }
      start = end
    })
  }, [segments, scale, size.width, size.height])

  return (
    <span ref={ref} className={`dither-bar ${className}`} role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}>
      <canvas ref={canvas} aria-hidden="true" />
    </span>
  )
}
