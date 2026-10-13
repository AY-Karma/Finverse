import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { parseSpreadsheetWithDiagnostics } from './spreadsheet'

function parsePositions(file: ArrayBuffer) {
  return parseSpreadsheetWithDiagnostics(file).positions
}

function workbook(sheets: unknown[][][], bookType: 'xlsx' | 'biff8' | 'csv' = 'xlsx', sheetNames?: string[]): ArrayBuffer {
  const book = XLSX.utils.book_new()
  sheets.forEach((rows, index) => {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetNames?.[index] ?? `Sheet${index + 1}`)
  })
  return XLSX.write(book, { type: 'array', bookType }) as ArrayBuffer
}

describe('holdings spreadsheet import', () => {
  it.each(['csv', 'xlsx', 'biff8'] as const)('accepts header-only equity and fund %s statements with no rejected rows', (format) => {
    for (const header of [
      ['Ticker', 'Quantity', 'Buy Price', 'Last Price'],
      ['Scheme Name', 'Units', 'Invested Value', 'Current Value'],
    ]) {
      expect(parseSpreadsheetWithDiagnostics(workbook([[header]], format))).toEqual({ positions: [], issues: [], rejectedCount: 0 })
    }
  })

  it.each([
    [['Ticker', 'Quantity', 'Buy Price'], ['EXAMPLE', 'invalid', 100]],
    [['Scheme Name', 'Units', 'Invested Value'], ['Example Fund', 0, 100]],
    [['Ticker', 'Quantity', 'Buy Price'], ['', 1, 100]],
  ])('does not treat an entirely rejected holdings table as an empty statement', (...rows) => {
    expect(() => parseSpreadsheetWithDiagnostics(workbook([rows]))).toThrow('No valid holdings found. 1 row(s) rejected.')
  })

  it.each([
    [[]],
    [['Unrecognized report']],
    [['Symbol', 'Quantity', 'Price', 'Buy/Sell', 'Order ID']],
  ])('rejects an empty file without a recognizable holdings header', (...rows) => {
    expect(() => parseSpreadsheetWithDiagnostics(workbook([rows]))).toThrow('No recognizable holdings header found')
  })

  it('rejects financially populated rows with no symbol or ISIN while skipping blank rows and totals', () => {
    const result = parseSpreadsheetWithDiagnostics(workbook([[
      ['Symbol', 'Name', 'Quantity', 'Buy Price', 'Last Price', 'Sector'],
      ['TCS', 'TCS', 1, 100, 120],
      ['', 'Missing symbol', 2, 100, 120],
      [null, null, null, 200, null],
      [' ', null, 0, 0, null],
      ['', null, '10abc', 100, null],
      ['', '', 4, 100, 120, 'Total'],
      [],
      [' ', '', ' ', ' ', ' '],
      ['Grand Total', '', 3, 300, 360],
      ['', 'Total', 3, 300, 360],
    ]]))
    expect(result.positions.map((position) => position.ticker)).toEqual(['TCS'])
    expect(result.rejectedCount).toBe(5)
    expect(result.issues.map((issue) => [issue.row, issue.field])).toEqual([[3, 'Identity'], [4, 'Identity'], [5, 'Identity'], [6, 'Identity'], [7, 'Identity']])
    expect(result.issues[0].message).toContain('symbol or ISIN')
  })

  it('rejects financially populated fund rows without scheme names while skipping blanks and totals', () => {
    const result = parseSpreadsheetWithDiagnostics(workbook([[
      ['Scheme Name', 'Units', 'Invested Value', 'Current Value'],
      ['Example Fund', 2, 200, 240],
      ['', 3, 300, 360],
      [' ', null, 100, null],
      [],
      [' ', ' ', ' ', ' '],
      ['Grand Total', 5, 500, 600],
    ]]))
    expect(result.positions.map((position) => position.name)).toEqual(['Example Fund'])
    expect(result.rejectedCount).toBe(2)
    expect(result.issues.map((issue) => [issue.row, issue.field])).toEqual([[3, 'Identity'], [4, 'Identity']])
    expect(result.issues[0].message).toContain('scheme name')
  })

  it.each(['xlsx', 'biff8'] as const)('retains an explicit ISIN from a blank Symbol cell for listing review in %s', (format) => {
    const result = parseSpreadsheetWithDiagnostics(workbook([[
      ['Symbol', 'ISIN', 'Name', 'Quantity', 'Average Price'],
      ['', 'INE040A01034', 'HDFC Bank', 10, 100],
    ]], format))
    expect(result.rejectedCount).toBe(0)
    expect(result.positions).toHaveLength(1)
    expect(result.positions[0]).toMatchObject({ ticker: 'INE040A01034', isin: 'INE040A01034', name: 'HDFC Bank', quantity: 10, invested: 1000 })
    expect(result.positions[0].identityIssue).toContain('ISIN alone')
    expect(result.positions[0].instrumentKey).toContain('unresolved')
  })

  it('rejects contradictory imported fund mappings before normalization can remove them', () => {
    const mappingColumns = ['MF scheme code', 'MF scheme name', 'MF mapping source']
    const result = parseSpreadsheetWithDiagnostics(workbook([
      [
        ['Scheme Name', 'Units', 'Invested Value', ...mappingColumns],
        ['Example Fund Direct IDCW', 1, 100, 43, 'Example Fund Regular Growth', 'confirmed'],
        ['Example Fund Direct Growth', 1, 100, 44, 'Example Fund Direct Growth', 'exact'],
      ],
      [
        ['Symbol', 'Name', 'Type', 'Quantity', 'Average Price', ...mappingColumns],
        ['Example Fund Direct IDCW', 'Example Fund Direct IDCW', 'MF', 1, 100, 43, 'Example Fund Regular Growth', 'confirmed'],
      ],
    ]))
    expect(result.positions).toHaveLength(1)
    expect(result.positions[0].mfScheme?.code).toBe(44)
    expect(result.rejectedCount).toBe(2)
    expect(result.issues.map((issue) => [issue.sheet, issue.row, issue.field])).toEqual([['Sheet1', 2, 'Identity'], ['Sheet2', 2, 'Identity']])
    expect(result.issues[0].message).toContain('mapping conflicts')
  })

  it('rejects oversized company and fund text fields with row diagnostics', () => {
    const result = parseSpreadsheetWithDiagnostics(workbook([
      [
        ['Symbol', 'Name', 'Quantity', 'Average Price'],
        ['TCS', 'A'.repeat(501), 1, 100],
        ['INFY', 'Infosys', 1, 100],
      ],
      [
        ['Scheme Name', 'AMC', 'Folio No', 'Source', 'Units', 'Invested Value'],
        ['Example Fund', 'A'.repeat(501), '', '', 1, 100],
        ['Example Fund', '', 'A'.repeat(501), '', 1, 100],
        ['Example Fund', '', '', 'A'.repeat(501), 1, 100],
      ],
    ]))
    expect(result.positions.map((position) => position.ticker)).toEqual(['INFY'])
    expect(result.rejectedCount).toBe(4)
    expect(result.issues.every((issue) => issue.field === 'Identity' && issue.message.includes('500 characters'))).toBe(true)
  })

  it('rejects unsafe direct and derived equity financial amounts while retaining safe boundary values', () => {
    const huge = Number.MAX_SAFE_INTEGER + 1
    const result = parseSpreadsheetWithDiagnostics(workbook([[
      ['Symbol', 'Quantity', 'Average Price', 'Invested Value', 'Last Price', 'Current Value'],
      ['VALID', 1, Number.MAX_SAFE_INTEGER, null, null, null],
      ['QUANTITY', huge, 1, null, null, null],
      ['COST', 1, huge, null, null, null],
      ['INVESTED', 1, null, huge, null, null],
      ['PRICE', 1, 100, null, huge, null],
      ['VALUE', 1, 100, null, null, huge],
      ['NEGATIVE_PRICE', 1, 100, null, -1, null],
      ['DERIVED_COST', 2, Number.MAX_SAFE_INTEGER, null, null, null],
      ['DERIVED_PRICE', 0.0000000001, 100, null, null, 1000000],
      ['DERIVED_VALUE', 100000000, 1, null, 100000000, null],
    ]]))
    expect(result.positions.map((position) => position.ticker)).toEqual(['VALID'])
    expect(result.positions[0].invested).toBe(Number.MAX_SAFE_INTEGER)
    expect(result.rejectedCount).toBe(9)
    expect(result.issues.map((issue) => issue.field)).toEqual(['Quantity', ...Array(8).fill('Cost')])
  })

  it('rejects unsafe fund financial amounts and keeps signed returns within the supported range', () => {
    const huge = Number.MAX_SAFE_INTEGER + 1
    const result = parseSpreadsheetWithDiagnostics(workbook([[
      ['Scheme Name', 'Units', 'Invested Value', 'NAV', 'Returns', 'XIRR'],
      ['Valid fund', 1, 100, 120, -20, '-8%'],
      ['Units', huge, 100, null, null, null],
      ['Cost', 1, huge, null, null, null],
      ['NAV', 1, 100, huge, null, null],
      ['Returns', 1, 100, null, -huge, null],
      ['Oversized XIRR fund', 1, 100, null, null, huge],
    ]]))
    expect(result.positions).toHaveLength(1)
    expect(result.positions[0]).toMatchObject({ returns: -20, xirr: -8 })
    expect(result.rejectedCount).toBe(5)
    expect(result.issues.map((issue) => issue.field)).toEqual(['Quantity', ...Array(4).fill('Cost')])
  })

  it('reports oversized identity metadata as a rejected row rather than saving an unrestorable holding', () => {
    const result = parseSpreadsheetWithDiagnostics(workbook([[
      ['Symbol', 'Quantity', 'Average Price', 'Sector'],
      ['TCS', 1, 100, 'A'.repeat(501)],
      ['INFY', 1, 100, 'Technology'],
    ]]))
    expect(result.positions).toHaveLength(1)
    expect(result.positions[0].ticker).toBe('INFY')
    expect(result).toMatchObject({ rejectedCount: 1, issues: [{ field: 'Identity', row: 2 }] })
  })

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
