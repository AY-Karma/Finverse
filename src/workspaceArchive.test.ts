import './test/storage'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdingIdentity, type MonitorState } from './monitor'
import { combinePositions } from './valuation'
import { normalizePosition } from './instruments'
import type { Folio, PortfolioSnapshot, Settings } from './types'
import { captureWorkspaceRecords, createWorkspaceArchive, MAX_WORKSPACE_ARCHIVE_BYTES, parseWorkspaceArchive, restoreWorkspaceArchive } from './workspaceArchive'

const settings: Settings = { currency: 'INR', allowExternalData: true, density: 'compact', accent: 'custom', customAccent: '#123abc', mode: 'light', hideValues: true }
const position = normalizePosition({ id: 'holding-1', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 2, buyPrice: 100, lastPrice: 120, invested: 200, exchange: 'NSE', currency: 'INR', providerSymbol: 'TCS.NS', identityVersion: 2, exchangeSource: 'explicit' })
const folios: Folio[] = [{ id: 'account-1', name: 'Broker account', importedAt: 100, positions: [position] }]
const snapshots: PortfolioSnapshot[] = [{ at: 100, value: 240, invested: 200, pnl: 40, holdingCount: 1 }]
const monitor: MonitorState = {
  rules: [{ id: 'rule-1', holding: 'TCS', holdingId: position.id, instrumentIdentity: holdingIdentity(position), condition: 'price_above', threshold: 110, active: true }],
  events: [{ id: 'reminder-1', holding: 'TCS', holdingId: position.id, title: 'Review', date: '2027-01-01', kind: 'Reminder', reminder: true }],
  alerts: [{ id: 'alert-1', holding: 'Sold holding', holdingId: 'removed', title: 'Watch condition', reason: 'Matched', evidence: 'Past observation', kind: 'price', state: 'reviewed', observationKey: 'past-1', time: '12:00', at: 100, metrics: [] }],
}
const archive = () => createWorkspaceArchive(folios, settings, snapshots, monitor)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

describe('workspace archives', () => {
  it('preserves legacy native currency metadata when restoring an archive directly', async () => {
    const original = JSON.parse(JSON.stringify(archive()))
    original.settings.currency = 'EUR'
    original.folios[0].positions[0].currency = 'EUR'
    original.folios[0].positions[0].reportedCurrency = ' '
    original.monitor = { rules: [], events: [], alerts: [] }
    await restoreWorkspaceArchive(original, captureWorkspaceRecords())
    const restored = JSON.parse(localStorage.getItem('finverse:folios')!)[0].positions[0]
    expect(restored).toMatchObject({ reportedCurrency: 'EUR', invested: 200, lastPrice: 120 })
    expect(restored.currency).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('finverse:settings')!).currency).toBe('INR')
  })

  it('rejects a restored fund mapping that contradicts its imported plan or option', () => {
    const archive = createWorkspaceArchive(folios, settings, snapshots, monitor)
    archive.folios[0].positions = [{ ...position, type: 'mutual-fund', name: 'Example Fund Direct IDCW', mfScheme: { code: 1, name: 'Example Fund Regular Growth', source: 'confirmed' } }]
    archive.monitor = { rules: [], events: [], alerts: [] }
    expect(() => parseWorkspaceArchive(JSON.stringify(archive))).toThrow('fund mapping that conflicts')
  })
  it('round-trips statement revisions, imported price dates and account-removal balance events', () => {
    const statement = { id: 'new', fileName: 'new.csv', statementDate: '2026-10-10', completeness: 'complete' as const }
    const accounts: Folio[] = [{ ...folios[0], statement, reviewedAt: 200, positions: [{ ...position, priceAsOf: '2026-10-10' }], previousRevision: { statement: { ...statement, id: 'old', statementDate: null }, importedAt: 1, reviewedAt: 2, positions: [{ ...position, priceAsOf: null }] }, lastOperation: 'updated', operationAt: 100 }]
    const balances: PortfolioSnapshot[] = [{ ...snapshots[0], event: { kind: 'account-remove', accountId: 'removed', statementId: 'past' } }]
    const original = createWorkspaceArchive(accounts, settings, balances, monitor)
    expect(parseWorkspaceArchive(JSON.stringify(original)).archive).toEqual(original)
    const nested = { ...original, folios: [{ ...accounts[0], previousRevision: { ...accounts[0].previousRevision, previousRevision: accounts[0].previousRevision } }] }
    expect(() => parseWorkspaceArchive(JSON.stringify(nested))).toThrow('nested account revision')
  })

  it('round-trips canonical holdings, preferences, balances and Monitor state while keeping restored external access off', async () => {
    const original = archive()
    const parsed = parseWorkspaceArchive(JSON.stringify(original))
    expect(parsed.legacy).toBe(false)
    expect(parsed.archive).toEqual(original)
    expect(parsed.warnings.join(' ')).toContain('Historical alerts')
    await restoreWorkspaceArchive(parsed.archive, captureWorkspaceRecords())
    expect(JSON.parse(localStorage.getItem('finverse:folios')!)).toEqual(folios)
    expect(JSON.parse(localStorage.getItem('finverse:settings')!)).toEqual({ ...settings, allowExternalData: false })
    expect(JSON.parse(localStorage.getItem('finverse:portfolio-snapshots')!)).toEqual(snapshots)
    expect(JSON.parse(localStorage.getItem('finverse:monitor:v1')!)).toEqual({ version: 1, ...monitor })
  })

  it('reads persisted Monitor state and excludes credentials, caches and derived positions from the archive', () => {
    localStorage.setItem('finverse:monitor:v1', JSON.stringify({ version: 1, ...monitor }))
    localStorage.setItem('finverse:history:v2:TCS.NS', 'cached prices')
    const created = createWorkspaceArchive(folios, { ...settings, apiKey: 'private-key' } as Settings, snapshots)
    expect(created.monitor).toEqual(monitor)
    expect(JSON.stringify(created)).not.toContain('private-key')
    expect(Object.keys(created)).toEqual(['format', 'version', 'exportedAt', 'folios', 'settings', 'snapshots', 'monitor'])
  })

  it('accepts legacy holdings-only exports with an accurate completeness warning', () => {
    const parsed = parseWorkspaceArchive(JSON.stringify({ exportedAt: 100, folios, positions: [{ incorrectDerivedTotal: true }] }))
    expect(parsed.legacy).toBe(true)
    expect(parsed.archive.folios).toEqual(folios)
    expect(parsed.archive.settings.allowExternalData).toBe(false)
    expect(parsed.archive.snapshots).toEqual([])
    expect(parsed.archive.monitor).toEqual({ rules: [], events: [], alerts: [] })
    expect(parsed.warnings[0]).toContain('holdings only')
  })

  it.each([
    ['unknown version', (value: ReturnType<typeof archive>) => ({ ...value, version: 99 })],
    ['negative quantity', (value: ReturnType<typeof archive>) => ({ ...value, folios: [{ ...folios[0], positions: [{ ...position, quantity: -1 }] }] })],
    ['invalid numeric field', (value: ReturnType<typeof archive>) => ({ ...value, snapshots: [{ ...snapshots[0], value: '240' }] })],
    ['duplicate account', (value: ReturnType<typeof archive>) => ({ ...value, folios: [folios[0], folios[0]] })],
    ['oversized rule list', (value: ReturnType<typeof archive>) => ({ ...value, monitor: { ...monitor, rules: Array(201).fill(monitor.rules[0]) } })],
  ])('rejects %s without touching the current workspace', (_name, change) => {
    localStorage.setItem('finverse:folios', 'current')
    const expected = captureWorkspaceRecords()
    expect(() => parseWorkspaceArchive(JSON.stringify(change(archive())))).toThrow()
    expect(captureWorkspaceRecords()).toEqual(expected)
  })

  it('rejects invalid JSON, excessive file size and dangling current rules or reminders', () => {
    expect(() => parseWorkspaceArchive('{broken')).toThrow('not valid JSON')
    expect(() => parseWorkspaceArchive(' '.repeat(MAX_WORKSPACE_ARCHIVE_BYTES + 1))).toThrow('10 MB')
    expect(() => parseWorkspaceArchive(JSON.stringify({ ...archive(), monitor: { ...monitor, rules: [{ ...monitor.rules[0], holdingId: 'missing' }] } }))).toThrow('watch rule')
    expect(() => parseWorkspaceArchive(JSON.stringify({ ...archive(), monitor: { ...monitor, events: [{ ...monitor.events[0], holdingId: 'missing' }] } }))).toThrow('reminder')
  })

  it('preserves rules attached to combined holdings without treating derived totals as canonical records', () => {
    const accounts = [...folios, { id: 'account-2', name: 'Second broker', importedAt: 200, positions: [{ ...position, id: 'holding-2' }] }]
    const combined = combinePositions(accounts.flatMap((account) => account.positions))[0]
    const state = { ...monitor, rules: [{ ...monitor.rules[0], holdingId: combined.id, instrumentIdentity: holdingIdentity(combined) }] }
    const parsed = parseWorkspaceArchive(JSON.stringify(createWorkspaceArchive(accounts, settings, snapshots, state)))
    expect(parsed.archive.monitor.rules[0].holdingId).toBe(combined.id)
    expect(parsed.archive.folios[0].positions[0].id).toBe(position.id)
  })

  it('validates again before writing when the caller passes an unparsed object', async () => {
    const invalid = { ...archive(), snapshots: [{ ...snapshots[0], invested: -1 }] }
    await expect(restoreWorkspaceArchive(invalid, captureWorkspaceRecords())).rejects.toThrow('balance cost')
    expect(localStorage.length).toBe(0)
  })

  it('preserves explicitly unresolved rules and reminders, with a review warning', () => {
    const state = {
      ...monitor,
      rules: [{ ...monitor.rules[0], holdingId: 'removed', active: false, unresolved: true }],
      events: [{ ...monitor.events[0], holdingId: 'removed', unresolved: true }],
    }
    const parsed = parseWorkspaceArchive(JSON.stringify(createWorkspaceArchive(folios, settings, snapshots, state)))
    expect(parsed.archive.monitor).toEqual(state)
    expect(parsed.warnings.join(' ')).toContain('will not be evaluated')
    expect(() => parseWorkspaceArchive(JSON.stringify({ ...parsed.archive, monitor: { ...state, rules: [{ ...state.rules[0], unresolved: false }] } }))).toThrow('watch rule')
  })

  it('migrates old listing keys and references while preserving recorded balances for review', () => {
    const oldPosition = { ...position, instrumentKey: 'EQ:TCS', identityVersion: undefined, exchangeSource: undefined }
    const oldMonitor = { ...monitor, rules: [{ ...monitor.rules[0], instrumentIdentity: 'EQ:TCS|stock|NSE|INR|TCS.NS|' }] }
    const oldArchive = { ...archive(), folios: [{ ...folios[0], positions: [oldPosition] }], monitor: oldMonitor }
    const parsed = parseWorkspaceArchive(JSON.stringify(oldArchive))
    const restored = parsed.archive.folios[0].positions[0]
    expect(restored.id).toBe(position.id)
    expect(restored.identityVersion).toBe(2)
    expect(restored.identityIssue).toContain('original listing metadata')
    expect(parsed.archive.monitor.rules[0].instrumentIdentity).toBe(holdingIdentity(restored))
    expect(parsed.archive.snapshots).toEqual([{ ...snapshots[0], dataQuality: 'legacy-instrument-identity' }])
    expect(parsed.warnings.join(' ')).toContain('not recalculated')
  })
})
