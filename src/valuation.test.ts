import { describe, expect, it } from 'vitest'
import type { Folio, Position } from './types'
import { combinedPositionMembers, combinePositions, computePortfolioStats, importedPriceWarnings, nativePrice, portfolioPulse, positionPnl, positionsWithStatementDates, quoteKey } from './valuation'

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
  it('preserves imported fund XIRR on one row and leaves merged XIRR unavailable', () => {
    const first = position({ type: 'mutual-fund', ticker: 'Fund', xirr: 12 })
    const second = { ...first, id: 'second', invested: 900, xirr: 24 }
    expect(combinePositions([first])[0].xirr).toBe(12)
    expect(combinePositions([first, second])[0].xirr).toBeNull()
    expect(combinedPositionMembers([first, second]).values().next().value?.map((row) => row.xirr)).toEqual([12, 24])
  })

  it('calculates P&L only for priced holdings and reports missing coverage', () => {
    const stats = computePortfolioStats([
      position({ ticker: 'PRICED', lastPrice: 120 }),
      position({ ticker: 'UNKNOWN', invested: 1000 }),
    ])
    expect(stats).toMatchObject({ invested: 1100, pricedInvested: 100, currentValue: 120, pnl: 20, pnlPct: 20, pricedCount: 1, unpricedCount: 1, valuationComplete: false })
    expect(stats.allocations).toEqual([{ symbol: 'PRICED', value: 120, type: 'stock' }])
  })

  it('preserves canonical metadata when merging compatible holdings', () => {
    const holding = position({ ticker: '500325', exchange: 'BSE', providerSymbol: 'RELIANCE.BO', currency: 'INR', instrumentKey: 'EQ:500325', isin: 'INE002A01018', sector: 'Energy', industry: 'Refining', lastPrice: 120 })
    expect(combinePositions([holding, { ...holding, id: 'second', quantity: 2, invested: 200 }])[0]).toMatchObject({ ...holding, instrumentKey: quoteKey(holding), id: `merged:${quoteKey(holding)}`, quantity: 3, invested: 300, buyPrice: 100 })
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

  it('excludes native USD cost and value from INR totals rather than adding unlike currencies', () => {
    const inr = position({ ticker: 'INR', currency: 'INR', invested: 100, lastPrice: 120 })
    const usd = position({ ticker: 'AAPL', exchange: 'NASDAQ', currency: 'USD', invested: 200, lastPrice: 240 })
    const quotes = { [quoteKey(usd)]: { price: 300, at: 1, source: 'yahoo' as const } }
    expect(computePortfolioStats([inr, usd], quotes)).toMatchObject({ invested: 100, currentValue: 120, pnl: 20, pricedCount: 1, unpricedCount: 1, valuationComplete: false })
    expect(positionPnl(usd, quotes)).toBeNull()
    expect(nativePrice(usd, quotes)).toBe(300)
    expect(nativePrice(usd)).toBe(240)
    expect(usd).toMatchObject({ invested: 200, lastPrice: 240 })
  })
})

describe('imported price selection', () => {
  const first = position({ id: 'first', ticker: 'HDFCBANK', quantity: 10, invested: 1000, lastPrice: 120 })
  const second = position({ ...first, id: 'second', quantity: 8, invested: 800, lastPrice: 130 })
  const account = (row: Position, date: string | null): Folio => ({
    id: row.id, name: row.id, importedAt: 1, positions: [row],
    statement: { id: row.id, fileName: `${row.id}.csv`, statementDate: date, completeness: 'complete' },
  })

  it('uses the latest statement price across compatible accounts and keeps live quote precedence', () => {
    const folios = [account(first, '2026-10-10'), account(second, '2026-10-11')]
    const merged = combinePositions(positionsWithStatementDates(folios))
    expect(merged[0]).toMatchObject({ quantity: 18, invested: 1800, buyPrice: 100, lastPrice: 130, priceAsOf: '2026-10-11' })
    expect(combinePositions(positionsWithStatementDates([...folios].reverse()))[0].lastPrice).toBe(130)
    expect(computePortfolioStats(merged)).toMatchObject({ currentValue: 2340, invested: 1800 })
    expect(computePortfolioStats(merged, { [quoteKey(merged[0])]: { price: 140, at: 1, source: 'yahoo' } }).currentValue).toBe(2520)
    expect(importedPriceWarnings(folios)[0]).toContain('imported prices differ across active accounts')
    expect(importedPriceWarnings(folios)[0]).toContain('statement dated 2026-10-11')
  })

  it('uses the first imported usable price for undated accounts and discloses the uncertainty', () => {
    const folios = [account(first, null), account(second, null)]
    const merged = combinePositions(positionsWithStatementDates(folios))
    expect(merged[0]).toMatchObject({ lastPrice: 120, priceAsOf: null })
    expect(computePortfolioStats(merged).currentValue).toBe(2160)
    expect(importedPriceWarnings(folios)).toEqual([expect.stringContaining('2 usable imported prices have no statement date')])
    expect(importedPriceWarnings(folios)[0]).toContain('Using the first imported usable price')
  })

  it('keeps import order for conflicting prices on the same statement date and warns', () => {
    const folios = [account(first, '2026-10-11'), account(second, '2026-10-11')]
    expect(combinePositions(positionsWithStatementDates(folios))[0].lastPrice).toBe(120)
    expect(importedPriceWarnings(folios)).toEqual([expect.stringContaining('imported prices conflict on statement date 2026-10-11')])
    expect(importedPriceWarnings(folios)[0]).toContain('Using the first imported usable price')
  })

  it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY])('falls back when the latest statement has an unusable price %s and explains it', (lastPrice) => {
    const folios = [account(first, '2026-10-10'), account({ ...second, lastPrice }, '2026-10-11')]
    expect(combinePositions(positionsWithStatementDates(folios))[0]).toMatchObject({ lastPrice: 120, priceAsOf: '2026-10-10' })
    expect(importedPriceWarnings(folios)[0]).toContain('the latest statement dated 2026-10-11 has no usable price')
    expect(importedPriceWarnings(folios)[0]).toContain('statement dated 2026-10-10')
  })

  it('prefers a dated zero price over an earlier undated price', () => {
    const folios = [account(first, null), account({ ...second, lastPrice: 0 }, '2026-10-11')]
    expect(combinePositions(positionsWithStatementDates(folios))[0]).toMatchObject({ lastPrice: 0, priceAsOf: '2026-10-11' })
    expect(importedPriceWarnings(folios)[0]).toContain('1 usable imported price has no statement date')
  })

  it('falls back to an undated price when all dated statements lack a usable price', () => {
    const folios = [account(first, null), account({ ...second, lastPrice: null }, '2026-10-11')]
    expect(combinePositions(positionsWithStatementDates(folios))[0]).toMatchObject({ lastPrice: 120, priceAsOf: null })
    expect(importedPriceWarnings(folios)[0]).toContain('the latest statement dated 2026-10-11 has no usable price')
  })

  it('preserves reviewed MF mappings while choosing the latest compatible account price', () => {
    const mfScheme = { code: 43, name: 'Reviewed direct growth fund', source: 'confirmed' as const }
    const folios = [
      account({ ...first, type: 'mutual-fund', name: 'Imported fund alias', mfScheme }, '2026-10-10'),
      account({ ...second, type: 'mutual-fund', name: 'Reviewed direct growth fund', mfScheme }, '2026-10-11'),
    ]
    expect(combinePositions(positionsWithStatementDates(folios))).toEqual([expect.objectContaining({
      quantity: 18, lastPrice: 130, priceAsOf: '2026-10-11', mfScheme, instrumentKey: 'MF:mfapi:43',
    })])
  })

  it('treats invalid statement dates as unknown and does not warn about incompatible listings', () => {
    const invalid = [account(first, '2026-02-30')]
    expect(positionsWithStatementDates(invalid)[0].priceAsOf).toBeNull()
    expect(importedPriceWarnings(invalid)[0]).toContain('no statement date')
    const incompatible = [account({ ...first, exchange: 'NSE' }, '2026-10-10'), account({ ...second, exchange: 'BSE' }, '2026-10-11')]
    expect(importedPriceWarnings(incompatible)).toEqual([])
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
