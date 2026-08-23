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

type FieldKey = 'ticker' | 'quantity' | 'buyPrice' | 'lastPrice' | 'name' | 'type'

const FIELD_ALIASES: Record<FieldKey, string[]> = {
  ticker: ['ticker', 'symbol', 'code', 'script', 'isin', 'instrument', 'name'],
  quantity: ['quantity', 'qty', 'units', 'shares', 'noofunits', 'no of units', 'held', 'pos'],
  buyPrice: [
    'buyprice',
    'buy price',
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
  lastPrice: [
    'lastprice',
    'last price',
    'lasttradedprice',
    'ltp',
    'currentprice',
    'marketprice',
    'market price',
    'previous closing price',
    'previous close',
    'close',
    'closing',
    'prev',
  ],
  name: ['company', 'companyname', 'securityname', 'fund', 'fundname', 'scheme', 'description'],
  type: ['type', 'assettype', 'assetclass', 'class', 'category'],
}

type MfField =
  | 'scheme'
  | 'units'
  | 'investedValue'
  | 'currentValue'
  | 'amc'
  | 'category'
  | 'subCategory'
  | 'folio'
  | 'source'
  | 'returns'
  | 'xirr'

const MF_ALIASES: Record<MfField, string[]> = {
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

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[\s\-_.()/]/g, '')
}

function normalizeHeader(s: string): string {
  return normalize(s).replace(/[^a-z0-9]/g, '')
}

/**
 * Turn an unknown value into a string for header scoring, tolerating merged
 * cells, date cells and stored numbers.
 */
function headerCellText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return String(v)
  return String(v).trim()
}

/**
 * Rebuild a header row after horizontal merges. Excel only writes *one* cell per
 * merged run, leaving the rest empty (null), so a truly merged header like
 * "Scheme Name" spanning columns A-C becomes ["Scheme Name", null, null, ...].
 * We fill those gaps left-to-right so subsequent cells can still be matched.
 */
function fillMerged(head: readonly unknown[]): string[] {
  let carry: string | null = null
  return head.map((v) => {
    const t = headerCellText(v)
    if (t !== '') {
      carry = t
      return t
    }
    if (carry != null) return carry
    return ''
  })
}

/**
 * Score how well a header matches a field's aliases.
 * Exact header == alias scores highest; otherwise the longest matching alias.
 * Generic aliases like 'price'/'type' get low scores so they lose to specific ones.
 */
function matchScore(head: string, aliases: string[]): number {
  const h = normalizeHeader(head)
  if (!h) return 0
  let best = 0
  for (const a of aliases) {
    const an = normalizeHeader(a)
    if (!an) continue
    if (h === an) {
      best = Math.max(best, 200 + an.length)
    } else if (h.includes(an) || an.includes(h)) {
      best = Math.max(best, an.length)
    }
  }
  return best
}

/**
 * Assign columns to fields greedily. Each column is claimed by the highest-scoring
 * field, and no column is reused across fields.
 */
function assignFields(head: string[]): { [k in FieldKey]: number | null } {
  const keys = Object.keys(FIELD_ALIASES) as FieldKey[]
  const out: { [k in FieldKey]: number | null } = {
    ticker: null,
    quantity: null,
    buyPrice: null,
    lastPrice: null,
    name: null,
    type: null,
  }

  const candidates: { key: FieldKey; col: number; score: number }[] = []
  for (const key of keys) {
    for (let col = 0; col < head.length; col++) {
      const score = matchScore(head[col], FIELD_ALIASES[key])
      if (score > 0) candidates.push({ key, col, score })
    }
  }

  // Highest score first, then field priority, then column order.
  const order: Record<FieldKey, number> = {
    ticker: 0,
    quantity: 1,
    buyPrice: 2,
    lastPrice: 3,
    name: 4,
    type: 5,
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score || order[a.key] - order[b.key] || a.col - b.col,
  )

  const taken = new Set<number>()
  for (const c of candidates) {
    if (out[c.key] != null) continue
    if (taken.has(c.col)) continue
    out[c.key] = c.col
    taken.add(c.col)
  }
  return out
}

function bestColumn(head: string[], aliases: string[]): number | null {
  let bestCol: number | null = null
  let bestScore = 0
  for (let col = 0; col < head.length; col++) {
    const score = matchScore(head[col], aliases)
    if (score > bestScore) {
      bestScore = score
      bestCol = col
    }
  }
  return bestCol
}

function assignMfFields(head: string[]): { [k in MfField]: number | null } {
  const keys = Object.keys(MF_ALIASES) as MfField[]
  const out = {} as { [k in MfField]: number | null }
  for (const k of keys) out[k] = bestColumn(head, MF_ALIASES[k])
  return out
}

function looksLikeHeaderRow(row: readonly unknown[]): boolean {
  const head = row.map((c) => headerCellText(c))
  const cols = assignFields(fillMerged(head))
  return (
    cols.ticker != null &&
    (cols.quantity != null || cols.buyPrice != null || cols.lastPrice != null)
  )
}

/** A mutual-fund sheet is recognized by a scheme column plus value/units columns. */
function looksLikeMfHeaderRow(row: readonly unknown[]): boolean {
  const cols = assignMfFields(fillMerged(row))
  // Scheme column present — treat any MF-ish digit column as confirmation.
  if (cols.scheme != null) {
    return (
      cols.units != null ||
      cols.investedValue != null ||
      cols.currentValue != null ||
      cols.xirr != null
    )
  }
  // No "scheme" word found: require XIRR (the classic fund-only column) plus any
  // value/units. This keeps equity-like "Qty + Avg. cost + LTP" sheets out.
  return cols.xirr != null && (cols.units != null || cols.currentValue != null || cols.investedValue != null)
}

/** Score a candidate row by how many MF-ish columns it carries (for fallback). */
function mfHeaderScore(row: readonly unknown[]): number {
  const cols = assignMfFields(fillMerged(row))
  let n = 0
  if (cols.scheme != null) n += 2
  if (cols.units != null) n += 1
  if (cols.investedValue != null) n += 1
  if (cols.currentValue != null) n += 1
  if (cols.xirr != null) n += 1
  // A XIRR OR Current Value column is the classic MF-only fingerprint.
  if (cols.xirr != null || cols.currentValue != null) n += 2
  return n
}

/** Score a candidate row by how many equity-ish columns it carries. */
function equityHeaderScore(row: readonly unknown[]): number {
  const cols = assignFields(fillMerged(row))
  let n = 0
  if (cols.ticker != null) n += 3
  if (cols.quantity != null) n += 1
  if (cols.buyPrice != null) n += 1
  if (cols.lastPrice != null) n += 1
  return n
}

function parseNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = String(v).trim()
  // Parenthetical negatives: (1,234.50) => -1234.5
  const neg = s.startsWith('(') && s.endsWith(')')
  const n = Number(s.replace(/[^0-9.-]/g, '')) * (neg ? -1 : 1)
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

function parseEquityColumnRow(
  rows: unknown[][],
  dataStart: number,
  cols: ReturnType<typeof assignFields>,
): Position[] {
  const positions: Position[] = []
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i]
    const ticker = cols.ticker != null ? row[cols.ticker] : null
    if (ticker == null || String(ticker).trim() === '') continue

    const qtyRaw = cols.quantity != null ? parseNumber(row[cols.quantity]) : null
    const buyRaw = cols.buyPrice != null ? parseNumber(row[cols.buyPrice]) : null
    const lastRaw = cols.lastPrice != null ? parseNumber(row[cols.lastPrice]) : null
    // Skip blank / total / summary rows that have no numeric figures at all.
    if (qtyRaw == null && buyRaw == null && lastRaw == null) continue

    positions.push({
      id: crypto.randomUUID(),
      ticker: String(ticker).trim().toUpperCase(),
      name: cols.name != null ? String(row[cols.name] ?? '').trim() : '',
      // An equity-shaped header has already been detected. Broker exports
      // commonly omit an explicit Type column, and those rows are stocks.
      type: cols.type != null ? inferType(row[cols.type]) : 'stock',
      quantity: qtyRaw ?? 0,
      buyPrice: buyRaw ?? 0,
      lastPrice: lastRaw,
      invested: (qtyRaw ?? 0) * (buyRaw ?? 0),
    })
  }
  return positions
}

const SUMMARY_LABELS =
  /^\s*(total|summary|summ ary|holdings summary|invested values|total invest(ment)?s?|grand total|net value|profit|loss|xirr)\b/i

function parseMfRows(
  rows: unknown[][],
  dataStart: number,
  cols: ReturnType<typeof assignMfFields>,
): Position[] {
  const positions: Position[] = []
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i]
    const schemeCell = cols.scheme != null ? row[cols.scheme] : null
    const schemeStr = schemeCell != null ? String(schemeCell).trim() : ''
    if (schemeStr === '' || SUMMARY_LABELS.test(schemeStr)) continue

    const units = cols.units != null ? parseNumber(row[cols.units]) : null
    if (units == null) continue // skip blank/summary rows

    const invested = cols.investedValue != null ? parseNumber(row[cols.investedValue]) : null
    const value = cols.currentValue != null ? parseNumber(row[cols.currentValue]) : null
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
      buyPrice: invested != null && units > 0 ? invested / units : (invested ?? 0),
      lastPrice: value != null && units > 0 ? value / units : null,
      invested: invested ?? ((invested != null ? invested : 0)),
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
    out.push(ta !== '' ? ta : tb)
  }
  return fillMerged(out)
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

    // ---- Detect the true header (skip title / blank / meta rows) ----
    // A header can be one row, or two vertically-merged rows (fund exports often
    // split "Scheme Name" from the Units/Invested/Current block). Track the
    // strongest candidates and the first data row below the chosen header.
    let headerIndex = -1
    let mfMode = false
    let headerRow = 1 // rows consumed by the header (1 or 2)
    let headCells: string[] | null = null
    let bestEq = 0
    let bestMf = 0
    let fallbackEq = -1
    let fallbackMf = -1

    for (let i = 0; i < rows.length; i++) {
      const singleMf = looksLikeMfHeaderRow(rows[i])
      const singleEq = looksLikeHeaderRow(rows[i])
      if (singleMf || singleEq) {
        headerIndex = i
        mfMode = singleMf
        headerRow = 1
        headCells = fillMerged(rows[i])
        break
      }
      // Two-row vertical merge (scheme export style).
      if (i + 1 < rows.length) {
        const combined = combineHeaderRow(rows[i], rows[i + 1])
        const comboMf = looksLikeMfHeaderRow(combined)
        const comboEq = looksLikeHeaderRow(combined)
        if (comboMf || comboEq) {
          headerIndex = i
          mfMode = comboMf
          headerRow = 2
          headCells = combined
          break
        }
      }
      const eqScore = equityHeaderScore(rows[i])
      const mfScore = mfHeaderScore(rows[i])
      if (eqScore > bestEq) {
        bestEq = eqScore
        fallbackEq = i
      }
      if (mfScore > bestMf) {
        bestMf = mfScore
        fallbackMf = i
      }
    }

    if (headerIndex === -1) {
      // No strict header found — use the best-scoring candidate (handles sheets
      // whose header cells are stored oddly). Parsing below discards garbage.
      if (bestMf >= 4 && (bestMf > bestEq || bestEq < 4)) {
        headerIndex = fallbackMf
        mfMode = true
        headerRow = 1
        headCells = fillMerged(rows[headerIndex])
      } else if (bestEq >= 4) {
        headerIndex = fallbackEq
        mfMode = false
        headerRow = 1
        headCells = fillMerged(rows[headerIndex])
      }
    }
    if (headerIndex === -1 || headCells == null) continue // try next sheet

    const dataStart = headerIndex + headerRow
    const positions = mfMode
      ? parseMfRows(rows, dataStart, assignMfFields(headCells))
      : parseEquityColumnRow(rows, dataStart, assignFields(headCells))
    if (positions.length > MAX_IMPORT_POSITIONS) {
      throw new Error(`Portfolio imports are limited to ${MAX_IMPORT_POSITIONS.toLocaleString()} holdings.`)
    }
    if (positions.length > 0) return positions
  }
  // Help the user fix the sheet: name the sheets we looked at and dump rows.
  const sample = wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      defval: null,
      raw: true,
    })
    const preview = rows
      .filter((r) => r.length > 1 && r.some((c) => c != null && String(c).trim() !== ''))
      .slice(0, 4)
      .map((r) =>
        r
          .map((c) => (c == null ? '' : String(c).trim()).slice(0, 18))
          .slice(0, 10)
          .join(' │ '),
      )
    return `${name}:\n  ${preview.join('\n  ') || '(empty)'}`
  })
  throw new Error(
    `No recognizable header found. Look for a row with a Ticker/Symbol (equity) or Scheme/Fund name (mutual funds) column plus Units / Invested / Current value. Scanned sheets:\n${sample.join('\n\n')}`,
  )
}
