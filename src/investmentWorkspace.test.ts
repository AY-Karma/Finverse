import { describe, expect, it } from 'vitest'
import type { Folio, LiveQuote, Position } from './types'
import { exportPortfolioCsv, importIdentitySummary, investmentWorkspace } from './investmentWorkspace'
import { sanitizeFolios } from './store'
import { quoteKey } from './valuation'

describe('quote coverage and session movement', () => {
  const positions: Position[] = ['A', 'B'].map((ticker) => ({
    id: ticker, ticker, name: ticker, type: 'stock', quantity: 2, buyPrice: 100, invested: 200, lastPrice: 100,
  }))
  const [aKey, bKey] = positions.map(quoteKey)
  const at = Date.parse('2026-10-01T10:00:00Z')
  const quote = (patch: Partial<LiveQuote> = {}): LiveQuote => ({ price: 110, change: 10, at, source: 'yahoo', ...patch })
  const read = (quotes: Record<string, LiveQuote>) => investmentWorkspace.readSnapshot({
    folios: [{ id: 'f', name: 'Portfolio', importedAt: 1, positions }], quotes, fxRate: null,
  })

  it('reuses prepared holdings for new quotes and rejects preparation from a replaced account array', () => {
    const folios = [{ id: 'f', name: 'Portfolio', importedAt: 1, positions }]
    const holdings = investmentWorkspace.prepareHoldings(folios)
    const first = investmentWorkspace.readSnapshot({ folios, holdings, quotes: {}, fxRate: null })
    const refreshed = investmentWorkspace.readSnapshot({ folios, holdings, quotes: { [aKey]: quote() }, fxRate: null })
    expect(refreshed.positions).toBe(first.positions)
    expect(refreshed.rawPositions).toBe(first.rawPositions)
    expect(refreshed.currentValue).toBe(420)
    const replacement = [{ ...folios[0], positions: [positions[1]] }]
    const replaced = investmentWorkspace.readSnapshot({ folios: replacement, holdings, quotes: { [aKey]: quote() }, fxRate: null })
    expect(replaced.positions.map((position) => position.id)).toEqual(['B'])
    expect(replaced.currentValue).toBe(200)
    expect(replaced.quotes).toEqual({})
  })

  it('withholds whole-portfolio movement and return when only one holding reports a change', () => {
    const snapshot = read({ [aKey]: quote() })
    expect(snapshot.dailyChange).toBeNull()
    expect(snapshot.dailyChangePct).toBeNull()
    expect(snapshot.dailyChangeCount).toBe(1)
    expect(snapshot).toHaveProperty('reportedDailyChange', 20)
    expect(snapshot.dailyChangeDate).toBe('2026-10-01')
    expect(snapshot.quotedCount).toBe(1)
  })

  it('calculates a complete same-session change from quantities and previous values', () => {
    const snapshot = read({ [aKey]: quote(), [bKey]: quote({ price: 95, change: -5 }) })
    expect(snapshot.dailyChange).toBe(10)
    expect(snapshot).toHaveProperty('reportedDailyChange', 10)
    expect(snapshot.dailyChangePct).toBe(2.5)
    expect(snapshot.dailyChangeCount).toBe(2)
    expect(snapshot.dailyChangeDate).toBe('2026-10-01')
  })

  it('does not combine changes from different session dates or plot an older mover in the latest session', () => {
    const snapshot = read({ [aKey]: quote(), [bKey]: quote({ at: Date.parse('2026-09-30T10:00:00Z') }) })
    expect(snapshot.dailyChange).toBeNull()
    expect(snapshot.dailyChangePct).toBeNull()
    expect(snapshot.dailyChangeCount).toBe(1)
    expect(snapshot).toHaveProperty('reportedDailyChange', 20)
    expect(snapshot.contributions.find((item) => item.symbol === 'B')?.dailyPriceChange).toBeNull()
  })

  it('uses the IST date at the midnight boundary and accepts reported zero changes', () => {
    const snapshot = read({
      [aKey]: quote({ at: Date.parse('2026-10-01T18:45:00Z'), change: 0 }),
      [bKey]: quote({ at: Date.parse('2026-10-02T01:00:00Z'), change: 0 }),
    })
    expect(snapshot.dailyChangeDate).toBe('2026-10-02')
    expect(snapshot.dailyChange).toBe(0)
    expect(snapshot.reportedDailyChange).toBe(0)
    expect(snapshot.dailyChangePct).toBe(0)
  })

  it('ignores quotes for removed holdings in freshness, timestamps, and coverage', () => {
    const snapshot = read({ 'EQ:REMOVED': quote({ at: 1 }) })
    expect(snapshot.staleQuotes).toBe(0)
    expect(snapshot.lastUpdatedAt).toBeNull()
    expect(snapshot.quotedCount).toBe(0)
    expect(snapshot.reportedDailyChange).toBeNull()
    expect(snapshot.quotes).toEqual({})
  })

  it.each([{ price: Number.NaN }, { at: Number.NaN }, { change: Number.NaN }])('does not claim a complete move with invalid quote data %j', (patch) => {
    const snapshot = read({ [aKey]: quote(), [bKey]: quote(patch) })
    expect(snapshot.dailyChange).toBeNull()
    expect(snapshot.dailyChangePct).toBeNull()
  })

  it('withholds a percentage when the reported previous portfolio value is zero', () => {
    const snapshot = read({ [aKey]: quote({ price: 100, change: 100 }), [bKey]: quote({ price: 100, change: 100 }) })
    expect(snapshot.dailyChange).toBe(400)
    expect(snapshot.dailyChangePct).toBeNull()
  })
  it('reports partial INR totals and excludes native USD movement even with a display conversion rate', () => {
    const usd: Position = { id: 'usd', ticker: 'AAPL', name: 'Apple', type: 'stock', exchange: 'NASDAQ', currency: 'USD', providerSymbol: 'AAPL', quantity: 1, buyPrice: 200, invested: 200, lastPrice: 240 }
    const snapshot = investmentWorkspace.readSnapshot({
      folios: [{ id: 'mixed', name: 'Mixed', importedAt: 1, positions: [...positions, usd] }],
      quotes: { [quoteKey(usd)]: quote({ price: 300, change: 100 }) }, fxRate: { usdInr: 90, at: 1 },
    })
    expect(snapshot).toMatchObject({ invested: 400, currentValue: 400, unsupportedCurrencyCount: 1, valuationComplete: false, dailyChange: null })
    expect(snapshot.contributions.find((holding) => holding.symbol === 'AAPL')).toMatchObject({ value: 0, priced: false, dailyChange: null, pnl: null })
    expect(usd).toMatchObject({ invested: 200, lastPrice: 240 })
  })
})

describe('statement price projections', () => {
  const accounts = (): Folio[] => [120, 130].map((lastPrice, index) => ({
    id: `account-${index}`, name: `Account ${index}`, importedAt: 100 - index,
    statement: { id: `statement-${index}`, fileName: `${index}.csv`, statementDate: `2026-10-${10 + index}`, completeness: 'complete' },
    positions: [{ id: `row-${index}`, ticker: 'HDFCBANK', name: 'HDFC Bank', type: 'stock', quantity: index === 0 ? 10 : 8, buyPrice: 100, invested: index === 0 ? 1000 : 800, lastPrice }],
  }))

  it('derives raw statement-date copies and values all active accounts without changing stored positions', () => {
    const folios = accounts()
    const original = structuredClone(folios)
    const snapshot = investmentWorkspace.readSnapshot({ folios, quotes: {}, fxRate: null })
    expect(snapshot).toMatchObject({ invested: 1800, currentValue: 2340, pnl: 540, pricedCount: 1 })
    expect(snapshot.positions[0]).toMatchObject({ quantity: 18, lastPrice: 130, priceAsOf: '2026-10-11' })
    expect(snapshot.rawPositions.map((row) => [row.quantity, row.lastPrice, row.priceAsOf])).toEqual([[10, 120, '2026-10-10'], [8, 130, '2026-10-11']])
    expect(snapshot.rawPositions[0]).not.toBe(folios[0].positions[0])
    expect(folios).toEqual(original)
    expect(folios[0].positions[0]).not.toHaveProperty('priceAsOf')
  })

  it('does not substitute upload time or stored price metadata for an unknown statement date', () => {
    const folios = accounts()
    folios.forEach((folio) => { folio.statement!.statementDate = null })
    folios[1].positions[0].priceAsOf = '2026-10-12'
    const snapshot = investmentWorkspace.readSnapshot({ folios, quotes: {}, fxRate: null })
    expect(snapshot.currentValue).toBe(2160)
    expect(snapshot.positions[0]).toMatchObject({ lastPrice: 120, priceAsOf: null })
    expect(snapshot.rawPositions.every((row) => row.priceAsOf === null)).toBe(true)
    expect(folios[1].positions[0].priceAsOf).toBe('2026-10-12')
  })
})

describe('exposure buckets', () => {
  it('reports only compatible merged rows as duplicates in import preview', () => {
    const holding = { id: 'first', ticker: 'SAME', name: '', type: 'stock' as const, quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120, exchange: 'NSE' as const, isin: 'INE000000001' }
    expect(importIdentitySummary([holding, { ...holding, id: 'same' }]).duplicateCount).toBe(1)
    expect(importIdentitySummary([holding, { ...holding, id: 'conflict', isin: 'INE000000002' }]).duplicateCount).toBe(0)
  })
  it('labels mutual funds as Mutual fund and legacy equities as Equity, never swapped', () => {
    const folios = sanitizeFolios([{
      id: 'folio-1',
      name: 'Portfolio',
      importedAt: 1,
      positions: [
        // Broker export typed this row "EQ"-less; storage promotes it to a stock.
        { id: 'a', ticker: 'TCS', name: 'TCS', type: 'other', quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100, exchange: 'NSE' },
        { id: 'b', ticker: 'INFY', name: 'Infosys', type: 'stock', quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100 },
        // Fund sheets carry scheme categories like "Equity - Large Cap"; that word must not become the bucket label.
        { id: 'c', ticker: 'BCF', name: 'Bluechip Fund Direct Growth', type: 'mutual-fund', quantity: 10, buyPrice: 25, lastPrice: 30, invested: 250, category: 'Equity - Large Cap Fund' },
      ],
    }])
    expect(folios).toHaveLength(1)

    const snapshot = investmentWorkspace.readSnapshot({ folios, quotes: {}, fxRate: { usdInr: 90, at: 1 } })

    const equity = snapshot.sectors.find((sector) => sector.label === 'Equity')
    const funds = snapshot.sectors.find((sector) => sector.label === 'Mutual fund')

    expect(equity).toBeDefined()
    expect(funds).toBeDefined()
    expect(equity?.count).toBe(2)
    expect(equity?.type).toBe('stock')
    expect(funds?.count).toBe(1)
    expect(funds?.type).toBe('mutual-fund')
    expect(snapshot.sectors.some((sector) => sector.label.startsWith('Equity -'))).toBe(false)
  })
})

describe('portfolio CSV export', () => {
  it('neutralizes spreadsheet formulas in imported text fields', () => {
    const csv = exportPortfolioCsv([{
      id: 'formula-row',
      ticker: 'SAFE',
      name: '=HYPERLINK("https://example.test","Open")',
      type: 'stock',
      quantity: 1,
      buyPrice: 100,
      lastPrice: 110,
      invested: 100,
      sector: '\n=SUM(1+1)',
    }])

    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"",""Open"")"')
    expect(csv).toContain('"\'\n=SUM(1+1)"')
  })
})
