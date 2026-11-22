import { describe, expect, it } from 'vitest'
import type { Folio, Position } from './types'
import { combinedPositionMembers, combinePositions, computePortfolioStats, gainTone, nativePrice, plusSign, positionPnl, positionsWithStatementDates, quoteKey } from './valuation'

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
    for (const conflict of [{ exchange: 'BSE' as const }, { reportedCurrency: 'EUR' }, { providerSymbol: 'DIFFERENT.NS' }, { isin: 'INE000000002' }]) {
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

  it('excludes unsupported currency cost and value from INR totals rather than adding unlike currencies', () => {
    const inr = position({ ticker: 'INR', currency: 'INR', invested: 100, lastPrice: 120 })
    const foreign = position({ ticker: 'AAPL', exchange: 'NASDAQ', reportedCurrency: 'EUR', invested: 200, lastPrice: 240 })
    const quotes = { [quoteKey(foreign)]: { price: 300, at: 1, source: 'yahoo' as const } }
    expect(computePortfolioStats([inr, foreign], quotes)).toMatchObject({ invested: 100, currentValue: 120, pnl: 20, pricedCount: 1, unpricedCount: 1, valuationComplete: false })
    expect(positionPnl(foreign, quotes)).toBeNull()
    expect(nativePrice(foreign, quotes)).toBe(300)
    expect(nativePrice(foreign)).toBe(240)
    expect(foreign).toMatchObject({ invested: 200, lastPrice: 240 })
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
  })

  it('uses the first imported usable price for undated accounts', () => {
    const folios = [account(first, null), account(second, null)]
    const merged = combinePositions(positionsWithStatementDates(folios))
    expect(merged[0]).toMatchObject({ lastPrice: 120, priceAsOf: null })
    expect(computePortfolioStats(merged).currentValue).toBe(2160)
  })

  it('keeps import order for conflicting prices on the same statement date', () => {
    const folios = [account(first, '2026-10-11'), account(second, '2026-10-11')]
    expect(combinePositions(positionsWithStatementDates(folios))[0].lastPrice).toBe(120)
  })

  it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY])('falls back when the latest statement has an unusable price %s', (lastPrice) => {
    const folios = [account(first, '2026-10-10'), account({ ...second, lastPrice }, '2026-10-11')]
    expect(combinePositions(positionsWithStatementDates(folios))[0]).toMatchObject({ lastPrice: 120, priceAsOf: '2026-10-10' })
  })

  it('prefers a dated zero price over an earlier undated price', () => {
    const folios = [account(first, null), account({ ...second, lastPrice: 0 }, '2026-10-11')]
    expect(combinePositions(positionsWithStatementDates(folios))[0]).toMatchObject({ lastPrice: 0, priceAsOf: '2026-10-11' })
  })

  it('falls back to an undated price when all dated statements lack a usable price', () => {
    const folios = [account(first, null), account({ ...second, lastPrice: null }, '2026-10-11')]
    expect(combinePositions(positionsWithStatementDates(folios))[0]).toMatchObject({ lastPrice: 120, priceAsOf: null })
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

  it('treats invalid statement dates as unknown and keeps incompatible listings separate', () => {
    const invalid = [account(first, '2026-02-30')]
    expect(positionsWithStatementDates(invalid)[0].priceAsOf).toBeNull()
    const incompatible = [account({ ...first, exchange: 'NSE' }, '2026-10-10'), account({ ...second, exchange: 'BSE' }, '2026-10-11')]
    expect(combinePositions(positionsWithStatementDates(incompatible))).toHaveLength(2)
  })
})

describe('gain and loss tone', () => {
  it('keeps zero and unknown amounts neutral and unsigned', () => {
    expect([gainTone(120), gainTone(-0.01), gainTone(0), gainTone(null)]).toEqual(['up', 'down', '', ''])
    expect([plusSign(120), plusSign(0), plusSign(-5)]).toEqual(['+', '', ''])
  })
})
