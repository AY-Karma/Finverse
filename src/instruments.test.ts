import './test/storage'
import { afterEach, describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { listingIdentity, migrateFolioIdentities, normalizePosition } from './instruments'
import { parseSpreadsheetWithDiagnostics } from './spreadsheet'
import { exportPortfolioCsv, investmentWorkspace } from './investmentWorkspace'
import { loadFolios, saveFolios } from './store'
import { combinePositions, computePortfolioStats, quoteKey } from './valuation'
import { resolveYahooSymbol } from './live'
import type { Position } from './types'

afterEach(() => localStorage.clear())

function position(overrides: Partial<Position> = {}): Position {
  return { id: 'row', ticker: 'SAME', name: 'Synthetic holding', type: 'stock', quantity: 10, buyPrice: 100, invested: 1000, lastPrice: 120, ...overrides }
}

function parseRows(rows: unknown[][]): Position[] {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Holdings')
  return parseSpreadsheetWithDiagnostics(XLSX.write(book, { type: 'array', bookType: 'xlsx' })).positions
}

describe('listing identity import', () => {
  it('preserves the audited BSE scrip and Financials sector through parsing, persistence and CSV reimport', () => {
    const [holding] = parseRows([
      ['Symbol', 'Quantity', 'Average Price', 'Last Price', 'Exchange', 'Sector', 'Industry', 'Currency', 'Provider Symbol', 'ISIN'],
      ['500112', 10, 100, 120, 'BSE', 'Financials', 'Banking', 'INR', '500112.BO', 'INE000000001'],
    ])
    expect(holding).toMatchObject({ ticker: '500112', exchange: 'BSE', exchangeSource: 'explicit', currency: 'INR', providerSymbol: '500112.BO', sector: 'Financials', industry: 'Banking', identityVersion: 2 })
    expect(holding.identityIssue).toBeUndefined()
    expect(resolveYahooSymbol(holding)).toBe('500112.BO')
    const folios = [{ id: 'account', name: 'Account', importedAt: 1, positions: [holding] }]
    expect(saveFolios(folios)).toBe(true)
    expect(loadFolios()[0].positions[0]).toMatchObject(holding)
    const csv = exportPortfolioCsv([holding])
    const [reimported] = parseSpreadsheetWithDiagnostics(new TextEncoder().encode(csv).buffer as ArrayBuffer).positions
    expect(reimported).toMatchObject({ exchange: 'BSE', exchangeSource: 'explicit', providerSymbol: '500112.BO', sector: 'Financials', industry: 'Banking', isin: holding.isin, currency: 'INR' })
    expect(listingIdentity(reimported)).toBe(listingIdentity(holding))
    expect(investmentWorkspace.readSnapshot({ folios, quotes: {}, fxRate: null }).sectors[0]).toMatchObject({ label: 'Financials', value: 1200 })
  })

  it('retains unsupported venue and currency text for review without requesting NSE prices', () => {
    const holdings = parseRows([
      ['Ticker', 'Qty', 'Average cost', 'Current price', 'Venue', 'Quote currency'],
      ['EXAMPLE', 1, 100, 120, 'UNKNOWN-EXCHANGE', 'INR'],
      ['OTHER', 2, 100, 120, 'NSE', 'EUR'],
    ])
    expect(holdings[0]).toMatchObject({ exchange: 'OTHER', reportedExchange: 'UNKNOWN-EXCHANGE', lastPrice: 120 })
    expect(holdings[1]).toMatchObject({ reportedCurrency: 'EUR', lastPrice: 120 })
    expect(holdings.every((holding) => Boolean(holding.identityIssue))).toBe(true)
    expect(holdings.map(resolveYahooSymbol)).toEqual([null, null])
    expect(computePortfolioStats(holdings)).toMatchObject({ invested: 100, currentValue: 120, valuationComplete: false, unpricedCount: 1 })
  })

  it('keeps company names and ISIN-only rows unresolved and reserves NSE inference for ordinary tickers', () => {
    const [name] = parseRows([['Name', 'Quantity', 'Average Price'], ['INFOSYS', 1, 100]])
    const [isin] = parseRows([['ISIN', 'Quantity', 'Average Price'], ['INE000000001', 1, 100]])
    const [numeric] = parseRows([['Symbol', 'Quantity', 'Average Price'], ['500112', 1, 100]])
    const [ticker] = parseRows([['Symbol', 'Quantity', 'Average Price'], ['INFY', 1, 100]])
    expect([name, isin, numeric].map(resolveYahooSymbol)).toEqual([null, null, null])
    expect([name, isin, numeric].every((holding) => Boolean(holding.identityIssue))).toBe(true)
    expect(ticker).toMatchObject({ exchange: 'NSE', exchangeSource: 'inferred', providerSymbol: 'INFY.NS' })
    expect(ticker.identityIssue).toBeUndefined()
  })

  it('keeps incompatible listings and missing identities separate despite old shared equity keys', () => {
    const holdings = [
      normalizePosition(position({ id: 'nse', exchange: 'NSE', isin: 'INE000000001', instrumentKey: 'EQ:SAME' })),
      normalizePosition(position({ id: 'bse', exchange: 'BSE', providerSymbol: '500001.BO', isin: 'INE000000001', instrumentKey: 'EQ:SAME' })),
      normalizePosition(position({ id: 'isin-conflict', exchange: 'NSE', isin: 'INE000000002', instrumentKey: 'EQ:SAME' })),
      normalizePosition(position({ id: 'provider-conflict', exchange: 'NSE', providerSymbol: 'DIFFERENT.NS', instrumentKey: 'EQ:SAME' })),
    ]
    expect(new Set(holdings.map(quoteKey)).size).toBe(4)
    expect(combinePositions(holdings)).toHaveLength(4)
    const unresolved = ['one', 'two'].map((id) => normalizePosition(position({ id, ticker: 'Unknown company' })))
    expect(combinePositions(unresolved)).toHaveLength(2)
  })

  it('does not use a provider symbol on another venue or quote currency', () => {
    expect(resolveYahooSymbol(position({ exchange: 'BSE', providerSymbol: 'SAME.NS' }))).toBeNull()
    expect(resolveYahooSymbol(position({ exchange: 'NSE', currency: 'USD' }))).toBeNull()
    expect(resolveYahooSymbol(position({ exchange: 'NSE', providerSymbol: 'SAME.PA' }))).toBeNull()
  })

  it('preserves saved MF mappings and unsupported currency amounts in CSV', () => {
    const holdings = [
      normalizePosition(position({ id: 'usd', ticker: 'AAPL', exchange: 'NASDAQ', currency: 'USD', quantity: 1, invested: 100, providerSymbol: 'AAPL' })),
      normalizePosition(position({ id: 'fund', ticker: 'Imported alias', name: 'Imported alias', type: 'mutual-fund', mfScheme: { code: 2, name: 'Example Equity Fund Direct IDCW', source: 'confirmed' } })),
    ]
    const imported = parseSpreadsheetWithDiagnostics(new TextEncoder().encode(exportPortfolioCsv(holdings)).buffer as ArrayBuffer).positions
    expect(imported[0]).toMatchObject({ currency: 'USD', invested: 100, exchange: 'NASDAQ', providerSymbol: 'AAPL' })
    expect(imported[1]).toMatchObject({ mfScheme: holdings[1].mfScheme, instrumentKey: 'MF:mfapi:2', name: 'Imported alias' })
  })

  it('marks legacy metadata for review, including previous revisions, without guessing a lost BSE venue', () => {
    const legacy = position({ ticker: '500112', exchange: 'NSE', providerSymbol: '500112.NS', instrumentKey: 'EQ:500112' })
    const folios = [{ id: 'account', name: 'Account', importedAt: 1, positions: [legacy], previousRevision: { statement: { id: 'previous', fileName: 'previous.csv', statementDate: null, completeness: 'unknown' as const }, importedAt: 0, positions: [{ ...legacy, id: 'previous' }] } }]
    const [migrated] = migrateFolioIdentities(folios)
    expect(migrated.positions[0]).toMatchObject({ exchange: 'NSE', exchangeSource: 'inferred', providerSymbol: '500112.NS', identityVersion: 2 })
    expect(migrated.positions[0].identityIssue).toBeTruthy()
    expect((migrated as typeof folios[number]).previousRevision.positions[0].identityIssue).toBeTruthy()
    expect(legacy.instrumentKey).toBe('EQ:500112')
    expect(migrateFolioIdentities([migrated])).toEqual([migrated])
  })

  it('repairs legacy other equities consistently while preserving reviewed other holdings', () => {
    const legacy = position({ type: 'other', exchange: 'NSE', providerSymbol: 'SAME.NS' })
    const reviewed = { ...legacy, identityVersion: 2 as const }
    expect(normalizePosition(legacy).type).toBe('stock')
    expect(normalizePosition(reviewed).type).toBe('other')
    const [migrated] = migrateFolioIdentities([{ id: 'account', name: 'Account', importedAt: 1, positions: [legacy, { ...reviewed, id: 'reviewed' }] }])
    expect(saveFolios([migrated])).toBe(true)
    expect(loadFolios()[0].positions.map((holding) => holding.type)).toEqual(['stock', 'other'])
  })
})
