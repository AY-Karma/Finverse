import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { parseSpreadsheetWithDiagnostics } from './spreadsheet'

function parsePositions(file: ArrayBuffer) {
  return parseSpreadsheetWithDiagnostics(file).positions
}

function workbook(sheets: unknown[][][], bookType: 'xlsx' | 'biff8' = 'xlsx', sheetNames?: string[]): ArrayBuffer {
  const book = XLSX.utils.book_new()
  sheets.forEach((rows, index) => {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetNames?.[index] ?? `Sheet${index + 1}`)
  })
  return XLSX.write(book, { type: 'array', bookType }) as ArrayBuffer
}

describe('holdings spreadsheet import', () => {
  it.each(['xlsx', 'biff8'] as const)('preserves native Excel percentage XIRRs in %s without guessing from magnitude', (bookType) => {
    const book = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([])
    XLSX.utils.sheet_add_aoa(sheet, [
      ['Scheme Name', 'Units', 'Invested Value', 'XIRR'],
      ['Native percent', 1, 100, { t: 'n', v: 0.123456, z: '0.00%' }],
      ['Negative percent', 1, 100, { t: 'n', v: -0.08, z: '0%' }],
      ['Plain points', 1, 100, 12],
      ['Small points', 1, 100, 0.12],
      ['Text percent', 1, 100, '12%'],
      ['Literal percent', 1, 100, { t: 'n', v: 0.12, z: '0.00"%"' }],
    ], { origin: 'C5' })
    XLSX.utils.book_append_sheet(book, sheet, 'Funds')
    const positions = parsePositions(XLSX.write(book, { type: 'array', bookType }))
    expect(positions.map((position) => position.xirr)).toEqual([12.3456, -8, 12, 0.12, 12, 0.12])
  })

  it('reads Kite quantities without using discrepant, long-term or pledged quantity columns', () => {
    const result = parseSpreadsheetWithDiagnostics(workbook([[
      ['Symbol', 'ISIN', 'Sector', 'Quantity Available', 'Quantity Discrepant', 'Quantity Long Term', 'Quantity Pledged (Margin)', 'Quantity Pledged (Loan)', 'Average Price', 'Previous Closing Price', 'Unrealized P&L', 'Unrealized P&L Pct.'],
      ['EXAMPLE', 'INE000000001', 'Example sector', 10, 2, 5, 3, 1, 100, 120, 200, 20],
    ]]))
    expect(result.positions).toHaveLength(1)
    expect(result.positions[0]).toMatchObject({ ticker: 'EXAMPLE', isin: 'INE000000001', type: 'stock', quantity: 10, buyPrice: 100, lastPrice: 120, invested: 1000 })
    expect(result.rejectedCount).toBe(0)
  })

  it.each(['xlsx', 'biff8'] as const)('imports the default Kite %s report once using Combined', (format) => {
    const header = ['Symbol', 'ISIN', 'Instrument Type', 'Quantity Available', 'Average Price', 'Previous Closing Price']
    const equity = ['EXAMPLE', 'INE000000001', '-', 10, 100, 120]
    const result = parseSpreadsheetWithDiagnostics(workbook([
      [['Client ID', 'EXAMPLE-CLIENT'], ...Array.from({ length: 20 }, () => []), header, equity],
      [header],
      [['Holdings report'], [], header, equity],
    ], format, ['Equity', 'Mutual Funds', 'Combined']))
    expect(result.positions).toHaveLength(1)
    expect(result.positions[0]).toMatchObject({ ticker: 'EXAMPLE', type: 'stock', quantity: 10, invested: 1000, lastPrice: 120 })
    expect(result.rejectedCount).toBe(0)
  })

  it('keeps Kite fund and ETF types and preserves rows from unrelated sheets', () => {
    const header = ['Symbol', 'ISIN', 'Instrument Type', 'Quantity Available', 'Average Price', 'Previous Closing Price']
    const positions = parsePositions(workbook([
      [header, ['EXAMPLE FUND', 'INF000000001', 'MF', 2, 100, 120], ['EXAMPLE ETF', 'INF000000002', 'Exchange Traded Fund', 3, 100, 120]],
      [['Symbol', 'Quantity', 'Buy Price'], ['EXAMPLE ETF', 3, 100]],
    ], 'xlsx', ['Combined', 'Other folio']))
    expect(positions.map(({ ticker, type }) => ({ ticker, type }))).toEqual([
      { ticker: 'EXAMPLE FUND', type: 'mutual-fund' },
      { ticker: 'EXAMPLE ETF', type: 'etf' },
      { ticker: 'EXAMPLE ETF', type: 'stock' },
    ])
  })

  it.each([false, true])('uses Kite category sheets when Combined has no holdings or is absent: %s', (emptyCombined) => {
    const header = ['Symbol', 'ISIN', 'Instrument Type', 'Quantity Available', 'Average Price', 'Previous Closing Price']
    const sheets = [[header, ['EXAMPLE', 'INE000000001', '-', 10, 100, 120]], [header, ['EXAMPLE FUND', 'INF000000001', '-', 2, 100, 120]]]
    const names = ['Equity', 'Mutual Funds']
    if (emptyCombined) { sheets.push([header]); names.push('Combined') }
    const positions = parsePositions(workbook(sheets, 'xlsx', names))
    expect(positions.map(position => position.type)).toEqual(['stock', 'mutual-fund'])
    expect(positions.map(position => position.quantity)).toEqual([10, 2])
  })

  it('reports malformed required cells without changing them into zero costs', () => {
    const result = parseSpreadsheetWithDiagnostics(workbook([[
      ['Ticker', 'Quantity', 'Buy Price', 'Last Price'],
      ['VALID', 2, 'Rs. 1,000.50', 'not available'],
      ['BAD_COST', 10, 'abc', 120],
      ['BAD_QTY', '10abc', 100, 120],
      ['NO_QTY', '', 100, 120],
      ['NEGATIVE', -1, 100, 120],
      ['PERCENT_COST', 1, '10%', 120],
      ['PERCENT_QTY', '10%', 100, 120],
    ]]))
    expect(result.positions).toHaveLength(1)
    expect(result.positions[0]).toMatchObject({ ticker: 'VALID', quantity: 2, invested: 2001, lastPrice: null })
    expect(result.rejectedCount).toBe(6)
    expect(result.issues.map((issue) => [issue.row, issue.field])).toEqual([[3, 'Cost'], [4, 'Quantity'], [5, 'Quantity'], [6, 'Quantity'], [7, 'Cost'], [8, 'Quantity']])
    expect(result.issues.every((issue) => issue.sheet === 'Sheet1')).toBe(true)
  })

  it('rejects missing fund cost even when a current valuation is supplied', () => {
    expect(() => parseSpreadsheetWithDiagnostics(workbook([[
      ['Scheme Name', 'Units', 'Invested Value', 'Current Value'],
      ['Example Fund', 2, 'abc', 240],
    ]]))).toThrow('row 2: Cost')
  })
  it('finds mutual-fund holdings below account details and a portfolio summary', () => {
    const positions = parsePositions(workbook([[
      ['Name', 'Example Investor'],
      ['Mobile Number', '9000000000'],
      ['PAN', 'ABCDE1234F'],
      [],
      ['Total Investments', 'Current Portfolio Value', 'Returns', 'XIRR'],
      [200, 240, 40, '20%'],
      [],
      ['HOLDINGS AS ON 2026-09-23'],
      ['Scheme Name', 'AMC', 'Category', 'Sub-category', 'Folio No.', 'Source', 'Units', 'Invested Value', 'Current Value', 'Returns', 'XIRR'],
      [],
      ['Example Fund', 'Example AMC', 'Equity', 'Small Cap', 'EXAMPLE-1', 'Groww', 2, 200, 240, 40, '20%'],
    ]]))

    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({
      ticker: 'Example Fund', type: 'mutual-fund', quantity: 2, invested: 200,
      buyPrice: 100, lastPrice: 120, folio: 'EXAMPLE-1', xirr: 20,
    })
  })

  it.each(['xlsx', 'biff8'] as const)('reads reordered stock columns and ignores metadata, totals and invalid rows in %s', (format) => {
    const positions = parsePositions(workbook([[
      ['Client ID', 'EXAMPLE-CLIENT'],
      ['Summary', 'Investment Value', 'Current Value'],
      ['Portfolio', 200, 240],
      [],
      ['Account', 'Market Value (INR)', 'Stock Name', 'ISIN', 'Invested Value (Rs.)', 'Quantity', 'Pledged Quantity'],
      ['EXAMPLE', '₹2,400', 'Example Stock', 'INE000000001', 'Rs. 2,000', '10', 4],
      ['EXAMPLE', '-', 'Placeholder', '', 'N/A', '', ''],
      ['EXAMPLE', '100', 'Note 2026', '', 'Note 2026', 'reference 23', ''],
      ['EXAMPLE', 2400, 'Grand Total', '', 2000, 10, ''],
      ['EXAMPLE', 0, 'Closed Stock', '', 0, 0, ''],
    ]], format))

    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({ ticker: 'EXAMPLE STOCK', isin: 'INE000000001', type: 'stock', quantity: 10, buyPrice: 200, invested: 2000, lastPrice: 240 })
  })

  it('reads holdings on later worksheets and multiple holdings tables', () => {
    const positions = parsePositions(workbook([
      [['STOCK', 'SYMBOL', 'PRICE', 'Change (%)'], ['Example Stock', 'EXAMPLE', 125, 2]],
      [
        ['Portfolio instructions'], [],
        ['Stock', 'Date Purchased', 'Shares', 'Purchase Price', 'Fees', 'Purchase Cost', 'Current Price', 'Current Value'],
        ['EXAMPLE', '2026-09-23', 2, 100, 5, 205, 125, 250],
        ['TOTALS', '', 2, 100, 5, 205, 125, 250],
        [],
        ['Ticker', 'Quantity', 'Buy Price', 'Last Price'],
        ['SECOND', 3, 10, 12],
      ],
      [['Scheme Name', 'Units', 'Invested Value', 'Current Value'], ['Example Fund', 5, 500, 600]],
    ]))

    expect(positions.map((position) => position.ticker)).toEqual(['EXAMPLE', 'SECOND', 'Example Fund'])
    expect(positions[0]).toMatchObject({ quantity: 2, buyPrice: 100, invested: 205, lastPrice: 125 })
  })

  it('combines split headers without assigning blank columns to a previous field', () => {
    const positions = parsePositions(workbook([[
      ['Scheme Name', null, 'Units', 'Invested', 'Current'],
      [null, null, null, 'Value', 'Value'],
      ['Example Fund', 'Ignore this column', 2, 200, 240],
    ]]))
    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({ ticker: 'Example Fund', quantity: 2, invested: 200, lastPrice: 120 })
  })

  it('skips repeated headers and summary/footer rows with numeric cells', () => {
    const positions = parsePositions(workbook([[
      ['Ticker', 'Quantity', 'Avg. Cost', 'LTP'],
      ['EXAMPLE', 2, 100, 125],
      ['Ticker', 'Quantity', 'Avg. Cost', 'LTP'],
      ['SECOND', 3, 10, 12],
      ['Total', 5, 110, 137],
      ['Disclaimer 2026', 'version 1', 'page 2', '-'],
    ]]))
    expect(positions.map((position) => position.ticker)).toEqual(['EXAMPLE', 'SECOND'])
  })

  it('does not import a stock tradebook as holdings', () => {
    expect(() => parsePositions(workbook([[
      ['Symbol', 'Quantity', 'Price', 'Buy/Sell', 'Order ID'],
      ['EXAMPLE', 2, 100, 'BUY', 'ORDER-1'],
    ]]))).toThrow('No recognizable holdings header found')
  })

  it('stops importing holdings when a trade section follows on the same sheet', () => {
    const positions = parsePositions(workbook([[
      ['Symbol', 'Quantity', 'Price'],
      ['EXAMPLE', 2, 100],
      ['Symbol', 'Quantity', 'Price', 'Buy/Sell'],
      ['TRADE', 3, 110, 'BUY'],
    ]]))
    expect(positions.map((position) => position.ticker)).toEqual(['EXAMPLE'])
  })

  it('keeps optional last prices empty instead of turning placeholders into zero', () => {
    const positions = parsePositions(workbook([[
      ['Symbol', 'Qty', 'Avg. Cost', 'LTP'],
      ['EXAMPLE', '1,000', '1.5', '-'],
      ['SECOND', 1, '₹10', 'N/A'],
    ]]))
    expect(positions[0]).toMatchObject({ quantity: 1000, buyPrice: 1.5, invested: 1500, lastPrice: null })
    expect(positions[1].lastPrice).toBeNull()
  })

  it('reads fund NAV columns and fund names identified by XIRR', () => {
    const positions = parsePositions(workbook([
      [['Fund Name', 'Units', 'Average NAV', 'Current NAV'], ['Example Fund', 2, 100, 120]],
      [['Name', 'Units', 'Invested Value', 'Current Value', 'XIRR'], ['Second Fund', 3, 300, 360, '12%']],
    ]))
    expect(positions).toHaveLength(2)
    expect(positions[0]).toMatchObject({ type: 'mutual-fund', buyPrice: 100, lastPrice: 120, invested: 200 })
    expect(positions[1]).toMatchObject({ type: 'mutual-fund', ticker: 'Second Fund', xirr: 12 })
  })

  it('preserves security names that start with summary words', () => {
    const positions = parsePositions(workbook([[
      ['Stock Name', 'Shares', 'Purchase Price'],
      ['Total Energy Services', 2, 100],
    ]]))
    expect(positions).toHaveLength(1)
  })

  it('enforces the holdings limit across worksheets', () => {
    const rows = Array.from({ length: 2501 }, (_, index) => [`STOCK${index}`, 1, 10])
    expect(() => parsePositions(workbook([
      [['Ticker', 'Quantity', 'Buy Price'], ...rows],
      [['Ticker', 'Quantity', 'Buy Price'], ...rows],
    ]))).toThrow('limited to 5,000 holdings')
  })
})
