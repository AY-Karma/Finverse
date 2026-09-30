import * as XLSX from '@e965/xlsx'
import type { AssetType, Position } from './types'
import { MAX_IMPORT_FILE_BYTES } from './importLimits'
const MAX_IMPORT_ROWS = 100_000
const MAX_IMPORT_POSITIONS = 5_000
const MAX_IMPORT_SHEETS = 20
const MAX_IMPORT_COLUMNS = 1_000
const MAX_IMPORT_CELLS = 2_000_000
const MAX_IMPORT_UNCOMPRESSED_BYTES = 50 * 1024 * 1024

function preflightZip(file: ArrayBuffer): void {
  const bytes = new Uint8Array(file)
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return
  const view = new DataView(file)
  const start = Math.max(0, file.byteLength - 65_557)
  let eocd = -1
  for (let i = file.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('This ZIP-based spreadsheet is malformed or unsupported.')
  const entries = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  let offset = centralOffset
  let uncompressed = 0
  let worksheetEntries = 0
  const decoder = new TextDecoder()
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > file.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('This ZIP-based spreadsheet is malformed or unsupported.')
    }
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('ZIP64 spreadsheets are not supported.')
    }
    uncompressed += uncompressedSize
    if (uncompressed > MAX_IMPORT_UNCOMPRESSED_BYTES) {
      throw new Error('The spreadsheet expands beyond the 50 MB safety limit.')
    }
    const nameStart = offset + 46
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength))
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) worksheetEntries++
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (worksheetEntries > MAX_IMPORT_SHEETS) {
    throw new Error(`Spreadsheets are limited to ${MAX_IMPORT_SHEETS} worksheets.`)
  }
}

function validateSheetDimensions(sheetName: string, sheet: unknown, totalCells: number): number {
  if (!sheet || typeof sheet !== 'object') return totalCells
  const ref = (sheet as { '!ref'?: unknown })['!ref']
  if (typeof ref !== 'string') return totalCells
  let range: { s: { r: number; c: number }; e: { r: number; c: number } }
  try {
    range = XLSX.utils.decode_range(ref)
  } catch {
    throw new Error(`Worksheet "${sheetName}" has an invalid cell range.`)
  }
  const rows = range.e.r - range.s.r + 1
  const columns = range.e.c - range.s.c + 1
  if (rows > MAX_IMPORT_ROWS || columns > MAX_IMPORT_COLUMNS) {
    throw new Error(`Worksheet "${sheetName}" exceeds the ${MAX_IMPORT_ROWS.toLocaleString()} row / ${MAX_IMPORT_COLUMNS.toLocaleString()} column safety limit.`)
  }
  const cells = rows * columns
  if (!Number.isSafeInteger(cells) || totalCells + cells > MAX_IMPORT_CELLS) {
    throw new Error(`Spreadsheet dimensions exceed the ${MAX_IMPORT_CELLS.toLocaleString()} cell safety limit.`)
  }
  return totalCells + cells
}

type FieldKey = 'ticker' | 'quantity' | 'buyPrice' | 'lastPrice' | 'investedValue' | 'currentValue' | 'name' | 'type' | 'isin'

const FIELD_ALIASES: Record<FieldKey, string[]> = {
  ticker: ['ticker', 'symbol', 'trading symbol', 'tradingsymbol', 'code', 'scrip', 'scrip code', 'script', 'security', 'instrument', 'stock', 'stock name', 'name', 'company name', 'security name'],
  quantity: ['quantity', 'qty', 'net quantity', 'net qty', 'quantity held', 'units', 'shares', 'noofunits', 'no of units', 'held', 'pos'],
  buyPrice: [
    'buyprice',
    'buy price',
    'purchase price',
    'average buy price',
    'avg. buy price',
    'buy average',
    'average cost price',
    'price',
    'avgcost',
    'averagecost',
    'avgprice',
    'average price',
    'average',
    'avg',
    'nav',
    'cost',
  ],
  investedValue: ['invested value', 'invested amount', 'investment amount', 'investment value', 'total investment', 'invested', 'purchase cost', 'buy value', 'cost value', 'total cost'],
  currentValue: ['current value', 'market value', 'current market value', 'present value', 'valuation'],
  lastPrice: [
    'lastprice',
    'last price',
    'lasttradedprice',
    'ltp',
    'currentprice',
    'current market price',
    'marketprice',
    'market price',
    'previous closing price',
    'previous close',
    'close',
    'closing',
    'prev',
  ],
  name: ['company', 'companyname', 'securityname', 'stock name', 'name', 'fund', 'fundname', 'scheme', 'description'],
  type: ['type', 'assettype', 'assetclass', 'class', 'category'],
  isin: ['isin', 'isin code'],
}

type MfField =
  | 'scheme'
  | 'units'
  | 'investedValue'
  | 'currentValue'
  | 'buyPrice'
  | 'lastPrice'
  | 'amc'
  | 'category'
  | 'subCategory'
  | 'folio'
  | 'source'
  | 'returns'
  | 'xirr'

const MF_ALIASES: Record<MfField, string[]> = {
  buyPrice: ['buy price', 'purchase price', 'average price', 'avg price', 'average nav', 'avg nav', 'average cost', 'avg cost'],
  lastPrice: ['nav', 'current nav', 'latest nav', 'last price', 'current price', 'ltp'],
  scheme: [
    'schemename',
    'scheme name',
    'scheme',
    'schem',
    'fundname',
    'fund name',
    'fund',
    'investment',
    'mfscheme',
    'name of scheme',
    'scheme desc',
    'portfolio scheme',
    'mutualfundname',
    'mutual fund name',
    'sschemename',
  ],
  units: [
    'units',
    'unit',
    'quantity',
    'qty',
    'noofunits',
    'no of units',
    'numberofunits',
    'holding units',
    'unitsheld',
    'units held',
    'stock',
    'balance',
  ],
  investedValue: [
    'investedvalue',
    'invested value',
    'investment amount',
    'amountinvested',
    'amount invested',
    'invested',
    'totalinvested',
    'investedcapital',
    'account value',
    'cost',
    'value invested',
    'invested amount in',
    'total amount invested',
    'investment cost',
    'total cost price',
    'cost value',
    'book cost',
    'totalcost',
    'total cost',
    'investmentvalue',
    'investment value',
  ],
  currentValue: [
    'current value',
    'currentvalue',
    'current value of investment',
    'market value',
    'marketvalue',
    'portfolio value',
    'current market value',
    'net value',
    'valuation',
    'total value',
    'fund value',
    'current mkt value',
    'portfolio market value',
    'current portfolio value',
    'currentinvestmentvalue',
    'navvalue',
    'nav value',
    'currentnvalue',
    'present value',
  ],
  amc: ['amc', 'amc name', 'asset management company', 'fund house', 'fundhouse', 'manager', 'assettmanagement'],
  category: ['category', 'fund type', 'asset class', 'assetclass', 'scheme type', 'type', 'sectortag'],
  subCategory: ['subcategory', 'sub category', 'sub-category', 'subtype', 'sub type', 'subcategorytag'],
  folio: ['folio', 'folio no', 'folio number', 'folio#', 'folio no.', 'account number', 'policy no', 'folioid'],
  source: ['source', 'platform', 'agent', 'broker', 'distributor', 'source of investment', 'selling', 'origin'],
  returns: ['returns', 'return', 'pnl', 'profit/loss', 'profit loss', 'gain', 'unrealised', 'total returns', 'returns value'],
  xirr: ['xirr', 'irr', 'annualized return', 'annualised return', 'return', 'yield'],
}

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function headerCellText(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function matchScore(head: string, aliases: string[]): number {
  const normalized = normalizeHeader(head)
  if (!normalized) return 0
  let best = 0
  for (const alias of aliases) {
    const candidate = normalizeHeader(alias)
    if (normalized === candidate) {
      best = Math.max(best, 200 + candidate.length)
    } else if (normalized.startsWith(candidate) && /^(in)?(rs|inr|rupees|usd|eur|gbp)$/.test(normalized.slice(candidate.length))) {
      best = Math.max(best, candidate.length)
    }
  }
  return best
}

type Columns<Key extends string> = Record<Key, number | null>

function fieldCount(cols: Columns<string>): number {
  return Object.values(cols).filter((col) => col != null).length
}

function assignColumns<Key extends string>(head: string[], aliases: Record<Key, string[]>): Columns<Key> {
  const keys = Object.keys(aliases) as Key[]
  const cols = Object.fromEntries(keys.map((key) => [key, null])) as Columns<Key>
  const candidates: { key: Key; col: number; score: number; priority: number }[] = []
  keys.forEach((key, priority) => {
    head.forEach((cell, col) => {
      const score = matchScore(cell, aliases[key])
      if (score > 0) candidates.push({ key, col, score, priority })
    })
  })
  candidates.sort((a, b) => b.score - a.score || a.priority - b.priority || a.col - b.col)
  const taken = new Set<number>()
  for (const candidate of candidates) {
    if (cols[candidate.key] != null || taken.has(candidate.col)) continue
    cols[candidate.key] = candidate.col
    taken.add(candidate.col)
  }
  return cols
}

function detectHeader(head: string[]) {
  const equity = assignColumns(head, FIELD_ALIASES)
  // Activity reports cannot be interpreted as current holdings.
  if (head.some((cell) => ['buysell', 'tradetype', 'transactiontype', 'orderid', 'tradeid', 'executionid'].includes(normalizeHeader(cell)))) {
    return equity.quantity != null && (equity.ticker != null || equity.isin != null)
      ? { mode: 'activity' as const, cols: equity }
      : null
  }
  const mf = assignColumns(head, MF_ALIASES)
  if (mf.scheme == null && mf.xirr != null) mf.scheme = equity.ticker ?? equity.name
  if (mf.scheme != null && mf.units != null &&
    (mf.investedValue != null || mf.currentValue != null || mf.buyPrice != null || mf.lastPrice != null)) {
    return { mode: 'mf' as const, cols: mf }
  }
  if ((equity.ticker != null || equity.isin != null) && equity.quantity != null &&
    (equity.buyPrice != null || equity.lastPrice != null || equity.investedValue != null || equity.currentValue != null)) {
    return { mode: 'equity' as const, cols: equity }
  }
  return null
}

function parseNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  // Parenthetical negatives: (1,234.50) => -1234.5
  const neg = s.startsWith('(') && s.endsWith(')')
  const numeric = s.replace(/\b(INR|USD|EUR|GBP|Rs|rupees)\b\.?/gi, '').replace(/[,\s₹$€£%()]/g, '')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(numeric)) return null
  const n = Number(numeric) * (neg ? -1 : 1)
  return Number.isFinite(n) ? n : null
}

function inferType(v: unknown): AssetType {
  if (v == null) return 'other'
  const s = String(v).toLowerCase()
  if (s.includes('mutual') || s.includes('fund') || s.includes('mf ')) return 'mutual-fund'
  if (s.includes('etf')) return 'etf'
  // Broker exports commonly abbreviate cash-equity rows to just "EQ".
  if (/(^|\s)(eq|equity|equities|stocks|shares?)($|\s)/.test(s)) return 'stock'
  if (s.includes('stock') || s.includes('equity') || s.includes('share')) return 'stock'
  return 'other'
}

function parseEquityRows(rows: unknown[][], cols: Columns<FieldKey>): Position[] {
  const positions: Position[] = []
  for (const row of rows) {
    const ticker = row[cols.ticker ?? cols.isin ?? -1]
    if (ticker == null || String(ticker).trim() === '' || SUMMARY_LABELS.test(String(ticker))) continue

    const qtyRaw = cols.quantity != null ? parseNumber(row[cols.quantity]) : null
    const buyRaw = cols.buyPrice != null ? parseNumber(row[cols.buyPrice]) : null
    const lastRaw = cols.lastPrice != null ? parseNumber(row[cols.lastPrice]) : null
    const invested = cols.investedValue != null ? parseNumber(row[cols.investedValue]) : null
    const value = cols.currentValue != null ? parseNumber(row[cols.currentValue]) : null
    if (qtyRaw == null || qtyRaw <= 0 || (buyRaw == null && lastRaw == null && invested == null && value == null)) continue
    const buyPrice = buyRaw ?? (invested != null ? invested / qtyRaw : 0)
    const isin = cols.isin != null ? String(row[cols.isin] ?? '').trim().toUpperCase() : ''

    positions.push({
      id: crypto.randomUUID(),
      ticker: String(ticker).trim().toUpperCase(),
      name: cols.name != null ? String(row[cols.name] ?? '').trim() : '',
      // An equity-shaped header has already been detected. Broker exports
      // commonly omit an explicit Type column, and those rows are stocks.
      type: cols.type != null ? inferType(row[cols.type]) : 'stock',
      quantity: qtyRaw,
      buyPrice,
      lastPrice: lastRaw ?? (value != null ? value / qtyRaw : null),
      invested: invested ?? qtyRaw * buyPrice,
      ...(isin ? { isin } : {}),
    })
  }
  return positions
}

const SUMMARY_LABELS =
  /^\s*(totals?|sub[ -]?total|summary|holdings summary|invested values|total invest(ment)?s?|grand total|net value|profit|loss|xirr)\s*[:\-]?\s*$/i

function parseMfRows(rows: unknown[][], cols: Columns<MfField>): Position[] {
  const positions: Position[] = []
  for (const row of rows) {
    const schemeCell = cols.scheme != null ? row[cols.scheme] : null
    const schemeStr = schemeCell != null ? String(schemeCell).trim() : ''
    if (schemeStr === '' || SUMMARY_LABELS.test(schemeStr)) continue

    const units = cols.units != null ? parseNumber(row[cols.units]) : null
    if (units == null || units <= 0) continue

    const invested = cols.investedValue != null ? parseNumber(row[cols.investedValue]) : null
    const value = cols.currentValue != null ? parseNumber(row[cols.currentValue]) : null
    const buy = cols.buyPrice != null ? parseNumber(row[cols.buyPrice]) : null
    const last = cols.lastPrice != null ? parseNumber(row[cols.lastPrice]) : null
    if (invested == null && value == null && buy == null && last == null) continue
    const amc = cols.amc != null ? String(row[cols.amc] ?? '').trim() : ''
    const category = cols.category != null ? String(row[cols.category] ?? '').trim() : ''
    const subCategory = cols.subCategory != null ? String(row[cols.subCategory] ?? '').trim() : ''
    const folio = cols.folio != null ? String(row[cols.folio] ?? '').trim() : ''
    const source = cols.source != null ? String(row[cols.source] ?? '').trim() : ''
    const returns = cols.returns != null ? parseNumber(row[cols.returns]) : null
    const xirr = cols.xirr != null ? parseNumber(row[cols.xirr]) : null

    positions.push({
      id: crypto.randomUUID(),
      // Scheme name serves as the unique key (kept verbatim, not uppercased).
      ticker: schemeStr,
      name: schemeStr,
      type: 'mutual-fund',
      quantity: units,
      buyPrice: buy ?? (invested != null ? invested / units : 0),
      lastPrice: last ?? (value != null ? value / units : null),
      invested: invested ?? units * (buy ?? 0),
      amc,
      category,
      subCategory,
      folio,
      source,
      returns,
      xirr,
    })
  }
  return positions
}

/**
 * Combine two consecutive header rows cell-by-cell (vertical merge). Many
 * exports split a header across two rows, e.g. "Scheme Name" on one row and
 * "Units | Invested | Current Value" on the next.
 */
function combineHeaderRow(a: readonly unknown[], b: readonly unknown[]): string[] {
  const n = Math.max(a.length, b.length)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const ta = headerCellText(a[i])
    const tb = headerCellText(b[i])
    out.push(ta && tb ? `${ta} ${tb}` : ta || tb)
  }
  return out
}

export function parseSpreadsheet(file: ArrayBuffer): Position[] {
  if (file.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new Error('Portfolio files must be 10 MB or smaller.')
  }
  preflightZip(file)
  const wb = XLSX.read(file, { type: 'array' })
  if (wb.SheetNames.length > MAX_IMPORT_SHEETS) {
    throw new Error(`Spreadsheets are limited to ${MAX_IMPORT_SHEETS} worksheets.`)
  }
  const positions: Position[] = []
  let totalCells = 0
  for (const sheetName of wb.SheetNames) {
    totalCells = validateSheetDimensions(sheetName, wb.Sheets[sheetName], totalCells)
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: true,
    })
    if (rows.length === 0) continue
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new Error(`Each sheet must contain ${MAX_IMPORT_ROWS.toLocaleString()} rows or fewer.`)
    }

    let active: { header: NonNullable<ReturnType<typeof detectHeader>>; dataStart: number } | null = null
    const appendRows = (end: number) => {
      if (!active) return
      const data = rows.slice(active.dataStart, end)
      const { header } = active
      if (header.mode === 'activity') return
      const parsed = header.mode === 'mf'
        ? parseMfRows(data, header.cols)
        : parseEquityRows(data, header.cols)
      positions.push(...parsed)
      if (positions.length > MAX_IMPORT_POSITIONS) {
        throw new Error(`Portfolio imports are limited to ${MAX_IMPORT_POSITIONS.toLocaleString()} holdings.`)
      }
    }
    for (let i = 0; i < rows.length; i++) {
      let header = detectHeader(rows[i].map(headerCellText))
      let consumed = 1
      if (i + 1 < rows.length) {
        const combined = detectHeader(combineHeaderRow(rows[i], rows[i + 1]))
        if (combined && (!header || fieldCount(combined.cols) > fieldCount(header.cols))) {
          header = combined
          consumed = 2
        }
      }
      if (!header) continue
      appendRows(i)
      active = { header, dataStart: i + consumed }
      i += consumed - 1
    }
    appendRows(rows.length)
  }
  if (positions.length > 0) return positions

  throw new Error(
    'No recognizable holdings header found. Use Ticker or Symbol with Quantity and Buy Price for equities, or Scheme Name with Units and Invested Value for mutual funds.',
  )
}
