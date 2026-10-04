import { describe, expect, it } from 'vitest'
import type { LiveQuote, Position } from './types'
import { exportPortfolioCsv, importIdentitySummary, investmentWorkspace } from './investmentWorkspace'
import { sanitizeFolios } from './store'

describe('quote coverage and session movement', () => {
  const positions: Position[] = ['A', 'B'].map((ticker) => ({
    id: ticker, ticker, name: ticker, type: 'stock', quantity: 2, buyPrice: 100, invested: 200, lastPrice: 100,
  }))
  const at = Date.parse('2026-10-01T10:00:00Z')
  const quote = (patch: Partial<LiveQuote> = {}): LiveQuote => ({ price: 110, change: 10, at, source: 'yahoo', ...patch })
  const read = (quotes: Record<string, LiveQuote>) => investmentWorkspace.readSnapshot({
    folios: [{ id: 'f', name: 'Portfolio', importedAt: 1, positions }], quotes, fxRate: null,
  })

  it('withholds whole-portfolio movement and return when only one holding reports a change', () => {
    const snapshot = read({ 'EQ:A': quote() })
    expect(snapshot.dailyChange).toBeNull()
    expect(snapshot.dailyChangePct).toBeNull()
    expect(snapshot.dailyChangeCount).toBe(1)
    expect(snapshot.dailyChangeDate).toBe('2026-10-01')
    expect(snapshot.quotedCount).toBe(1)
  })

  it('calculates a complete same-session change from quantities and previous values', () => {
    const snapshot = read({ 'EQ:A': quote(), 'EQ:B': quote({ price: 95, change: -5 }) })
    expect(snapshot.dailyChange).toBe(10)
    expect(snapshot.dailyChangePct).toBe(2.5)
    expect(snapshot.dailyChangeCount).toBe(2)
    expect(snapshot.dailyChangeDate).toBe('2026-10-01')
  })

  it('does not combine changes from different session dates or plot an older mover in the latest session', () => {
    const snapshot = read({ 'EQ:A': quote(), 'EQ:B': quote({ at: Date.parse('2026-09-30T10:00:00Z') }) })
    expect(snapshot.dailyChange).toBeNull()
    expect(snapshot.dailyChangePct).toBeNull()
    expect(snapshot.dailyChangeCount).toBe(1)
    expect(snapshot.contributions.find((item) => item.symbol === 'B')?.dailyPriceChange).toBeNull()
  })

  it('uses the IST date at the midnight boundary and accepts reported zero changes', () => {
    const snapshot = read({
      'EQ:A': quote({ at: Date.parse('2026-10-01T18:45:00Z'), change: 0 }),
      'EQ:B': quote({ at: Date.parse('2026-10-02T01:00:00Z'), change: 0 }),
    })
    expect(snapshot.dailyChangeDate).toBe('2026-10-02')
    expect(snapshot.dailyChange).toBe(0)
    expect(snapshot.dailyChangePct).toBe(0)
  })

  it('ignores quotes for removed holdings in freshness, timestamps, and coverage', () => {
    const snapshot = read({ 'EQ:REMOVED': quote({ at: 1 }) })
    expect(snapshot.staleQuotes).toBe(0)
    expect(snapshot.lastUpdatedAt).toBeNull()
    expect(snapshot.quotedCount).toBe(0)
    expect(snapshot.quotes).toEqual({})
  })

  it.each([{ price: Number.NaN }, { at: Number.NaN }, { change: Number.NaN }])('does not claim a complete move with invalid quote data %j', (patch) => {
    const snapshot = read({ 'EQ:A': quote(), 'EQ:B': quote(patch) })
    expect(snapshot.dailyChange).toBeNull()
    expect(snapshot.dailyChangePct).toBeNull()
  })

  it('withholds a percentage when the reported previous portfolio value is zero', () => {
    const snapshot = read({ 'EQ:A': quote({ price: 100, change: 100 }), 'EQ:B': quote({ price: 100, change: 100 }) })
    expect(snapshot.dailyChange).toBe(400)
    expect(snapshot.dailyChangePct).toBeNull()
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
