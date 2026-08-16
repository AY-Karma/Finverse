import { describe, expect, it } from 'vitest'
import { downsampleSeries } from './timeSeries'

describe('downsampleSeries', () => {
  it('keeps both endpoints and the requested sample count', () => {
    expect(downsampleSeries([0, 1, 2, 3, 4, 5], 3)).toEqual([0, 3, 5])
  })

  it('returns short inputs unchanged', () => {
    const rows = [1, 2]
    expect(downsampleSeries(rows, 3)).toBe(rows)
  })
})
