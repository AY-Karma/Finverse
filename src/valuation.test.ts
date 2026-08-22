import { describe, expect, it } from 'vitest'
import type { Position } from './types'
import { portfolioPulse } from './valuation'

function position(overrides: Partial<Position>): Position {
  return {
    id: overrides.ticker ?? 'p',
    ticker: 'P',
    name: 'Position',
    type: 'stock',
    quantity: 1,
    buyPrice: 100,
    lastPrice: null,
    invested: 100,
    ...overrides,
  }
}

describe('portfolioPulse', () => {
  const positions = [
    // Weight 40%, in profit.
    position({ id: 'a', ticker: 'AAA', quantity: 4, lastPrice: 110 }),
    // Weight 40% mutual fund, at a loss. MFs label by scheme name.
    position({ id: 'b', ticker: 'BBB', name: 'Bluechip Fund', type: 'mutual-fund', quantity: 2, lastPrice: 30 }),
    // Weight ~9%, exactly flat on cost.
    position({ id: 'c', ticker: 'CCC', quantity: 1, lastPrice: 50, invested: 50 }),
    // Unpriced: excluded from breadth and bands, counted in the split as zero.
    position({ id: 'd', ticker: 'DDD', quantity: 3, lastPrice: null }),
  ]

  it('counts breadth from priced holdings only', () => {
    const pulse = portfolioPulse(positions)
    expect(pulse.up).toBe(1)
    expect(pulse.down).toBe(1)
    expect(pulse.flat).toBe(1)
  })

  it('splits current value and holding count by asset class', () => {
    const pulse = portfolioPulse(positions)
    expect(pulse.equityValue).toBe(490)
    expect(pulse.mutualValue).toBe(60)
    expect(pulse.equityCount).toBe(3)
    expect(pulse.mutualCount).toBe(1)
  })

  it('summarises returns: averages, best, worst, band weight share', () => {
    const pulse = portfolioPulse(positions)
    expect(pulse.avgWinPct).toBeCloseTo(340) // 440 vs 100 invested
    expect(pulse.avgLossPct).toBeCloseTo(-40) // 60 vs 100 invested
    expect(pulse.best).toEqual({ symbol: 'AAA', pct: 340 })
    expect(pulse.worst).toEqual({ symbol: 'Bluechip Fund', pct: -40 })
    expect(pulse.bandWeight.heavy).toBeCloseTo((440 + 60) / 550 * 100)
    expect(pulse.bandWeight.mid).toBeCloseTo(50 / 550 * 100)
    expect(pulse.bandWeight.light).toBe(0)
    expect(pulse.bandMembers).toEqual({ heavy: ['AAA', 'Bluechip Fund'], mid: ['CCC'], light: [] })
  })

  it('buckets priced holdings into weight bands of the valued total', () => {
    const pulse = portfolioPulse(positions)
    expect(pulse.bands.heavy).toBe(2) // 440/550 and 60/550
    expect(pulse.bands.mid).toBe(1) // 50/550
    expect(pulse.bands.light).toBe(0)
  })

  it('returns zeros for an empty book', () => {
    expect(portfolioPulse([])).toEqual({
      up: 0,
      down: 0,
      flat: 0,
      avgWinPct: null,
      avgLossPct: null,
      best: null,
      worst: null,
      equityValue: 0,
      mutualValue: 0,
      equityCount: 0,
      mutualCount: 0,
      bands: { heavy: 0, mid: 0, light: 0 },
      bandWeight: { heavy: 0, mid: 0, light: 0 },
      bandMembers: { heavy: [], mid: [], light: [] },
    })
  })
})
