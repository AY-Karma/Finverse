import { describe, expect, it } from 'vitest'
import { calculateLedgerPerformance, calculateXirr, ledgerHoldingKey, matchLedgerRecords, mergeLedgerRecords, parseLedgerCsv, validateLedgerRecords, type LedgerPosition, type LedgerRecord } from './investmentLedger'

const record = (override: Partial<LedgerRecord> = {}): LedgerRecord => ({ id: '1', accountId: 'a', date: '2025-01-01', type: 'buy', isin: 'INE009A01021', ticker: 'INFY', quantity: 10, amount: 1000, currency: 'INR', ...override })
const holding = (override: Partial<LedgerPosition> = {}): LedgerPosition => ({ id: 'h', accountId: 'a', ticker: 'INFY', name: 'Infosys', isin: 'INE009A01021', exchange: 'NSE', currency: 'INR', type: 'stock', quantity: 10, invested: 1000, buyPrice: 100, lastPrice: 120, ...override })
const asOf = '2026-01-01'

describe('normalized transaction imports', () => {
  it('parses quoted CSV, strips BOM and normalizes identifiers', () => {
    const rows = parseLedgerCsv('\uFEFFid,date,type,isin,ticker,exchange,quantity,amount,currency\r\n"trade,1",2025-01-01,BUY,ine009a01021,infy,nse,10,1000,inr\r\n', 'a', asOf)
    expect(rows).toEqual([record({ id: 'trade,1', exchange: 'NSE' })])
  })
  it('rejects malformed dates, future transactions, negative amounts and non-INR', () => {
    for (const override of [{ date: '2025-02-30' }, { date: '2026-02-01' }, { amount: -1 }, { currency: 'USD' }, { quantity: 0 }, { isin: 'bad' }]) {
      expect(() => validateLedgerRecords([record(override as Partial<LedgerRecord>)], asOf)).toThrow()
    }
    expect(() => validateLedgerRecords([record({ type: 'dividend' })], asOf)).toThrow(/zero/)
  })
  it('rejects ambiguous security identity, invalid CSV and duplicate headers', () => {
    expect(() => validateLedgerRecords([record({ isin: undefined })], asOf)).toThrow(/ISIN/)
    expect(() => parseLedgerCsv('id,date,type,quantity,amount,currency\n"oops,2025-01-01,buy,1,100,INR', 'a', asOf)).toThrow(/unclosed/)
    expect(() => parseLedgerCsv('id,date,type,quantity,amount,currency,id\n1,2025-01-01,buy,1,100,INR,1', 'a', asOf)).toThrow(/headers/)
  })
  it('deduplicates by account and ID while refusing changed copies', () => {
    expect(mergeLedgerRecords([record()], [record()])).toHaveLength(1)
    expect(mergeLedgerRecords([record()], [record({ accountId: 'b' })])).toHaveLength(2)
    expect(() => mergeLedgerRecords([record()], [record({ amount: 2000 })])).toThrow(/conflicts/)
  })
})

describe('actual investment performance', () => {
  it('includes cash income and fees, without counting deposits as purchases twice', () => {
    const result = calculateLedgerPerformance([
      record(), record({ id: 'd', type: 'deposit', isin: undefined, ticker: undefined, quantity: 0, amount: 2000 }),
      record({ id: 'income', date: '2025-12-01', type: 'dividend', quantity: 0, amount: 50 }),
      record({ id: 'fee', type: 'fee', isin: undefined, ticker: undefined, quantity: 0, amount: 10 }),
    ], [holding()], {}, asOf)
    expect(result).toMatchObject({ complete: true, invested: 1000, contributions: 2000, income: 50, fees: 10, currentValue: 1200, gain: 240, netInvested: 1000, fyIncome: { dividends: 50, interest: 0, total: 50 } })
    expect(result.xirr).toBeGreaterThan(23)
    expect(result.holdings.reduce((sum, row) => sum + row.gain, 0)).toBe(240)
  })
  it('retains sold holdings and their realized contribution', () => {
    const result = calculateLedgerPerformance([record(), record({ id: 'sell', date: '2025-06-01', type: 'sell', quantity: 10, amount: 1300 })], [], {}, asOf)
    expect(result).toMatchObject({ complete: true, proceeds: 1300, currentValue: 0, gain: 300 })
    expect(result.holdings[0]).toMatchObject({ value: 0, gain: 300, quantity: 0 })
  })
  it('refuses quantity mismatches and sales before recorded purchases', () => {
    const mismatch = calculateLedgerPerformance([record({ quantity: 9 })], [holding()], {}, asOf)
    expect(mismatch.complete).toBe(false)
    expect(mismatch.xirr).toBeNull()
    expect(mismatch.gain).toBeNull()
    const missingOpening = calculateLedgerPerformance([record({ type: 'sell', date: '2024-12-01' }), record({ id: 'buy' })], [], {}, asOf)
    expect(missingOpening.issues.join(' ')).toContain('sales exceed')
  })
  it('reconciles accounts independently even when their total units match', () => {
    const result = calculateLedgerPerformance([record({ quantity: 20 })], [holding(), holding({ id: 'b', accountId: 'b' })], {}, asOf)
    expect(result.complete).toBe(false)
    expect(result.issues).toHaveLength(1)
  })
  it('does not let sales in another account cancel purchases after all holdings exit', () => {
    const result = calculateLedgerPerformance([record(), record({ accountId: 'b', id: 'sale', date: '2025-06-01', type: 'sell', amount: 1200 })], [], {}, asOf)
    expect(result.complete).toBe(false)
    expect(result.issues.join(' ')).toContain('sales exceed')
  })
  it('does not produce returns with unpriced holdings or no purchase records', () => {
    expect(calculateLedgerPerformance([record()], [holding({ lastPrice: null })], {}, asOf).complete).toBe(false)
    expect(calculateLedgerPerformance([], [holding()], {}, asOf).xirr).toBeNull()
  })
  it('uses April financial years for received income', () => {
    const result = calculateLedgerPerformance([record(), record({ id: 'march', date: '2025-03-31', type: 'dividend', quantity: 0, amount: 10 }), record({ id: 'april', date: '2025-04-01', type: 'interest', quantity: 0, amount: 20 })], [holding()], {}, '2026-03-31')
    expect(result.fyIncome).toEqual({ dividends: 0, interest: 20, total: 20 })
    expect(result.income).toBe(30)
  })
  it('calculates period contribution from opening values and period cash flows', () => {
    const key = ledgerHoldingKey(holding())
    const records = [record(), record({ id: 'extra', date: '2025-09-01', quantity: 5, amount: 600 }), record({ id: 'div', date: '2025-09-02', type: 'dividend', quantity: 0, amount: 30 })]
    const result = calculateLedgerPerformance(records, [holding({ quantity: 15 })], {}, asOf, { from: '2025-07-01', to: asOf }, { [key]: 1100 })
    expect(result.period).toMatchObject({ complete: true, gain: 130 })
    expect(result.period?.holdings[0]).toMatchObject({ buys: 600, income: 30, gain: 130 })
    expect(calculateLedgerPerformance(records, [holding({ quantity: 15 })], {}, asOf, { from: '2025-07-01', to: asOf }).period?.complete).toBe(false)
    expect(calculateLedgerPerformance(records, [holding({ quantity: 15 })], {}, asOf, { from: '2025-07-01', to: '2025-12-01' }).period?.complete).toBe(false)
  })
  it('does not require opening prices when the holding was purchased inside the period', () => {
    const result = calculateLedgerPerformance([record()], [holding()], {}, asOf, { from: '2025-01-01', to: asOf })
    expect(result.period).toMatchObject({ complete: true, gain: 200 })
  })
})

describe('exact transaction identity matching', () => {
  const withoutIsin = (override: Partial<LedgerRecord> = {}) => record({ isin: undefined, exchange: 'NSE', ...override })
  it('enriches a unique account and listing match without mutating input', () => {
    const input = withoutIsin()
    const matched = matchLedgerRecords([input], [holding()])
    expect(matched[0].isin).toBe('INE009A01021')
    expect(input.isin).toBeUndefined()
    expect(calculateLedgerPerformance(matched, [holding()], {}, asOf).complete).toBe(true)
  })
  it('does not infer identity across accounts, exchanges or unreviewed positions', () => {
    for (const position of [holding({ accountId: 'b' }), holding({ exchange: 'BSE' }), holding({ identityIssue: 'Confirm listing' }), holding({ accountId: undefined })]) {
      expect(matchLedgerRecords([withoutIsin()], [position])[0].isin).toBeUndefined()
    }
    expect(matchLedgerRecords([withoutIsin({ exchange: undefined })], [holding()])[0].isin).toBeUndefined()
  })
  it('uses an unambiguous explicit ledger listing for an exited holding', () => {
    const buy = withoutIsin()
    const sell = record({ id: 'sale', date: '2025-06-01', type: 'sell', exchange: 'NSE', amount: 1200 })
    const matched = matchLedgerRecords([buy, sell], [])
    expect(matched[0].isin).toBe(sell.isin)
    expect(calculateLedgerPerformance(matched, [], {}, asOf)).toMatchObject({ complete: true, gain: 200 })
  })
  it('preserves explicit contradictions and refuses ambiguous mappings', () => {
    const contradictory = record({ id: 'other', exchange: 'NSE', isin: 'INE002A01018' })
    const matched = matchLedgerRecords([withoutIsin(), contradictory], [holding()])
    expect(matched[0].isin).toBeUndefined()
    expect(matched[1].isin).toBe('INE002A01018')
    expect(matchLedgerRecords([withoutIsin()], [holding(), holding({ isin: 'INE002A01018' })])[0].isin).toBeUndefined()
  })
})

describe('XIRR', () => {
  it('calculates positive, negative and zero annual returns', () => {
    const flows = (value: number) => [{ date: '2025-01-01', amount: -1000 }, { date: asOf, amount: value }]
    expect(calculateXirr(flows(1200))).toBeCloseTo(20)
    expect(calculateXirr(flows(800))).toBeCloseTo(-20)
    expect(calculateXirr(flows(1000))).toBeCloseTo(0)
  })
  it('does not invent a return from same-day flows or multiple possible roots', () => {
    expect(calculateXirr([{ date: asOf, amount: -100 }, { date: asOf, amount: 110 }])).toBeNull()
    expect(calculateXirr([{ date: '2023-01-01', amount: -100 }, { date: '2024-01-01', amount: 230 }, { date: '2024-12-31', amount: -132 }])).toBeNull()
  })
})
