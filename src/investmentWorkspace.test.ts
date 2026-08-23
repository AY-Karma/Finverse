import { describe, expect, it } from 'vitest'
import { exportPortfolioCsv, investmentWorkspace } from './investmentWorkspace'
import { sanitizeFolios } from './store'

describe('exposure buckets', () => {
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
