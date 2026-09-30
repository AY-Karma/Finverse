import { describe, expect, it } from 'vitest'
import type { Position } from './types'
import { combinedPositionMembers, combinePositions, computePortfolioStats, portfolioPulse } from './valuation'

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

describe('valuation coverage and merge identity', () => {
  it('calculates P&L only for priced holdings and reports missing coverage', () => {
    const stats = computePortfolioStats([
      position({ ticker: 'PRICED', lastPrice: 120 }),
      position({ ticker: 'UNKNOWN', invested: 1000 }),
    ])
    expect(stats).toMatchObject({ invested: 1100, pricedInvested: 100, currentValue: 120, pnl: 20, pnlPct: 20, pricedCount: 1, unpricedCount: 1, valuationComplete: false })
    expect(stats.allocations).toEqual([{ symbol: 'PRICED', value: 120, type: 'stock' }])
  })

  it('preserves canonical metadata when merging compatible holdings', () => {
    const holding = position({ ticker: '500325', exchange: 'BSE', providerSymbol: '500325.BO', currency: 'INR', instrumentKey: 'EQ:500325', isin: 'INE002A01018', sector: 'Energy', industry: 'Refining', lastPrice: 120 })
    expect(combinePositions([holding, { ...holding, id: 'second', quantity: 2, invested: 200 }])[0]).toMatchObject({ ...holding, id: 'merged:EQ:500325', quantity: 3, invested: 300, buyPrice: 100 })
  })

  it('does not combine conflicting canonical identity fields', () => {
    const holding = position({ ticker: 'SAME', exchange: 'NSE', providerSymbol: 'SAME.NS', currency: 'INR', isin: 'INE000000001' })
    for (const conflict of [{ exchange: 'BSE' as const }, { currency: 'USD' as const }, { providerSymbol: 'DIFFERENT.NS' }, { isin: 'INE000000002' }]) {
      expect(combinePositions([holding, { ...holding, id: 'second', ...conflict }])).toHaveLength(2)
    }
  })
  it('keeps each merged ledger expansion with its compatible source rows', () => {
    const rows = [position({ id: 'nse-a', exchange: 'NSE' }), position({ id: 'nse-b', exchange: 'NSE' }), position({ id: 'bse-a', exchange: 'BSE' }), position({ id: 'bse-b', exchange: 'BSE' })]
    const combined = combinePositions(rows)
    const members = combinedPositionMembers(rows)
    expect(combined).toHaveLength(2)
    expect(members.get(combined[0].id)?.map((row) => row.id)).toEqual(['nse-a', 'nse-b'])
    expect(members.get(combined[1].id)?.map((row) => row.id)).toEqual(['bse-a', 'bse-b'])
  })
})

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
