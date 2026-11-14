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
