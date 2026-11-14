import { describe, expect, it } from 'vitest'
import { ledgerToday, mergeLedgerRecords, validateLedgerRecords, type LedgerRecord } from './investmentLedger'

const record = (override: Partial<LedgerRecord> = {}): LedgerRecord => ({
  id: '1', accountId: 'a', date: '2025-01-01', type: 'buy', isin: 'INE009A01021', ticker: 'INFY',
  quantity: 10, amount: 1000, currency: 'INR', ...override,
})
const asOf = '2026-01-01'

describe('saved transaction records', () => {
  it('validates dates, amounts, currency, quantity and instrument identity', () => {
    for (const change of [
      { date: '2025-02-30' }, { date: '2026-02-01' }, { amount: -1 }, { currency: 'USD' },
      { quantity: 0 }, { isin: 'bad' }, { type: 'dividend' },
    ]) {
      expect(() => validateLedgerRecords([record(change as Partial<LedgerRecord>)], asOf)).toThrow()
    }
  })

  it('deduplicates by account and ID while refusing changed copies', () => {
    expect(mergeLedgerRecords([record()], [record()])).toHaveLength(1)
    expect(mergeLedgerRecords([record()], [record({ accountId: 'b' })])).toHaveLength(2)
    expect(() => mergeLedgerRecords([record()], [record({ amount: 2000 })])).toThrow(/conflicts/)
  })

  it('uses the India calendar date for transaction review', () => {
    expect(ledgerToday(Date.parse('2026-01-01T20:00:00Z'))).toBe('2026-01-02')
  })
})
