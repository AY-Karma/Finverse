import { describe, expect, it } from 'vitest'
import { clampViewportStart, createChartViewport, shiftViewportStart } from './chartViewport'

describe('chart viewport', () => {
  it('opens on the newest data while keeping a fixed number of points visible', () => {
    expect(createChartViewport(260, 180)).toEqual({ start: 80, count: 180 })
    expect(createChartViewport(20, 180)).toEqual({ start: 0, count: 20 })
  })

  it('clamps movement to the loaded data', () => {
    expect(shiftViewportStart(80, -100, 260, 180)).toBe(0)
    expect(shiftViewportStart(80, 100, 260, 180)).toBe(80)
  })

  it('keeps fractional movement for smooth pointer and wheel panning', () => {
    expect(shiftViewportStart(80, -2.5, 260, 180)).toBe(77.5)
    expect(clampViewportStart(Number.NaN, 260, 180)).toBe(0)
  })
})

