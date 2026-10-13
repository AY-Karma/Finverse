// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { latestUndoableAccount, planStatementImport, undoStatementImport, type StatementImportOptions } from './accountStatements'
import { normalizePosition } from './instruments'
import { investmentWorkspace } from './investmentWorkspace'
import { loadFolios, saveFolios } from './store'
import type { Folio, Position } from './types'
import type { ImportPreview } from './useStore'

const now = Date.parse('2026-10-12T12:00:00Z')
const options: StatementImportOptions = { operation: 'add', accountAlias: 'Broker account', statementDate: '2026-10-01', complete: true }

function holding(id = 'row-1', quantity = 10, lastPrice = 120): Position {
  return normalizePosition({ id, ticker: 'HDFCBANK', name: 'HDFC Bank', type: 'stock', quantity, buyPrice: 100, invested: quantity * 100, lastPrice })
}

function preview(id: string, positions = [holding()]): ImportPreview {
  return { id, fileName: `${id}.csv`, positions, duplicateCount: 0, unmatchedCount: 0, issues: [], rejectedCount: 0, createdAt: now }
}

function imported(): Folio[] {
  return planStatementImport([], { ...options, preview: preview('first') }, now - 10).nextFolios
}

function replace(folios: Folio[], incoming = preview('second', [holding('new-row', 8, 130)]), overrides: Partial<StatementImportOptions> = {}) {
  return planStatementImport(folios, {
    operation: 'replace', accountId: folios[0].id, statementDate: '2026-10-10', complete: true,
    expectedStatementId: folios[0].statement?.id ?? `legacy:${folios[0].id}`, preview: incoming, ...overrides,
  }, now)
}

afterEach(() => localStorage.clear())

describe('account statement planning', () => {
  it('accepts the current Indian statement date just after midnight IST', () => {
    const midnight = Date.parse('2026-10-11T19:00:00Z')
    expect(planStatementImport([], { ...options, statementDate: '2026-10-12', preview: preview('midnight') }, midnight).noOp).toBe(false)
    expect(() => planStatementImport([], { ...options, statementDate: '2026-10-13', preview: preview('future') }, midnight)).toThrow('future')
  })
  it('replaces 10 shares with 8 shares, retaining the row ID, cost 800 and value 1040', () => {
    const folios = imported()
    const original = JSON.stringify(folios)
    const plan = replace(folios)
    const snapshot = investmentWorkspace.readSnapshot({ folios: plan.nextFolios, quotes: {}, fxRate: null })
    expect(snapshot.positions[0].quantity).toBe(8)
    expect(snapshot.invested).toBe(800)
    expect(snapshot.currentValue).toBe(1040)
    expect(plan.nextFolios[0]).toMatchObject({ id: 'account:first', importedAt: now, lastOperation: 'updated', statement: { id: 'second' } })
    expect(plan.changed).toHaveLength(1)
    expect(plan.changed[0].after.id).toBe(folios[0].positions[0].id)
    expect(plan.added).toEqual([])
    expect(plan.removed).toEqual([])
    expect(JSON.stringify(folios)).toBe(original)
    expect(plan.nextFolios[0].positions[0].priceAsOf).toBeUndefined()
  })

  it('adds a separate account with the same holding, preserving 18 shares and unique raw row IDs', () => {
    const folios = imported()
    const plan = planStatementImport(folios, { ...options, accountAlias: 'Other broker', statementDate: '2026-10-10', preview: preview('other', [holding('row-1', 8, 130)]) }, now)
    const snapshot = investmentWorkspace.readSnapshot({ folios: plan.nextFolios, quotes: {}, fxRate: null })
    expect(plan.nextFolios).toHaveLength(2)
    expect(plan.accountId).toBe('account:other')
    expect(snapshot.positions[0].quantity).toBe(18)
    expect(snapshot.invested).toBe(1800)
    expect(new Set(plan.nextFolios.flatMap((account) => account.positions.map((position) => position.id))).size).toBe(2)
  })

  it('shows sold holdings only after a complete replacement and supports an empty complete statement', () => {
    const folios = imported()
    folios[0].positions.push(normalizePosition({ ...holding('sold'), ticker: 'TCS', name: 'TCS', providerSymbol: 'TCS.NS' }))
    const plan = replace(folios)
    expect(plan.removed.map((position) => position.id)).toEqual(['sold'])
    expect(() => replace(folios, undefined, { complete: false })).toThrow('complete statement')
    const empty = replace(folios, preview('empty', []))
    expect(empty.nextFolios[0].positions).toEqual([])
    expect(empty.removed).toHaveLength(2)
    expect(empty.added).toEqual([])
    expect(empty.changed).toEqual([])
    expect(empty.nextFolios[0].statement).toMatchObject({ id: 'empty', completeness: 'complete' })
    const snapshot = investmentWorkspace.readSnapshot({ folios: empty.nextFolios, quotes: {}, fxRate: null })
    expect(snapshot).toMatchObject({ positions: [], invested: 0, currentValue: 0 })
    expect(saveFolios(empty.nextFolios)).toBe(true)
    expect(undoStatementImport(loadFolios(), folios[0].id)[0].positions).toMatchObject(folios[0].positions)
  })

  it('rejects empty account additions and keeps replacement safeguards for empty statements', () => {
    const folios = imported()
    const empty = preview('empty', [])
    expect(() => planStatementImport(folios, { ...options, preview: empty }, now)).toThrow('An empty statement cannot add an account')
    expect(() => replace(folios, empty, { complete: false })).toThrow('complete statement')
    expect(() => replace(folios, { ...empty, rejectedCount: 1 })).toThrow('no rejected rows')
    expect(() => replace(folios, empty, { accountId: 'missing' })).toThrow('Choose an existing account')
    expect(() => replace(folios, empty, { expectedStatementId: 'stale' })).toThrow('changed after')
    expect(() => replace(folios, empty, { statementDate: '2026-09-30' })).toThrow('older')
    expect(() => replace(folios, empty, { statementDate: null })).toThrow('undated statement')
    expect(replace(folios, empty, { statementDate: null, allowUndatedReplacement: true }).removed).toEqual(folios[0].positions)
    expect(folios[0].positions).toHaveLength(1)
  })

  it('rejects rejected rows, older dates, invalid dates, future dates and stale previews without mutation', () => {
    const folios = imported()
    const original = JSON.stringify(folios)
    expect(() => replace(folios, { ...preview('bad'), rejectedCount: 1 })).toThrow('no rejected rows')
    expect(() => replace(folios, undefined, { statementDate: '2026-09-30' })).toThrow('older')
    expect(() => replace(folios, undefined, { statementDate: '2026-02-30' })).toThrow('valid statement date')
    expect(() => replace(folios, undefined, { statementDate: '2026-10-13' })).toThrow('future')
    expect(() => replace(folios, undefined, { expectedStatementId: 'stale' })).toThrow('changed after')
    expect(() => replace(folios, undefined, { expectedStatementId: undefined })).toThrow('changed after')
    expect(JSON.stringify(folios)).toBe(original)
  })

  it('requires an explicit acknowledgement for undated replacement and exposes the uncertainty', () => {
    expect(() => replace(imported(), undefined, { statementDate: null })).toThrow('undated statement')
    const plan = replace(imported(), undefined, { statementDate: null, allowUndatedReplacement: true })
    expect(plan.warnings.join(' ')).toContain('date is unknown')
    expect(plan.nextFolios[0].statement?.statementDate).toBeNull()
  })

  it('makes repeated preview submission and equivalent dated reuploads no-ops', () => {
    const folios = imported()
    const repeated = planStatementImport(folios, { ...options, preview: preview('first') }, now)
    expect(repeated.noOp).toBe(true)
    expect(repeated.nextFolios).toBe(folios)
    const sameContent = replace(folios, preview('another-upload', [holding('different-id')]), { statementDate: '2026-10-01' })
    expect(sameContent.noOp).toBe(true)
    expect(sameContent.statementId).toBe('first')
    expect(sameContent.nextFolios).toBe(folios)
    expect(saveFolios(folios)).toBe(true)
    const reloaded = loadFolios()
    expect(replace(reloaded, preview('reload-upload', [holding('reloaded-id')]), { statementDate: options.statementDate }).noOp).toBe(true)
    const update = replace(folios)
    expect(replace(update.nextFolios, preview('second', [holding('different-id', 8, 130)]), { expectedStatementId: 'first' }).noOp).toBe(true)
    expect(() => planStatementImport(update.nextFolios, { ...options, preview: preview('first') }, now)).toThrow('already been used')
  })

  it('compares equivalent unresolved rows without depending on generated row IDs', () => {
    const unresolved = normalizePosition({ ...holding(), ticker: '500180', providerSymbol: undefined, identityIssue: undefined })
    const folios = planStatementImport([], { ...options, preview: preview('unresolved', [unresolved]) }, now).nextFolios
    expect(replace(folios, preview('unresolved-reupload', [{ ...unresolved, id: 'fresh-id' }]), { statementDate: options.statementDate }).noOp).toBe(true)
  })

  it('preserves a confirmed mapping and row ID for the exact fund name and folio, while leaving other names unmapped', () => {
    const name = 'Example Equity Fund Direct IDCW'
    const fund = normalizePosition({ ...holding('fund'), ticker: name, name, type: 'mutual-fund', folio: '123', mfScheme: { code: 2, name, source: 'confirmed' } })
    const folios = planStatementImport([], { ...options, preview: preview('fund-first', [fund]) }, now - 10).nextFolios
    const incoming = { ...fund, id: 'fund-new', quantity: 8, invested: 800, mfScheme: undefined }
    const plan = replace(folios, preview('fund-second', [incoming]))
    expect(plan.nextFolios[0].positions[0]).toMatchObject({ id: 'fund', mfScheme: fund.mfScheme, instrumentKey: 'MF:mfapi:2' })
    const changedName = replace(folios, preview('unknown', [{ ...incoming, ticker: 'Unknown fund', name: 'Unknown fund' }]))
    expect(changedName.nextFolios[0].positions[0].mfScheme).toBeUndefined()
    const changedFolio = replace(folios, preview('different-folio', [{ ...incoming, folio: '456' }]))
    expect(changedFolio.nextFolios[0].positions[0].mfScheme).toBeUndefined()
    expect(changedFolio.nextFolios[0].positions[0].id).toBe('fund-new')
  })

  it('retains row IDs only for unambiguous listing and fund-folio matches', () => {
    const folios = imported()
    const plan = replace(folios, preview('duplicates', [holding('fresh-a', 4, 130), holding('fresh-b', 4, 130)]))
    expect(plan.nextFolios[0].positions.map((position) => position.id)).toEqual(['fresh-a', 'fresh-b'])
    const bse = replace(folios, preview('bse', [normalizePosition({ ...holding('bse'), exchange: 'BSE', providerSymbol: '500180.BO' })]))
    expect(bse.added).toHaveLength(1)
    expect(bse.removed).toHaveLength(1)
    expect(bse.nextFolios[0].positions[0].id).toBe('bse')
  })

  it('persists exactly one previous revision and restores it after reload, consuming undo', () => {
    const first = imported()
    const second = replace(first).nextFolios
    const third = replace(second, preview('third', [holding('third-row', 6, 140)]), { statementDate: '2026-10-11' }).nextFolios
    expect(third[0].previousRevision?.statement.id).toBe('second')
    expect(third[0].previousRevision).not.toHaveProperty('previousRevision')
    expect(saveFolios(third)).toBe(true)
    const loaded = loadFolios()
    expect(latestUndoableAccount(loaded)?.id).toBe('account:first')
    const restored = undoStatementImport(loaded, 'account:first')
    expect(restored[0].positions[0].quantity).toBe(8)
    expect(restored[0].statement?.id).toBe('second')
    expect(restored[0].importedAt).toBe(second[0].importedAt)
    expect(latestUndoableAccount(restored)).toBeNull()
    expect(restored[0]).not.toHaveProperty('previousRevision')
    expect(() => undoStatementImport(restored, 'account:first')).toThrow('no import available')
  })

  it('undoes a newly added account after reload and supports replacing legacy accounts', () => {
    expect(saveFolios(imported())).toBe(true)
    expect(undoStatementImport(loadFolios(), 'account:first')).toEqual([])
    const legacy: Folio[] = [{ id: 'legacy-account', name: 'Legacy account', importedAt: 1, positions: [holding()] }]
    expect(() => replace(legacy)).toThrow('undated statement')
    const plan = replace(legacy, undefined, { allowUndatedReplacement: true })
    expect(plan.nextFolios[0].previousRevision?.statement.id).toBe('legacy:legacy-account')
    expect(undoStatementImport(plan.nextFolios, 'legacy-account')[0].positions).toEqual(legacy[0].positions)
  })

  it('enforces nonempty aliases and account and position limits', () => {
    expect(() => planStatementImport([], { ...options, accountAlias: ' ', preview: preview('empty-alias') }, now)).toThrow('account alias')
    const accounts = Array.from({ length: 100 }, (_, index) => ({ id: `account-${index}`, name: `Account ${index}`, importedAt: 1, positions: [] }))
    expect(() => planStatementImport(accounts, { ...options, preview: preview('overflow') }, now)).toThrow('100 accounts')
    expect(() => replace(imported(), preview('many', Array.from({ length: 5001 }, (_, index) => holding(`row-${index}`))))).toThrow('5,000 holdings')
    const partial = planStatementImport([], { ...options, preview: { ...preview('partial'), rejectedCount: 1 } }, now)
    expect(partial.nextFolios[0].statement?.completeness).toBe('partial')
    expect(partial.warnings.join(' ')).toContain('rejected')
  })
})
