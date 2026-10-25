import * as XLSX from '@e965/xlsx'
import type { AssetType, Exchange, Position } from './types'
import { hasCompatibleFundScheme, isMfSchemeMapping } from './fundSchemes'
import { normalizePosition } from './instruments'
import { MAX_IMPORT_FILE_BYTES } from './importLimits'
const MAX_IMPORT_ROWS = 100_000
const MAX_IMPORT_POSITIONS = 5_000
const MAX_IMPORT_SHEETS = 20
const MAX_IMPORT_COLUMNS = 1_000
const MAX_IMPORT_CELLS = 2_000_000
const MAX_IMPORT_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
const MAX_IMPORT_ISSUES = 100

const currencyCodeCache = new Map<string, boolean>()

function isCurrencyCode(value: string): boolean {
  if (!/^[a-z]{3}$/i.test(value)) return false
  const code = value.toUpperCase()
  const cached = currencyCodeCache.get(code)
  if (cached != null) return cached
  const currencyName = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'name' })
    .formatToParts(1).find(part => part.type === 'currency')?.value
  // Intl echoes unknown codes, including ordinary labels such as NAV.
  const recognized = currencyName != null && currencyName !== code
  currencyCodeCache.set(code, recognized)
  return recognized
}

export interface ImportRowIssue {
  sheet: string
  row: number
  field: 'Quantity' | 'Cost' | 'Identity'
  message: string
}

export interface SpreadsheetParseResult {
  positions: Position[]
  issues: ImportRowIssue[]
  rejectedCount: number
}

interface RowValidation {
  sheet: string
  startRow: number
  result: SpreadsheetParseResult
}

function rejectRow(validation: RowValidation, index: number, field: ImportRowIssue['field'], message: string): void {
  validation.result.rejectedCount++
  if (validation.result.issues.length < MAX_IMPORT_ISSUES) {
    validation.result.issues.push({ sheet: validation.sheet, row: validation.startRow + index + 1, field, message })
  }
}

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

type IdentityField = 'isin' | 'exchange' | 'currency' | 'sector' | 'industry' | 'providerSymbol' | 'exchangeSource' | 'identityIssue' | 'reportedExchange' | 'reportedCurrency' | 'mfSchemeCode' | 'mfSchemeName' | 'mfMappingSource'
type FieldKey = 'ticker' | 'quantity' | 'buyPrice' | 'lastPrice' | 'investedValue' | 'currentValue' | 'name' | 'type' | IdentityField

const IDENTITY_ALIASES: Record<IdentityField, string[]> = {
  isin: ['isin', 'isin code'], exchange: ['exchange', 'venue', 'stock exchange', 'listing exchange'],
  currency: ['currency', 'asset currency', 'quote currency', 'currency code'],
  sector: ['sector', 'sector name', 'industry sector'], industry: ['industry', 'industry name'],
  providerSymbol: ['provider symbol', 'market symbol', 'yahoo symbol'],
  exchangeSource: ['exchange source'], identityIssue: ['identity issue'],
  reportedExchange: ['reported exchange'], reportedCurrency: ['reported currency'],
  mfSchemeCode: ['mf scheme code', 'nav scheme code'], mfSchemeName: ['mf scheme name'], mfMappingSource: ['mf mapping source'],
}

const FIELD_ALIASES: Record<FieldKey, string[]> = {
  ticker: ['ticker', 'symbol', 'trading symbol', 'tradingsymbol', 'code', 'scrip', 'scrip code', 'script', 'security', 'instrument', 'stock', 'stock name', 'name', 'company name', 'security name'],
  quantity: ['quantity', 'qty', 'net quantity', 'net qty', 'quantity held', 'quantity available', 'units', 'shares', 'noofunits', 'no of units', 'held', 'pos'],
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
  type: ['type', 'assettype', 'assetclass', 'instrument type', 'class', 'category'],
  ...IDENTITY_ALIASES,
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
  | IdentityField

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
  ...IDENTITY_ALIASES,
}

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function currencyCodeSuffix(value: string): string | null {
  const code = value.match(/([a-z]{3})$/i)?.[1]
  return code && isCurrencyCode(code) ? code.toUpperCase() : null
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
    } else if (normalized.startsWith(candidate) && (
      /^(in)?(rs|inr|rupees)$/.test(normalized.slice(candidate.length)) ||
      currencyCodeSuffix(normalized.slice(candidate.length).replace(/^in(?=[a-z]{3}$)/, '')) != null
    )) {
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

function isKiteHoldingsHeader(head: string[]): boolean {
  const fields = new Set(head.map(normalizeHeader))
  return ['symbol', 'isin', 'quantityavailable', 'averageprice', 'previousclosingprice'].every(field => fields.has(field))
}

function detectHeader(head: string[]) {
  const equity = assignColumns(head, FIELD_ALIASES)
  // Activity reports cannot be interpreted as current holdings.
  if (head.some((cell) => ['buysell', 'tradetype', 'transactiontype', 'orderid', 'tradeid', 'executionid'].includes(normalizeHeader(cell)))) {
    return equity.quantity != null && (equity.ticker != null || equity.isin != null)
      ? { mode: 'activity' as const, cols: equity }
      : null
  }
  // Percentage returns are neither monetary gains nor annualized XIRR.
  const mfHead = head.map(cell => cell.includes('%') && matchScore(cell, MF_ALIASES.returns) > 0 ? '' : cell)
  const mf = assignColumns(mfHead, MF_ALIASES)
  if (mf.scheme == null && mf.xirr != null) mf.scheme = equity.ticker ?? equity.name
  if (mf.scheme != null && mf.units != null &&
    (mf.investedValue != null || mf.currentValue != null || mf.buyPrice != null || mf.lastPrice != null)) {
    return { mode: 'mf' as const, cols: mf }
  }
  if ((equity.ticker != null || equity.isin != null) && equity.quantity != null &&
    (equity.buyPrice != null || equity.lastPrice != null || equity.investedValue != null || equity.currentValue != null)) {
    const nameOnly = equity.ticker != null && ['name', 'companyname', 'securityname', 'stockname', 'description'].includes(normalizeHeader(head[equity.ticker]))
    return { mode: 'equity' as const, cols: equity, nameOnly }
  }
  return null
}

function parseNumber(v: unknown, allowPercent = false): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  // Parenthetical negatives: (1,234.50) => -1234.5
  const neg = s.startsWith('(') && s.endsWith(')')
  const numeric = (neg ? s.slice(1, -1) : s).trim()
    .replace(/^(?:(?:INR|Rs\.?|rupees)\s*|₹\s*)/i, '')
    .replace(/\s*(?:INR|rupees)$/i, '').trim()
  const amount = allowPercent ? numeric.replace(/%$/, '').trim() : numeric
  const plain = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
  const grouped = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d*)?$/
  if (!plain.test(amount) && !grouped.test(amount)) return null
  const n = Number(amount.replace(/,/g, '')) * (neg ? -1 : 1)
  return Number.isFinite(n) ? n : null
}

function inferType(v: unknown): AssetType {
  if (v == null) return 'other'
  const s = String(v).toLowerCase()
  if (s.includes('etf') || s.includes('exchange traded fund') || s.includes('exchange-traded fund')) return 'etf'
  if (s.includes('mutual') || s.includes('fund') || /(^|\s)mf($|\s)/.test(s)) return 'mutual-fund'
  // Broker exports commonly abbreviate cash-equity rows to just "EQ".
  if (/(^|\s)(eq|equity|equities|stocks|shares?)($|\s)/.test(s)) return 'stock'
  if (s.includes('stock') || s.includes('equity') || s.includes('share')) return 'stock'
  return 'other'
}

function validCost(row: unknown[], buyColumn: number | null, investedColumn: number | null): { buy: number | null; invested: number | null } | null {
  const buy = buyColumn != null ? parseNumber(row[buyColumn]) : null
  const invested = investedColumn != null ? parseNumber(row[investedColumn]) : null
  for (const [column, parsed] of [[buyColumn, buy], [investedColumn, invested]] as const) {
    const raw = column != null ? row[column] : null
    if (raw != null && String(raw).trim() !== '' && (parsed == null || !safeAmount(parsed))) return null
  }
  return buy == null && invested == null ? null : { buy, invested }
}

function identityFields(row: unknown[], cols: Columns<IdentityField>): Partial<Position> {
  const text = (key: IdentityField) => cols[key] == null ? '' : String(row[cols[key]!] ?? '').trim()
  const rawExchange = text('exchange').toUpperCase()
  const rawCurrency = text('currency').toUpperCase()
  const exchange = ['NSE', 'BSE', 'NASDAQ', 'NYSE', 'LSE', 'OTHER'].includes(rawExchange) ? rawExchange as Exchange : rawExchange ? 'OTHER' : undefined
  const source = text('exchangeSource')
  const mapping = { code: parseNumber(cols.mfSchemeCode == null ? null : row[cols.mfSchemeCode]), name: text('mfSchemeName'), source: text('mfMappingSource') }
  return {
    identityVersion: 2, exchange, exchangeSource: source === 'explicit' || source === 'inferred' ? source : rawExchange ? 'explicit' : 'inferred',
    currency: rawCurrency === 'INR' ? rawCurrency : undefined,
    reportedExchange: text('reportedExchange') || (rawExchange && exchange === 'OTHER' ? rawExchange : undefined),
    reportedCurrency: text('reportedCurrency') || (rawCurrency && rawCurrency !== 'INR' ? rawCurrency : undefined),
    isin: text('isin').toUpperCase() || undefined, sector: text('sector') || undefined, industry: text('industry') || undefined,
    providerSymbol: text('providerSymbol').toUpperCase() || undefined, identityIssue: text('identityIssue') || undefined,
    ...(isMfSchemeMapping(mapping) ? { mfScheme: mapping } : {}),
  }
}

function oversizedIdentity(row: unknown[], cols: Columns<IdentityField>): boolean {
  return (Object.keys(IDENTITY_ALIASES) as IdentityField[]).some((key) => cols[key] != null && String(row[cols[key]!] ?? '').length > 500)
}

function safeAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
}

function isUnavailableNumber(raw: unknown): boolean {
  return /^(?:-|—|n\/a|not available)?$/i.test(String(raw ?? '').trim())
}

function invalidOptionalNumber(raw: unknown, value: number | null, signed = false): boolean {
  if (isUnavailableNumber(raw)) return false
  return value == null || !safeAmount(signed ? Math.abs(value) : value)
}

function hasFinancialData(row: unknown[], columns: (number | null)[]): boolean {
  const firstCell = row.find((cell) => String(cell ?? '').trim() !== '')
  if (SUMMARY_LABELS.test(String(firstCell ?? ''))) return false
  return columns.some((column) => column != null && String(row[column] ?? '').trim() !== '')
}

function prepareHolding(position: Position, validation: RowValidation, index: number): Position | null {
  if (position.mfScheme && !position.reportedCurrency && !hasCompatibleFundScheme(position)) {
    rejectRow(validation, index, 'Identity', 'The MF scheme mapping conflicts with the holding plan, option or native currency. Correct the mapping before importing.')
    return null
  }
  const normalized = normalizePosition(position)
  if (Object.values(normalized).some((value) => typeof value === 'string' && value.length > 500)) {
    rejectRow(validation, index, 'Identity', 'Holding text fields must be 500 characters or fewer. Shorten the fields before importing.')
    return null
  }
  return normalized
}

function parseEquityRows(rows: unknown[][], cols: Columns<FieldKey>, validation: RowValidation, defaultType?: AssetType, nameOnly = false): Position[] {
  const positions: Position[] = []
  for (const [index, row] of rows.entries()) {
    const symbol = cols.ticker != null ? String(row[cols.ticker] ?? '').trim() : ''
    const isin = cols.isin != null ? String(row[cols.isin] ?? '').trim() : ''
    const ticker = symbol || isin
    if (SUMMARY_LABELS.test(ticker)) continue
    if (!ticker) {
      if (hasFinancialData(row, [cols.quantity, cols.buyPrice, cols.investedValue, cols.lastPrice, cols.currentValue])) {
        rejectRow(validation, index, 'Identity', 'Enter a symbol or ISIN for this holding. Financial cells are populated but its identity is missing.')
      }
      continue
    }
    if (ticker.length > 500 || oversizedIdentity(row, cols)) {
      rejectRow(validation, index, 'Identity', 'Holding identity fields must be 500 characters or fewer. Shorten the fields before importing.')
      continue
    }

    const qtyRaw = cols.quantity != null ? parseNumber(row[cols.quantity]) : null
    if (qtyRaw == null || qtyRaw <= 0 || !safeAmount(qtyRaw)) {
      rejectRow(validation, index, 'Quantity', 'Enter a positive numeric quantity no greater than 9,007,199,254,740,991; zero, negative, missing and mixed-text quantities are unsupported.')
      continue
    }
    const cost = validCost(row, cols.buyPrice, cols.investedValue)
    if (!cost) {
      rejectRow(validation, index, 'Cost', 'Enter a non-negative numeric buy price or invested value no greater than 9,007,199,254,740,991. Correct any malformed cost cells.')
      continue
    }
    const { buy: buyRaw, invested } = cost
    const lastRaw = cols.lastPrice != null ? parseNumber(row[cols.lastPrice]) : null
    const value = cols.currentValue != null ? parseNumber(row[cols.currentValue]) : null
    if ([[cols.lastPrice, lastRaw], [cols.currentValue, value]].some(([column, amount]) => column != null && invalidOptionalNumber(row[column], amount))) {
      rejectRow(validation, index, 'Cost', 'Last price and current value must be valid non-negative INR numbers within the supported range. Correct malformed or foreign currency cells.')
      continue
    }
    const buyPrice = buyRaw ?? invested! / qtyRaw
    const lastPrice = lastRaw ?? (value != null ? value / qtyRaw : null)
    if (!safeAmount(buyPrice) || !safeAmount(invested ?? qtyRaw * buyPrice)
      || (lastPrice != null && (!safeAmount(lastPrice) || !safeAmount(lastPrice * qtyRaw)))) {
      rejectRow(validation, index, 'Cost', 'A derived cost or valuation is too large to value safely.')
      continue
    }
    const typeCell = cols.type != null ? row[cols.type] : null
    const type = defaultType && /^(?:-|—|n\/a)?$/i.test(String(typeCell ?? '').trim())
      ? defaultType
      : cols.type != null ? inferType(typeCell) : 'stock'
    const metadata = identityFields(row, cols)

    const position = prepareHolding({
      id: crypto.randomUUID(),
      ticker: String(ticker).trim().toUpperCase(),
      name: cols.name != null ? String(row[cols.name] ?? '').trim() : '',
      // An equity-shaped header has already been detected. Broker exports
      // commonly omit an explicit Type column, and those rows are stocks.
      type,
      quantity: qtyRaw,
      buyPrice,
      lastPrice,
      invested: invested ?? qtyRaw * buyPrice,
      ...metadata,
      mfScheme: type === 'mutual-fund' ? metadata.mfScheme : undefined,
      ...(!symbol && isin && type !== 'mutual-fund' ? { identityIssue: 'An ISIN alone does not identify a supported listing. Confirm its ticker and venue.' } : {}),
      ...(nameOnly && !metadata.providerSymbol && type !== 'mutual-fund' ? { identityIssue: 'A company name alone does not identify a supported listing. Confirm its ticker and exchange.' } : {}),
    }, validation, index)
    if (position) positions.push(position)
  }
  return positions
}

const SUMMARY_LABELS =
  /^\s*(totals?|sub[ -]?total|summary|holdings summary|invested values|total invest(ment)?s?|grand total|net value|profit|loss|xirr)\s*[:\-]?\s*$/i

function parseMfRows(rows: unknown[][], cols: Columns<MfField>, validation: RowValidation): Position[] {
  const positions: Position[] = []
  for (const [index, row] of rows.entries()) {
    const schemeCell = cols.scheme != null ? row[cols.scheme] : null
    const schemeStr = schemeCell != null ? String(schemeCell).trim() : ''
    if (SUMMARY_LABELS.test(schemeStr)) continue
    if (!schemeStr) {
      if (hasFinancialData(row, [cols.units, cols.buyPrice, cols.investedValue, cols.lastPrice, cols.currentValue])) {
        rejectRow(validation, index, 'Identity', 'Enter a scheme name for this holding. Financial cells are populated but its identity is missing.')
      }
      continue
    }
    if (schemeStr.length > 500 || oversizedIdentity(row, cols)) {
      rejectRow(validation, index, 'Identity', 'Holding identity fields must be 500 characters or fewer. Shorten the fields before importing.')
      continue
    }

    const units = cols.units != null ? parseNumber(row[cols.units]) : null
    if (units == null || units <= 0 || !safeAmount(units)) {
      rejectRow(validation, index, 'Quantity', 'Enter positive numeric units no greater than 9,007,199,254,740,991; zero, negative, missing and mixed-text units are unsupported.')
      continue
    }

    const cost = validCost(row, cols.buyPrice, cols.investedValue)
    if (!cost) {
      rejectRow(validation, index, 'Cost', 'Enter a non-negative numeric average cost or invested value no greater than 9,007,199,254,740,991. Correct any malformed cost cells.')
      continue
    }
    const { buy, invested } = cost
    const value = cols.currentValue != null ? parseNumber(row[cols.currentValue]) : null
    const last = cols.lastPrice != null ? parseNumber(row[cols.lastPrice]) : null
    if ([[cols.lastPrice, last], [cols.currentValue, value]].some(([column, amount]) => column != null && invalidOptionalNumber(row[column], amount))) {
      rejectRow(validation, index, 'Cost', 'NAV and current value must be valid non-negative INR numbers within the supported range. Correct malformed or foreign currency cells.')
      continue
    }
    const buyPrice = buy ?? invested! / units
    const lastPrice = last ?? (value != null ? value / units : null)
    if (!safeAmount(buyPrice) || !safeAmount(invested ?? units * buyPrice)
      || (lastPrice != null && (!safeAmount(lastPrice) || !safeAmount(lastPrice * units)))) {
      rejectRow(validation, index, 'Cost', 'A derived cost or valuation is too large to value safely.')
      continue
    }
    const amc = cols.amc != null ? String(row[cols.amc] ?? '').trim() : ''
    const category = cols.category != null ? String(row[cols.category] ?? '').trim() : ''
    const subCategory = cols.subCategory != null ? String(row[cols.subCategory] ?? '').trim() : ''
    const folio = cols.folio != null ? String(row[cols.folio] ?? '').trim() : ''
    const source = cols.source != null ? String(row[cols.source] ?? '').trim() : ''
    const returns = cols.returns != null ? parseNumber(row[cols.returns]) : null
    const xirr = cols.xirr != null ? parseNumber(row[cols.xirr], true) : null
    if ([[cols.returns, returns], [cols.xirr, xirr]].some(([column, amount]) => column != null && invalidOptionalNumber(row[column], amount, true))) {
      rejectRow(validation, index, 'Cost', 'Reported returns and XIRR must be valid numbers within the supported range. Correct malformed or foreign currency cells.')
      continue
    }

    const position = prepareHolding({
      id: crypto.randomUUID(),
      // Scheme name serves as the unique key (kept verbatim, not uppercased).
      ticker: schemeStr,
      name: schemeStr,
      type: 'mutual-fund',
      quantity: units,
      buyPrice,
      lastPrice,
      invested: invested ?? units * buyPrice,
      amc,
      category,
      subCategory,
      folio,
      source,
      returns,
      xirr,
      ...identityFields(row, cols),
    }, validation, index)
    if (position) positions.push(position)
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

export function parseSpreadsheetWithDiagnostics(file: ArrayBuffer): SpreadsheetParseResult {
  if (file.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new Error('Portfolio files must be 10 MB or smaller.')
  }
  preflightZip(file)
  const wb = XLSX.read(file, { type: 'array', cellNF: true })
  if (wb.SheetNames.length > MAX_IMPORT_SHEETS) {
    throw new Error(`Spreadsheets are limited to ${MAX_IMPORT_SHEETS} worksheets.`)
  }
  const positions: Position[] = []
  const result: SpreadsheetParseResult = { positions, issues: [], rejectedCount: 0 }
  let totalCells = 0
  const worksheets = wb.SheetNames.map(sheetName => {
    totalCells = validateSheetDimensions(sheetName, wb.Sheets[sheetName], totalCells)
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: true,
    })
    const sheet = wb.Sheets[sheetName]
    const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null
    if (range) {
      for (const [rowIndex, row] of rows.entries()) for (const [columnIndex, value] of row.entries()) {
        if (typeof value !== 'number') continue
        const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r + rowIndex, c: range.s.c + columnIndex })]
        // Excel stores percentage cells as fractions. Ignore quoted or escaped percent signs.
        if (cell?.z?.replace(/"[^"]*"|\\.|_.|\*./g, '').includes('%')) row[columnIndex] = `${value * 100}%`
      }
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new Error(`Each sheet must contain ${MAX_IMPORT_ROWS.toLocaleString()} rows or fewer.`)
    }
    const kite = rows.some(row => isKiteHoldingsHeader(row.map(headerCellText)))
    return { sheetName, sheet, range, rows, kite, kiteCombined: kite && normalizeHeader(sheetName) === 'combined' }
  })
  // Kite repeats its category sheets in Combined. Import that view first and once.
  worksheets.sort((a, b) => Number(b.kiteCombined) - Number(a.kiteCombined))
  let importedKiteCombined = false
  let hasHoldingsHeader = false
  for (const { sheetName, sheet, range, rows, kite, kiteCombined } of worksheets) {
    if (importedKiteCombined && kite && ['equity', 'mutualfunds'].includes(normalizeHeader(sheetName))) continue
    const sheetStart = positions.length
    const defaultType = kite ? normalizeHeader(sheetName) === 'mutualfunds' ? 'mutual-fund' : 'stock' : undefined

    let active: { header: NonNullable<ReturnType<typeof detectHeader>>; headings: string[]; dataStart: number } | null = null
    const appendRows = (end: number) => {
      if (!active) return
      const { header, headings, dataStart } = active
      if (header.mode === 'activity') return
      const moneyColumns = [header.cols.buyPrice, header.cols.investedValue, header.cols.lastPrice, header.cols.currentValue,
        ...(header.mode === 'mf' ? [header.cols.returns, header.cols.xirr] : [])]
      const aliases = Object.values(header.mode === 'mf' ? MF_ALIASES : FIELD_ALIASES).flat()
      const foreignHeaderColumns = new Set(moneyColumns.filter((column): column is number => column != null &&
        (hasForeignMoneyMarker(headings[column]) || hasForeignHeaderCurrencySuffix(headings[column], aliases))))
      const data = rows.slice(dataStart, end).map((row, index) => {
        const values = row.slice()
        for (const column of moneyColumns) {
          if (column == null) continue
          if (foreignHeaderColumns.has(column) && !isUnavailableNumber(values[column])) {
            values[column] = `${values[column]} ${headings[column]}`
            continue
          }
          if (!range) continue
          const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r + dataStart + index, c: range.s.c + column })]
          if (cell?.t !== 'n') continue
          const formatted = XLSX.utils.format_cell(cell)
          if (hasForeignMoneyMarker(formatted)) values[column] = formatted
        }
        return values
      })
      const validation = { sheet: sheetName, startRow: dataStart, result }
      const parsed = header.mode === 'mf'
        ? parseMfRows(data, header.cols, validation)
        : parseEquityRows(data, header.cols, validation, defaultType, header.nameOnly)
      positions.push(...parsed)
      if (positions.length > MAX_IMPORT_POSITIONS) {
        throw new Error(`Portfolio imports are limited to ${MAX_IMPORT_POSITIONS.toLocaleString()} holdings.`)
      }
    }
    for (let i = 0; i < rows.length; i++) {
      let headings = rows[i].map(headerCellText)
      let header = detectHeader(headings)
      let consumed = 1
      if (i + 1 < rows.length) {
        const combinedHeadings = combineHeaderRow(rows[i], rows[i + 1])
        const combined = detectHeader(combinedHeadings)
        if (combined && (!header || fieldCount(combined.cols) > fieldCount(header.cols))) {
          header = combined
          headings = combinedHeadings
          consumed = 2
        }
      }
      if (!header) continue
      if (header.mode !== 'activity') hasHoldingsHeader = true
      appendRows(i)
      active = { header, headings, dataStart: i + consumed }
      i += consumed - 1
    }
    appendRows(rows.length)
    if (kiteCombined && positions.length > sheetStart) importedKiteCombined = true
  }
  if (positions.length > 0) return result
  if (result.rejectedCount > 0) {
    const first = result.issues[0]
    throw new Error(`No valid holdings found. ${result.rejectedCount} row(s) rejected. ${first.sheet}, row ${first.row}: ${first.field} - ${first.message}`)
  }
  if (hasHoldingsHeader) return result

  throw new Error(
    'No recognizable holdings header found. Use Ticker or Symbol with Quantity and Buy Price for equities, or Scheme Name with Units and Invested Value for mutual funds.',
  )
}

function hasForeignMoneyMarker(value: string): boolean {
  return /\p{Sc}/u.test(value.replace(/₹/g, '')) ||
    (value.match(/[a-z]+/gi) ?? []).some(code => code.toUpperCase() !== 'INR' && isCurrencyCode(code))
}

function hasForeignHeaderCurrencySuffix(value: string, aliases: string[]): boolean {
  const normalized = normalizeHeader(value)
  return aliases.some(alias => {
    const candidate = normalizeHeader(alias)
    if (!normalized.startsWith(candidate)) return false
    const code = currencyCodeSuffix(normalized.slice(candidate.length))
    return code != null && code !== 'INR'
  })
}
