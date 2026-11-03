import type { LiveQuote, Position } from './types'
import { effectivePrice } from './valuation'
export const LEDGER_STORAGE_KEY = 'finverse:investment-ledger:v1'

export const LEDGER_TYPES = ['buy', 'sell', 'dividend', 'interest', 'fee', 'deposit', 'withdrawal'] as const
export interface LedgerRecord {
  id: string
  accountId: string
  date: string
  type: typeof LEDGER_TYPES[number]
  isin?: string
  ticker?: string
  exchange?: 'NSE' | 'BSE' | 'OTHER'
  quantity: number
  amount: number
  currency: 'INR'
}
export type LedgerPosition = Position & { accountId?: string }
export interface LedgerHolding {
  key: string
  securityKey: string
  accountId: string
  label: string
  value: number
  buys: number
  sells: number
  income: number
  fees: number
  gain: number
  quantity: number
}
export interface LedgerPeriod {
  complete: boolean
  issues: string[]
  gain: number | null
  holdings: LedgerHolding[]
}
export interface LedgerPerformance {
  complete: boolean
  issues: string[]
  xirr: number | null
  invested: number
  proceeds: number
  income: number
  fees: number
  currentValue: number
  gain: number | null
  netInvested: number
  contributions: number
  withdrawals: number
  fyIncome: { dividends: number; interest: number; total: number }
  holdings: LedgerHolding[]
  period: LedgerPeriod | null
}

export function ledgerToday(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10)
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

function optionalText(value: unknown, maximum = 200): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error('A transaction contains invalid identity text.')
  return value.trim()
}

export function validateLedgerRecords(value: unknown, today = ledgerToday()): LedgerRecord[] {
  if (!validDate(today)) throw new Error('The transaction review date is invalid.')
  if (!Array.isArray(value) || value.length > 50_000) throw new Error('Transaction files support up to 50,000 records.')
  const records = value.map((item): LedgerRecord => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('A transaction row is invalid.')
    const row = item as Record<string, unknown>
    const id = optionalText(row.id)
    const accountId = optionalText(row.accountId, 500)
    if (!id || !accountId) throw new Error('Every transaction needs an ID and an account.')
    if (!validDate(row.date) || row.date > today) throw new Error(`Transaction ${id} needs a valid date that is not in the future.`)
    if (!LEDGER_TYPES.includes(row.type as LedgerRecord['type'])) throw new Error(`Transaction ${id} has an unsupported type.`)
    if (row.currency !== 'INR') throw new Error(`Transaction ${id} must use INR.`)
    if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0 || row.amount > Number.MAX_SAFE_INTEGER) throw new Error(`Transaction ${id} needs a positive cash amount.`)
    if (typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity < 0 || row.quantity > Number.MAX_SAFE_INTEGER) throw new Error(`Transaction ${id} has an invalid quantity.`)
    const type = row.type as LedgerRecord['type']
    const isin = optionalText(row.isin)?.toUpperCase()
    const ticker = optionalText(row.ticker)?.toUpperCase()
    const exchange = optionalText(row.exchange)?.toUpperCase()
    if (isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) throw new Error(`Transaction ${id} has an invalid ISIN.`)
    if (exchange && !['NSE', 'BSE', 'OTHER'].includes(exchange)) throw new Error(`Transaction ${id} has an unsupported exchange.`)
    if (['buy', 'sell', 'dividend'].includes(type) && !isin && !(ticker && exchange)) throw new Error(`Transaction ${id} needs an ISIN or both ticker and exchange.`)
    if ((type === 'buy' || type === 'sell') ? row.quantity <= 0 : row.quantity !== 0) throw new Error(`Transaction ${id} needs a positive quantity for trades and zero for other payments.`)
    return { id, accountId, date: row.date, type, quantity: row.quantity, amount: row.amount, currency: 'INR', ...(isin ? { isin } : {}), ...(ticker ? { ticker } : {}), ...(exchange ? { exchange: exchange as LedgerRecord['exchange'] } : {}) }
  })
  return mergeLedgerRecords([], records)
}

function csvRows(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, closed = false
  for (let index = 0; index < content.length; index++) {
    const character = content[index]
    if (quoted) {
      if (character !== '"') field += character
      else if (content[index + 1] === '"') { field += '"'; index++ }
      else { quoted = false; closed = true }
    } else if (character === '"' && !field && !closed) quoted = true
    else if (character === ',') { row.push(field); field = ''; closed = false }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && content[index + 1] === '\n') index++
      row.push(field)
      if (row.some((cell) => cell.trim())) rows.push(row)
      if (rows.length > 50_001) throw new Error('Transaction files support up to 50,000 records.')
      row = []; field = ''; closed = false
    } else {
      if (closed || character === '"') throw new Error('The transaction CSV contains malformed quotes.')
      field += character
    }
  }
  if (quoted) throw new Error('The transaction CSV contains an unclosed quoted field.')
  row.push(field)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

export function parseLedgerCsv(content: string, accountId: string, today = ledgerToday()): LedgerRecord[] {
  if (content.length > 5 * 1024 * 1024) throw new Error('Transaction CSV files must be 5 MB or smaller.')
  const rows = csvRows(content.replace(/^\uFEFF/, ''))
  if (rows.length < 2) throw new Error('The transaction CSV needs a header and at least one transaction.')
  const headers = rows[0].map((header) => header.trim().toLowerCase())
  if (new Set(headers).size !== headers.length || ['id', 'date', 'type', 'quantity', 'amount', 'currency'].some((header) => !headers.includes(header))) throw new Error('Use the transaction template headers: id,date,type,isin,ticker,exchange,quantity,amount,currency.')
  const records = rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`Transaction CSV row ${index + 2} has the wrong number of columns.`)
    const row = Object.fromEntries(headers.map((header, column) => [header, cells[column].trim()]))
    const numeric = (text: string) => /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN
    return { ...row, accountId, type: row.type.toLowerCase(), quantity: numeric(row.quantity), amount: numeric(row.amount), currency: row.currency.toUpperCase() }
  })
  return validateLedgerRecords(records, today)
}

export function mergeLedgerRecords(existing: LedgerRecord[], incoming: LedgerRecord[]): LedgerRecord[] {
  const merged = new Map<string, LedgerRecord>()
  for (const record of [...existing, ...incoming]) {
    const key = JSON.stringify([record.accountId, record.id])
    const previous = merged.get(key)
    if (previous && ['date', 'type', 'isin', 'ticker', 'exchange', 'quantity', 'amount', 'currency'].some((field) => previous[field as keyof LedgerRecord] !== record[field as keyof LedgerRecord])) throw new Error(`Transaction ID ${record.id} conflicts with a saved record. Use a different ID or correct the source file.`)
    merged.set(key, record)
  }
  return [...merged.values()].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
}

type SecurityIdentity = { isin?: string; ticker?: string; exchange?: string }

export function ledgerSecurityKey(row: SecurityIdentity): string {
  return row.isin ? `ISIN:${row.isin.trim().toUpperCase()}` : row.ticker && row.exchange ? `${row.exchange}:${row.ticker.trim().toUpperCase()}` : ''
}
export function ledgerHoldingKey(row: SecurityIdentity & { accountId?: string }): string {
  return JSON.stringify([row.accountId ?? '', ledgerSecurityKey(row)])
}

/** Enrich only exact account/listing matches. Conflicting or unresolved identities stay separate. */
export function matchLedgerRecords(records: LedgerRecord[], positions: LedgerPosition[]): LedgerRecord[] {
  const candidates = new Map<string, Set<string>>()
  const listing = (row: SecurityIdentity & { accountId?: string }): string | null => {
    if (!row.accountId || !row.ticker?.trim() || !row.exchange?.trim()) return null
    return JSON.stringify([row.accountId, row.ticker.trim().toUpperCase(), row.exchange.trim().toUpperCase()])
  }
  const add = (row: SecurityIdentity & { accountId?: string }) => {
    const key = listing(row), isin = row.isin?.trim().toUpperCase()
    if (!key || !isin || !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return
    const values = candidates.get(key) ?? new Set<string>()
    values.add(isin)
    candidates.set(key, values)
  }
  for (const position of positions) if (!position.identityIssue) add(position)
  for (const record of records) add(record)
  return records.map((record) => {
    if (record.isin) return record
    const key = listing(record), values = key ? candidates.get(key) : undefined
    return values?.size === 1 ? { ...record, isin: [...values][0] } : record
  })
}

/** Returns one unambiguous annualized percentage; multiple roots remain unavailable. */
export function calculateXirr(flows: { date: string; amount: number }[]): number | null {
  if (!flows.length || flows.some((flow) => !validDate(flow.date) || !Number.isFinite(flow.amount))) return null
  const grouped = new Map<string, number>()
  for (const flow of flows) grouped.set(flow.date, (grouped.get(flow.date) ?? 0) + flow.amount)
  const points = [...grouped].filter(([, amount]) => Math.abs(amount) > 1e-8).sort(([a], [b]) => a.localeCompare(b))
  if (points.length < 2 || !points.some(([, amount]) => amount > 0) || !points.some(([, amount]) => amount < 0)) return null
  const start = Date.parse(points[0][0])
  const scale = Math.max(...points.map(([, amount]) => Math.abs(amount)))
  const values = points.map(([date, amount]) => ({ years: (Date.parse(date) - start) / 86_400_000 / 365, amount: amount / scale }))
  const npv = (logRate: number) => values.reduce((sum, flow) => sum + flow.amount * Math.exp(-logRate * flow.years), 0)
  const roots: number[] = []
  let left = -20, leftValue = npv(left)
  for (let step = 1; step <= 800; step++) {
    const right = -20 + step * 0.05, rightValue = npv(right)
    if (Math.abs(rightValue) < 1e-12) roots.push(right)
    else if (leftValue * rightValue < 0) {
      let low = left, high = right, lowValue = leftValue
      for (let attempt = 0; attempt < 90; attempt++) {
        const middle = (low + high) / 2, middleValue = npv(middle)
        if (lowValue * middleValue <= 0) high = middle
        else { low = middle; lowValue = middleValue }
      }
      roots.push((low + high) / 2)
    }
    left = right; leftValue = rightValue
  }
  const unique = roots.filter((root, index) => index === 0 || Math.abs(root - roots[index - 1]) > 1e-6)
  return unique.length === 1 ? Math.expm1(unique[0]) * 100 : null
}

export function calculateLedgerPerformance(
  input: LedgerRecord[], positions: LedgerPosition[], quotes: Record<string, LiveQuote> = {},
  asOfDate = ledgerToday(), range?: { from: string; to: string }, openingValues: Record<string, number> = {},
): LedgerPerformance {
  const records = validateLedgerRecords(input, asOfDate)
  const perAccount = positions.length === 0 || positions.some((position) => position.accountId !== undefined)
  const keyOf = (row: SecurityIdentity & { accountId?: string }) => perAccount ? ledgerHoldingKey(row) : ledgerHoldingKey({ ...row, accountId: '' })
  const groups = new Map<string, LedgerHolding>()
  const issues: string[] = []
  const issue = (message: string) => { if (!issues.includes(message)) issues.push(message) }
  const quantities = new Map<string, number>()
  const openingQuantities = new Map<string, number>()
  const flows: { date: string; amount: number }[] = []
  const group = (row: SecurityIdentity & { accountId?: string; name?: string }) => {
    const key = keyOf(row)
    if (!groups.has(key)) groups.set(key, { key, securityKey: ledgerSecurityKey(row), accountId: perAccount ? row.accountId ?? '' : '', label: row.name || row.ticker || row.isin || 'Account payments', value: 0, buys: 0, sells: 0, income: 0, fees: 0, gain: 0, quantity: 0 })
    return groups.get(key)!
  }
  let invested = 0, proceeds = 0, income = 0, fees = 0, contributions = 0, withdrawals = 0
  let dividends = 0, interest = 0
  const year = Number(asOfDate.slice(0, 4)) - (Number(asOfDate.slice(5, 7)) < 4 ? 1 : 0)
  const fyStart = `${year}-04-01`
  const ordered = [...records].sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'buy' ? -1 : 0) - (b.type === 'buy' ? -1 : 0))
  for (const record of ordered) {
    if (record.type === 'deposit') { contributions += record.amount; continue }
    if (record.type === 'withdrawal') { withdrawals += record.amount; continue }
    const holding = group(record)
    const key = holding.key
    if (record.type === 'buy' || record.type === 'sell') {
      const quantity = (quantities.get(key) ?? 0) + (record.type === 'buy' ? record.quantity : -record.quantity)
      quantities.set(key, quantity)
      if (quantity < -1e-6) issue(`${holding.label}: sales exceed recorded purchases. Import the full history, including transfers or corporate-action adjustments.`)
      if (range && record.date < range.from) openingQuantities.set(key, quantity)
      if (record.type === 'buy') { holding.buys += record.amount; invested += record.amount; flows.push({ date: record.date, amount: -record.amount }) }
      else { holding.sells += record.amount; proceeds += record.amount; flows.push({ date: record.date, amount: record.amount }) }
    } else if (record.type === 'fee') {
      holding.fees += record.amount; fees += record.amount; flows.push({ date: record.date, amount: -record.amount })
    } else {
      holding.income += record.amount; income += record.amount; flows.push({ date: record.date, amount: record.amount })
      if (record.date >= fyStart) {
        if (record.type === 'dividend') dividends += record.amount
        else interest += record.amount
      }
    }
  }
  const pricedQuantities = new Map<string, number>()
  for (const position of positions) {
    const holding = group(position)
    holding.label = position.name || position.ticker
    const price = effectivePrice(position, quotes)
    if (price === null && position.quantity > 0) issue(`${holding.label}: a current INR valuation is unavailable.`)
    holding.value += price === null ? 0 : position.quantity * price
    pricedQuantities.set(holding.key, (pricedQuantities.get(holding.key) ?? 0) + position.quantity)
  }
  for (const holding of groups.values()) {
    holding.gain = holding.value + holding.sells + holding.income - holding.buys - holding.fees
    if (!holding.securityKey) continue
    holding.quantity = quantities.get(holding.key) ?? 0
    const currentQuantity = pricedQuantities.get(holding.key) ?? 0
    if (Math.abs(holding.quantity - currentQuantity) > Math.max(1e-6, Math.abs(currentQuantity) * 1e-6)) issue(`${holding.label}: recorded trades do not match the current quantity. Import complete history for this account.`)
  }
  if (!records.some((record) => record.type === 'buy')) issue('Import purchase history to calculate investment returns.')
  const holdings = [...groups.values()]
  const currentValue = holdings.reduce((sum, holding) => sum + holding.value, 0)
  if (currentValue > 0) flows.push({ date: asOfDate, amount: currentValue })
  const complete = issues.length === 0
  let period: LedgerPeriod | null = null
  if (range) {
    const periodIssues: string[] = []
    if (!validDate(range.from) || !validDate(range.to) || range.from > range.to || range.to !== asOfDate) periodIssues.push('Choose a valid start date through the current valuation date.')
    const periodRecords = new Map<string, LedgerRecord[]>()
    for (const record of records) {
      if (record.date < range.from || record.date > range.to || record.type === 'deposit' || record.type === 'withdrawal') continue
      const key = keyOf(record)
      const matching = periodRecords.get(key) ?? []
      matching.push(record)
      periodRecords.set(key, matching)
    }
    const periodHoldings = holdings.map((holding) => {
      const openingQuantity = openingQuantities.get(holding.key) ?? 0
      const openingValue = openingQuantity > 1e-6 ? openingValues[holding.key] : 0
      if (openingValue === undefined || !Number.isFinite(openingValue) || openingValue < 0) periodIssues.push(`${holding.label}: the opening market value is required for this period.`)
      const matching = periodRecords.get(holding.key) ?? []
      const sum = (type: LedgerRecord['type']) => matching.filter((record) => record.type === type).reduce((total, record) => total + record.amount, 0)
      const buys = sum('buy'), sells = sum('sell'), received = sum('dividend') + sum('interest'), costs = sum('fee')
      return { ...holding, buys, sells, income: received, fees: costs, gain: holding.value - (openingValue ?? 0) + sells + received - buys - costs }
    })
    period = { complete: complete && !periodIssues.length, issues: [...issues, ...periodIssues], gain: complete && !periodIssues.length ? periodHoldings.reduce((sum, holding) => sum + holding.gain, 0) : null, holdings: periodHoldings }
  }
  return {
    complete, issues, xirr: complete ? calculateXirr(flows) : null, invested, proceeds, income, fees,
    currentValue, gain: complete ? currentValue + proceeds + income - invested - fees : null,
    netInvested: invested - proceeds, contributions, withdrawals, fyIncome: { dividends, interest, total: dividends + interest }, holdings, period,
  }
}
