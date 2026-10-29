import './test/storage'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateWorkspaceIdentities } from './identityMigration'
import { normalizePosition } from './instruments'
import { holdingIdentity } from './monitor'
import { captureWorkspaceRecords, recoverWorkspaceWrite, workspaceWritesBlocked } from './workspaceStorage'
import { combinePositions } from './valuation'
import type { Folio, Position, Settings } from './types'

const settings: Settings = { currency: 'INR', allowExternalData: true, density: 'compact', accent: 'cobalt', mode: 'light', hideValues: true }
const position: Position = { id: 'holding', ticker: '500112', name: 'Bank', type: 'stock', quantity: 2, buyPrice: 100, invested: 200, lastPrice: 120, exchange: 'BSE', currency: 'INR', providerSymbol: '500112.BO', instrumentKey: 'EQ:500112', sector: 'Financials' }
const folio: Folio = { id: 'account', name: 'Broker account', importedAt: 100, positions: [position] }
const snapshot = { at: 100, value: 240, invested: 200, pnl: 40, holdingCount: 1 }

function seed(folios: Folio[] = [folio]) {
  localStorage.setItem('finverse:folios', JSON.stringify(folios))
  localStorage.setItem('finverse:settings', JSON.stringify(settings))
  localStorage.setItem('finverse:portfolio-snapshots', JSON.stringify([snapshot]))
  localStorage.setItem('finverse:monitor:v1', JSON.stringify({ version: 1, rules: [], events: [], alerts: [] }))
  localStorage.setItem('finverse:history:v2:500112.NS', 'old price history')
  localStorage.setItem('finverse:screenerPath:EQ:500112', 'old research path')
  localStorage.setItem('finverse:manualRefresh', '100')
  localStorage.setItem('finverse:workspace-previous:v1', 'retained restore copy')
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

describe('workspace identity startup migration', () => {
  it('flags already-normalized unmapped fund balances once without changing their amounts or timestamps', async () => {
    const fund = normalizePosition({ ...position, type: 'mutual-fund', name: 'Example Fund Direct IDCW', ticker: 'Example Fund', instrumentKey: undefined })
    seed([{ ...folio, positions: [fund] }])
    expect(await migrateWorkspaceIdentities()).toEqual({ changed: true, error: null })
    expect(JSON.parse(localStorage.getItem('finverse:portfolio-snapshots')!)).toEqual([{ ...snapshot, dataQuality: 'legacy-instrument-identity' }])
    expect(await migrateWorkspaceIdentities()).toEqual({ changed: false, error: null })
  })
  it('does not create persisted records in a fresh browser', async () => {
    expect(await migrateWorkspaceIdentities()).toEqual({ changed: false, error: null })
    expect(localStorage.length).toBe(0)
  })

  it('preserves account IDs, reported venue and original balance numbers while requiring legacy identity review', async () => {
    seed()
    expect(await migrateWorkspaceIdentities()).toEqual({ changed: true, error: null })
    const migrated = JSON.parse(localStorage.getItem('finverse:folios')!)[0]
    expect(migrated).toMatchObject({ id: folio.id, name: folio.name, importedAt: 100 })
    expect(migrated.positions[0]).toMatchObject({ ...position, instrumentKey: 'EQ:v2:unresolved:holding', identityVersion: 2, exchangeSource: 'inferred' })
    expect(migrated.positions[0].identityIssue).toContain('not verified')
    expect(JSON.parse(localStorage.getItem('finverse:portfolio-snapshots')!)).toEqual([{ ...snapshot, dataQuality: 'legacy-instrument-identity' }])
    expect(JSON.parse(localStorage.getItem('finverse:settings')!)).toEqual(settings)
    expect(localStorage.getItem('finverse:history:v2:500112.NS')).toBeNull()
    expect(localStorage.getItem('finverse:screenerPath:EQ:500112')).toBeNull()
    expect(localStorage.getItem('finverse:manualRefresh')).toBeNull()
    expect(localStorage.getItem('finverse:workspace-previous:v1')).toBe('retained restore copy')
  })

  it('remaps legacy combined fund rules and reminders using the stored pre-normalization keys', async () => {
    const fund: Position = { ...position, ticker: 'Example Direct Growth', name: 'Example Direct Growth', type: 'mutual-fund', instrumentKey: 'MF:Example Direct Growth', exchange: 'NSE', providerSymbol: undefined }
    seed([{ ...folio, positions: [{ ...fund, id: 'a' }] }, { ...folio, id: 'second-account', positions: [{ ...fund, id: 'b' }] }])
    const oldId = 'merged:MF:Example Direct Growth'
    localStorage.setItem('finverse:monitor:v1', JSON.stringify({ version: 1,
      rules: [{ id: 'rule', holdingId: oldId, holding: fund.name, instrumentIdentity: 'MF:Example Direct Growth|mutual-fund|NSE|INR||', condition: 'price_above', threshold: 125, active: true }],
      events: [{ id: 'reminder', holdingId: oldId, holding: fund.name, title: 'Review', date: '2030-01-01', kind: 'Reminder', reminder: true }], alerts: [],
    }))
    expect(await migrateWorkspaceIdentities()).toEqual({ changed: true, error: null })
    const folios = JSON.parse(localStorage.getItem('finverse:folios')!) as Folio[]
    const combined = combinePositions(folios.flatMap((account) => account.positions))[0]
    const monitor = JSON.parse(localStorage.getItem('finverse:monitor:v1')!)
    expect(monitor.rules[0]).toMatchObject({ id: 'rule', holdingId: combined.id, instrumentIdentity: holdingIdentity(combined), active: true })
    expect(monitor.rules[0].unresolved).not.toBe(true)
    expect(monitor.events[0]).toMatchObject({ id: 'reminder', holdingId: combined.id, title: 'Review' })
    expect(folios.flatMap((account) => account.positions).map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('migrates a legacy positions-only workspace without changing raw holding IDs', async () => {
    localStorage.setItem('finverse:positions', JSON.stringify([position]))
    expect(await migrateWorkspaceIdentities()).toEqual({ changed: true, error: null })
    const folios = JSON.parse(localStorage.getItem('finverse:folios')!)
    expect(folios).toHaveLength(1)
    expect(folios[0].name).toBe('My portfolio')
    expect(folios[0].positions[0].id).toBe(position.id)
    expect(localStorage.getItem('finverse:positions')).toBeNull()
  })

  it('accepts omitted optional legacy labels and prices while healing only old equity-shaped types', async () => {
    localStorage.setItem('finverse:positions', JSON.stringify([{ ...position, type: 'other', name: undefined, lastPrice: undefined }]))
    expect(await migrateWorkspaceIdentities()).toEqual({ changed: true, error: null })
    expect(JSON.parse(localStorage.getItem('finverse:folios')!)[0].positions[0]).toMatchObject({ id: position.id, type: 'stock', name: '', lastPrice: null, identityVersion: 2 })
  })

  it('normalizes retained previous revisions while preserving their metadata and values', async () => {
    const previousRevision = { importedAt: 90, positions: [{ ...position, quantity: 1, invested: 100 }], statement: { id: 'previous', fileName: 'old.csv', statementDate: null, completeness: 'unknown' } }
    seed([{ ...folio, previousRevision } as Folio])
    expect(await migrateWorkspaceIdentities()).toEqual({ changed: true, error: null })
    const previous = JSON.parse(localStorage.getItem('finverse:folios')!)[0].previousRevision
    expect(previous).toMatchObject({ importedAt: 90, statement: previousRevision.statement, positions: [{ id: position.id, quantity: 1, invested: 100, identityVersion: 2 }] })
  })

  it('does not write on a second run or invalidate newly compatible caches', async () => {
    seed()
    expect((await migrateWorkspaceIdentities()).changed).toBe(true)
    const expected = captureWorkspaceRecords()
    localStorage.setItem('finverse:history:v2:new-key', 'new compatible prices')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    expect(await migrateWorkspaceIdentities()).toEqual({ changed: false, error: null })
    expect(writes).not.toHaveBeenCalled()
    expect(captureWorkspaceRecords()).toEqual(expected)
    expect(localStorage.getItem('finverse:history:v2:new-key')).toBe('new compatible prices')
  })

  it('treats already normalized records with different JSON field order as unchanged', async () => {
    const migrated = normalizePosition({ ...position, identityVersion: 2, exchangeSource: 'explicit' })
    const reversed = Object.fromEntries(Object.entries(migrated).reverse())
    localStorage.setItem('finverse:folios', JSON.stringify([{ positions: [reversed], importedAt: 100, name: folio.name, id: folio.id }]))
    const expected = captureWorkspaceRecords()
    expect(await migrateWorkspaceIdentities()).toEqual({ changed: false, error: null })
    expect(captureWorkspaceRecords()).toEqual(expected)
  })

  it.each([
    ['negative quantity', () => localStorage.setItem('finverse:folios', JSON.stringify([{ ...folio, positions: [{ ...position, quantity: -1 }] }]))],
    ['duplicate holding across accounts', () => localStorage.setItem('finverse:folios', JSON.stringify([folio, { ...folio, id: 'other-account' }]))],
    ['invalid preference', () => localStorage.setItem('finverse:settings', JSON.stringify({ ...settings, allowExternalData: 'yes' }))],
    ['unsupported Monitor version', () => localStorage.setItem('finverse:monitor:v1', JSON.stringify({ version: 99, rules: [], events: [], alerts: [] }))],
    ['malformed balances', () => localStorage.setItem('finverse:portfolio-snapshots', '{broken')],
  ])('rejects %s without dropping records or changing caches', async (_name, invalidate) => {
    seed()
    invalidate()
    const expected = captureWorkspaceRecords()
    expect((await migrateWorkspaceIdentities()).error).toBeTruthy()
    expect(captureWorkspaceRecords()).toEqual(expected)
    expect(localStorage.getItem('finverse:history:v2:500112.NS')).toBe('old price history')
    expect(workspaceWritesBlocked()).toBe(false)
  })

  it('retains originals when storage cannot create the migration journal', async () => {
    seed()
    const expected = captureWorkspaceRecords()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    const result = await migrateWorkspaceIdentities()
    expect(result.changed).toBe(false)
    expect(result.error).toContain('original workspace has been retained')
    expect(captureWorkspaceRecords()).toEqual(expected)
  })

  it('leaves a recoverable journal if both migration and immediate rollback fail', async () => {
    seed()
    const expected = captureWorkspaceRecords()
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'finverse:settings' || (key === 'finverse:folios' && value === expected['finverse:folios'])) throw new DOMException('Full', 'QuotaExceededError')
      setItem.call(this, key, value)
    })
    expect((await migrateWorkspaceIdentities()).error).toContain('recovery journal')
    expect(workspaceWritesBlocked()).toBe(true)
    vi.restoreAllMocks()
    expect(await recoverWorkspaceWrite()).toEqual({ recovered: true, error: null })
    expect(captureWorkspaceRecords()).toEqual(expected)
    expect(localStorage.getItem('finverse:history:v2:500112.NS')).toBe('old price history')
  })

  it('rejects a workspace changed while waiting for its write lock', async () => {
    seed()
    const originalFolios = localStorage.getItem('finverse:folios')
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, write: () => unknown) => {
      localStorage.setItem('finverse:settings', JSON.stringify({ ...settings, hideValues: false }))
      return write()
    } } })
    expect((await migrateWorkspaceIdentities()).error).toContain('changed after this preview')
    expect(localStorage.getItem('finverse:folios')).toBe(originalFolios)
    expect(JSON.parse(localStorage.getItem('finverse:settings')!).hideValues).toBe(false)
    expect(workspaceWritesBlocked()).toBe(false)
  })
})
