import type { LiveQuote, Position } from './types'
import { effectivePrice, positionValue } from './valuation'

export const MARKET_CAP_STORAGE_KEY = 'finverse:market-cap:v1'
export const CAP_BANDS = ['large', 'mid', 'small', 'other', 'funds', 'unclassified'] as const
export type CapBand = typeof CAP_BANDS[number]
export const CAP_LABELS: Record<CapBand, string> = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap', other: 'Other assets', funds: 'ETF + Mutual Funds', unclassified: 'Unclassified' }
export interface MarketCapRecord {
  asOf: string
  isin: string
  name: string
  band: Exclude<CapBand, 'unclassified' | 'funds'>
  weight: number
  parentIsin: string
  source: string
}
const MAX_ROWS = 20_000
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/

export function parseMarketCapRecords(value: unknown, now = Date.now()): MarketCapRecord[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) throw new Error('Use at most 20,000 classification rows.')
  const today = new Date(now + 330 * 60_000).toISOString().slice(0, 10)
  const keys = new Set<string>()
  const totals = new Map<string, number>()
  return value.map((item, index) => {
    const fail = (message: string): never => { throw new Error(`Row ${index + 1}: ${message}`) }
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail('invalid classification.')
    const row = item as Record<string, unknown>
    const text = (key: string, required = true) => {
      const entry = row[key]
      if (typeof entry !== 'string' || entry.length > 500 || (required && !entry.trim())) return fail(`check ${key}.`)
      return entry.trim()
    }
    const asOf = text('asOf')
    const at = Date.parse(`${asOf}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== asOf || asOf > today) return fail('use a valid past or current disclosure date.')
    const isin = text('isin').toUpperCase()
    const parentIsin = text('parentIsin', false).toUpperCase()
    if (!ISIN.test(isin) || (parentIsin && !ISIN.test(parentIsin))) return fail('use exact 12-character ISINs.')
    const band = text('band').toLowerCase()
    if (!['large', 'mid', 'small', 'other'].includes(band)) return fail('cap_band must be large, mid, small or other.')
    const weight = row.weight
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 100 || (!parentIsin && weight !== 100)) return fail('weight_pct must be above 0 and at most 100; direct classifications use 100.')
    const key = JSON.stringify([parentIsin, asOf, isin])
    if (keys.has(key)) return fail('duplicate ISIN in the same dated disclosure.')
    keys.add(key)
    if (parentIsin) {
      const group = `${parentIsin}:${asOf}`
      const total = (totals.get(group) ?? 0) + weight
      if (total > 100.000001) return fail('fund weights exceed 100% for this disclosure date.')
      totals.set(group, total)
    }
    return { asOf, isin, parentIsin, band: band as MarketCapRecord['band'], weight, name: text('name'), source: text('source') }
  })
}

export interface CapExposureMember { id: string; positionId: string; name: string; value: number; asOf: string | null; source: string | null }
export interface CapExposureBucket { band: CapBand; label: string; value: number; weight: number; members: CapExposureMember[] }
export function calculateMarketCapExposure(positions: Position[], quotes: Record<string, LiveQuote>, records: MarketCapRecord[]) {
  const direct = new Map<string, MarketCapRecord>()
  const fundDates = new Map<string, string>()
  for (const record of records) {
    if (record.parentIsin) {
      if (record.asOf > (fundDates.get(record.parentIsin) ?? '')) fundDates.set(record.parentIsin, record.asOf)
    } else if (record.asOf > (direct.get(record.isin)?.asOf ?? '')) direct.set(record.isin, record)
  }
  const funds = new Map<string, MarketCapRecord[]>()
  for (const record of records) if (record.parentIsin && record.asOf === fundDates.get(record.parentIsin)) {
    const entries = funds.get(record.parentIsin) ?? []
    entries.push(record)
    funds.set(record.parentIsin, entries)
  }
  const buckets: CapExposureBucket[] = CAP_BANDS.map((band) => ({ band, label: CAP_LABELS[band], value: 0, weight: 0, members: [] }))
  const byBand = new Map(buckets.map((bucket) => [bucket.band, bucket]))
  const dates = new Set<string>()
  let total = 0, unpricedCount = 0
  const add = (band: CapBand, position: Position, value: number, record?: MarketCapRecord) => {
    if (value <= 0) return
    const bucket = byBand.get(band)!
    bucket.value += value
    bucket.members.push({ id: `${position.id}:${bucket.members.length}`, positionId: position.id, name: record?.parentIsin ? `${position.name || position.ticker} · ${record.name}` : position.name || position.ticker, value, asOf: record?.asOf ?? null, source: record?.source ?? null })
    if (record) dates.add(record.asOf)
  }
  for (const position of positions) {
    if (effectivePrice(position, quotes) === null) { unpricedCount++; continue }
    const value = positionValue(position, quotes)
    if (!Number.isFinite(value) || value <= 0) continue
    total += value
    const isin = position.isin?.trim().toUpperCase()
    const classification = isin && !position.identityIssue ? direct.get(isin) : undefined
    if (position.type === 'stock' && classification) add(classification.band, position, value, classification)
    else if ((position.type === 'mutual-fund' || position.type === 'etf') && isin && !position.identityIssue && funds.has(isin)) {
      let allocated = 0
      for (const record of funds.get(isin)!) {
        const amount = value * record.weight / 100
        add(record.band, position, amount, record)
        allocated += amount
      }
      add('funds', position, Math.max(0, value - allocated))
    } else if (classification?.band === 'other') add('other', position, value, classification)
    else if (position.type === 'etf' || position.type === 'mutual-fund') add('funds', position, value)
    else add('unclassified', position, value)
  }
  for (const bucket of buckets) bucket.weight = total > 0 ? bucket.value / total * 100 : 0
  return { buckets, total, unpricedCount, coveragePct: total > 0 ? Math.max(0, Math.min(100, 100 - byBand.get('unclassified')!.weight - byBand.get('funds')!.weight)) : 0, dates: [...dates].sort() }
}
