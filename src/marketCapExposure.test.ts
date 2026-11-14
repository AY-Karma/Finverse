import { describe, expect, it } from 'vitest'
import { calculateMarketCapExposure, parseMarketCapRecords, type MarketCapRecord } from './marketCapExposure'
import type { Position } from './types'

const NOW = Date.UTC(2026, 9, 31)
const STOCK = 'INE002A01018'
const STOCK_TWO = 'INE009A01021'
const FUND = 'INF179K01BE2'
const record = (changes: Partial<MarketCapRecord> = {}): MarketCapRecord => ({ asOf: '2026-09-30', isin: STOCK, name: 'Company', band: 'large', weight: 100, parentIsin: '', source: 'AMFI disclosure', ...changes })
const position = (changes: Partial<Position> = {}): Position => ({ id: 'p1', ticker: 'COMPANY', name: 'Company', type: 'stock', isin: STOCK, quantity: 10, buyPrice: 80, lastPrice: 100, invested: 800, ...changes })

describe('market-cap disclosure validation', () => {
  it('rejects impossible or future dates, guessed symbols, invalid bands and missing provenance', () => {
    for (const change of [{ asOf: '2026-02-30' }, { asOf: '2027-01-01' }, { isin: 'RELIANCE' }, { band: 'mega' }, { source: '' }]) {
      expect(() => parseMarketCapRecords([record(change as Partial<MarketCapRecord>)], NOW)).toThrow()
    }
  })
  it('rejects duplicate classifications and fund weights exceeding the whole fund', () => {
    expect(() => parseMarketCapRecords([record(), record({ band: 'small' })], NOW)).toThrow(/duplicate/)
    expect(() => parseMarketCapRecords([record({ parentIsin: FUND, weight: 60 }), record({ parentIsin: FUND, isin: STOCK_TWO, weight: 41 })], NOW)).toThrow(/exceed 100/)
    expect(() => parseMarketCapRecords([record({ weight: 70 })], NOW)).toThrow(/direct classifications/)
  })
})

describe('market-cap exposure', () => {
  it('looks through the latest fund disclosure without blending older dates', () => {
    const records = parseMarketCapRecords([
      record({ parentIsin: FUND, weight: 100, asOf: '2026-08-31', band: 'small' }),
      record({ parentIsin: FUND, weight: 60 }),
      record({ parentIsin: FUND, weight: 25, isin: STOCK_TWO, band: 'mid' }),
    ], NOW)
    const result = calculateMarketCapExposure([position({ type: 'mutual-fund', isin: FUND })], {}, records)
    expect(result.buckets.map((bucket) => bucket.value)).toEqual([600, 250, 0, 0, 150, 0])
    expect(result.coveragePct).toBe(85)
    expect(result.dates).toEqual(['2026-09-30'])
    expect(result.buckets.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(result.total)
  })
  it('uses the latest exact stock ISIN classification and keeps funds without look-through unknown', () => {
    const result = calculateMarketCapExposure([
      position(), position({ id: 'p2', type: 'etf', isin: FUND, name: 'Large Cap ETF' }),
    ], {}, parseMarketCapRecords([record(), record({ asOf: '2026-10-01', band: 'mid' }), record({ isin: FUND })], NOW))
    expect(result.buckets.map((bucket) => bucket.value)).toEqual([0, 1000, 0, 0, 1000, 0])
    expect(result.coveragePct).toBe(50)
  })
  it('does not classify uncertain identity or omit unpriced coverage warnings', () => {
    const result = calculateMarketCapExposure([
      position({ identityIssue: 'conflict' }), position({ id: 'p2', lastPrice: null }),
      position({ id: 'p3', isin: STOCK_TWO, reportedCurrency: 'USD' }),
    ], {}, [record()])
    expect(result.unpricedCount).toBe(2)
    expect(result.coveragePct).toBe(0)
    expect(result.buckets[5].value).toBe(1000)
  })
  it('handles zero balances without NaN and accepts verified other-asset classifications', () => {
    const empty = calculateMarketCapExposure([position({ quantity: 0 })], {}, [])
    expect(empty.total).toBe(0)
    expect(empty.buckets.every((bucket) => bucket.weight === 0)).toBe(true)
    const result = calculateMarketCapExposure([position({ type: 'etf' })], {}, [record({ band: 'other' })])
    expect(result.buckets[3].value).toBe(1000)
  })
})
