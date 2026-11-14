import './test/storage'
import { describe, expect, it } from 'vitest'
import { captureWorkspaceRecords, createWorkspaceArchive, parseWorkspaceArchive, restoreWorkspaceArchive } from './workspaceArchive'
import { loadSettings } from './store'
import { MARKET_CAP_STORAGE_KEY } from './marketCapExposure'

const LEDGER_STORAGE_KEY = 'finverse:investment-ledger:v1'
const ledger = [{ id: 'buy-1', accountId: 'account-1', date: '2024-01-02', type: 'buy', ticker: 'TCS', exchange: 'NSE', quantity: 1, amount: 100, currency: 'INR' }]
const marketCap = [{ asOf: '2024-01-01', isin: 'INE467B01029', name: 'TCS', band: 'large', weight: 100, parentIsin: '', source: 'AMFI' }]

describe('analytics workspace backups', () => {
  it('round-trips transaction and classification records through backup, restore and recovery', async () => {
    localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(ledger))
    localStorage.setItem(MARKET_CAP_STORAGE_KEY, JSON.stringify(marketCap))
    const archive = createWorkspaceArchive([], loadSettings(), [], { rules: [], events: [], alerts: [] })
    const parsed = parseWorkspaceArchive(JSON.stringify(archive)).archive
    expect(parsed.ledger).toEqual(ledger)
    expect(parsed.marketCap).toEqual(marketCap)
    localStorage.removeItem(LEDGER_STORAGE_KEY)
    localStorage.removeItem(MARKET_CAP_STORAGE_KEY)
    await restoreWorkspaceArchive(parsed, captureWorkspaceRecords())
    expect(JSON.parse(localStorage.getItem(LEDGER_STORAGE_KEY)!)).toEqual(ledger)
    expect(JSON.parse(localStorage.getItem(MARKET_CAP_STORAGE_KEY)!)).toEqual(marketCap)
  })

  it('clears analytics when restoring an older archive rather than mixing workspaces', async () => {
    const old = createWorkspaceArchive([], loadSettings(), [], { rules: [], events: [], alerts: [] })
    localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(ledger))
    localStorage.setItem(MARKET_CAP_STORAGE_KEY, JSON.stringify(marketCap))
    await restoreWorkspaceArchive(old, captureWorkspaceRecords())
    expect(localStorage.getItem(LEDGER_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(MARKET_CAP_STORAGE_KEY)).toBeNull()
  })

  it('rejects malformed analytics without changing existing records', () => {
    const archive = createWorkspaceArchive([], loadSettings(), [], { rules: [], events: [], alerts: [] })
    const before = captureWorkspaceRecords()
    expect(() => parseWorkspaceArchive(JSON.stringify({ ...archive, ledger: [{ ...ledger[0], amount: -1 }] }))).toThrow('positive cash amount')
    expect(() => parseWorkspaceArchive(JSON.stringify({ ...archive, marketCap: [{ ...marketCap[0], weight: 101 }] }))).toThrow('weight_pct')
    expect(captureWorkspaceRecords()).toEqual(before)
  })
})
