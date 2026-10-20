// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreProvider, useStore, type ImportPreview } from './useStore'
import { normalizePosition } from './instruments'
import { holdingIdentity } from './monitor'
import { loadFolios } from './store'
import { createWorkspaceArchive, parseWorkspaceArchive } from './workspaceArchive'
import type { StatementImportOptions } from './accountStatements'

vi.mock('./marketData', () => ({ marketData: { refreshQuotes: vi.fn() } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function preview(id: string, quantity: number, price: number): ImportPreview {
  return { id, fileName: `${id}.csv`, createdAt: Date.now(), issues: [], rejectedCount: 0, duplicateCount: 0, unmatchedCount: 0,
    positions: [normalizePosition({ id: `row:${id}`, ticker: 'HDFCBANK', name: 'HDFC Bank', type: 'stock', quantity, buyPrice: 100, invested: quantity * 100, lastPrice: price })] }
}

const addOptions: StatementImportOptions = { operation: 'add', accountAlias: 'Broker account', statementDate: '2026-10-01', complete: true }

async function mount() {
  let store!: ReturnType<typeof useStore>
  const Capture = () => { store = useStore(); return null }
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
  return { get store() { return store }, container, close: () => act(async () => root.unmount()) }
}

function replacement(store: ReturnType<typeof useStore>): StatementImportOptions {
  return { operation: 'replace', accountId: store.folios[0].id, expectedStatementId: store.folios[0].statement!.id, statementDate: '2026-10-02', complete: true }
}

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('durable account updates', () => {
  it('persists unchanged reviews through reload and backup without changing holdings, prices, history or undo targets', async () => {
    let workspace = await mount()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T12:00:00Z'))
    try {
      await act(async () => { await workspace.store.commitImport(preview('original', 10, 120), addOptions) })
      const original = workspace.store.folios[0]
      await act(async () => { await expect(workspace.store.confirmFolioUnchanged(original.id)).rejects.toThrow('folio is fresh') })
      const history = localStorage.getItem('finverse:portfolio-snapshots')
      localStorage.setItem('finverse:history:v2:review-test', 'cached-history')
      const reviewedAt = Date.parse('2026-10-25T12:00:00Z')
      clock.mockReturnValue(reviewedAt)
      await act(async () => { await workspace.store.confirmFolioUnchanged(original.id) })
      expect(workspace.store.folios[0]).toMatchObject({ ...original, reviewedAt })
      expect(localStorage.getItem('finverse:portfolio-snapshots')).toBe(history)
      expect(localStorage.getItem('finverse:history:v2:review-test')).toBe('cached-history')
      expect(workspace.store.snapshot).toMatchObject({ invested: 1000, currentValue: 1200 })
      expect(workspace.store.undoImportFolioId).toBe(original.id)
      const savedReview = localStorage.getItem('finverse:folios')
      await act(async () => { await expect(workspace.store.confirmFolioUnchanged(original.id)).rejects.toThrow('folio is fresh') })
      expect(localStorage.getItem('finverse:folios')).toBe(savedReview)
      await workspace.close()
      workspace = await mount()
      expect(workspace.store.folios[0]).toMatchObject({ ...original, reviewedAt })
      await act(async () => { await expect(workspace.store.confirmFolioUnchanged(original.id)).rejects.toThrow('folio is fresh') })
      const archive = parseWorkspaceArchive(JSON.stringify(createWorkspaceArchive(workspace.store.folios, workspace.store.settings, workspace.store.portfolioHistory))).archive
      expect(archive.folios[0].reviewedAt).toBe(reviewedAt)
      await act(async () => { await workspace.store.commitImport(preview('updated', 8, 130), replacement(workspace.store)) })
      expect(workspace.store.folios[0].reviewedAt).toBeUndefined()
      expect(loadFolios()[0].previousRevision?.reviewedAt).toBe(reviewedAt)
      await workspace.close()
      workspace = await mount()
      await act(async () => { await workspace.store.undoLastImport() })
      expect(workspace.store.folios[0].reviewedAt).toBe(reviewedAt)
      expect(workspace.store.folios[0].positions).toMatchObject(original.positions)
    } finally { await workspace.close() }
  })

  it('does not mark a folio fresh when saving fails or the workspace has changed', async () => {
    const workspace = await mount()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T12:00:00Z'))
    try {
      await act(async () => { await workspace.store.commitImport(preview('original', 10, 120), addOptions) })
      clock.mockReturnValue(Date.parse('2026-10-25T12:00:00Z'))
      const saved = localStorage.getItem('finverse:folios')
      const setItem = Storage.prototype.setItem
      const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (key === 'finverse:workspace-write:v1') throw new DOMException('Full', 'QuotaExceededError')
        setItem.call(this, key, value)
      })
      await act(async () => { await expect(workspace.store.confirmFolioUnchanged(workspace.store.folios[0].id)).rejects.toThrow('could not be saved') })
      expect(workspace.store.folios[0].reviewedAt).toBeUndefined()
      expect(localStorage.getItem('finverse:folios')).toBe(saved)
      failure.mockRestore()
      localStorage.setItem('finverse:folios', '[]')
      await act(async () => { await expect(workspace.store.confirmFolioUnchanged(workspace.store.folios[0].id)).rejects.toThrow('changed in another tab') })
      expect(localStorage.getItem('finverse:folios')).toBe('[]')
    } finally { await workspace.close() }
  })

  it('updates one account, preserves watch references, exports revisions and undoes after reload', async () => {
    let workspace = await mount()
    try {
      await act(async () => { expect(await workspace.store.commitImport(preview('original', 10, 120), addOptions)).toBe(true) })
      const originalId = workspace.store.positions[0].id
      localStorage.setItem('finverse:monitor:v1', JSON.stringify({ version: 1, events: [], alerts: [], rules: [{ id: 'rule', holdingId: originalId, holding: 'HDFC Bank', instrumentIdentity: holdingIdentity(workspace.store.positions[0]), condition: 'price_above', threshold: 100, active: true }] }))
      const updated = preview('updated', 8, 130)
      const options = replacement(workspace.store)
      await act(async () => { expect(await workspace.store.commitImport(updated, options)).toBe(true) })
      expect(workspace.store.snapshot).toMatchObject({ invested: 800, currentValue: 1040 })
      expect(loadFolios()[0].positions[0]).toMatchObject({ id: originalId, quantity: 8 })
      const rule = JSON.parse(localStorage.getItem('finverse:monitor:v1')!).rules[0]
      expect(rule.holdingId).toBe(originalId)
      expect(rule.unresolved).not.toBe(true)
      expect(workspace.store.portfolioHistory.at(-1)?.event?.kind).toBe('account-update')
      const archive = parseWorkspaceArchive(JSON.stringify(createWorkspaceArchive(workspace.store.folios, workspace.store.settings, workspace.store.portfolioHistory))).archive
      expect(archive.folios[0].previousRevision?.positions[0].quantity).toBe(10)
      const saved = localStorage.getItem('finverse:folios')
      await act(async () => { expect(await workspace.store.commitImport(updated, options)).toBe(true) })
      expect(localStorage.getItem('finverse:folios')).toBe(saved)
      await workspace.close()
      workspace = await mount()
      expect(workspace.store.undoImportFolioId).toBe('account:original')
      await act(async () => { expect(await workspace.store.undoLastImport()).toBe(true) })
      expect(workspace.store.snapshot).toMatchObject({ invested: 1000, currentValue: 1200 })
      expect(loadFolios()[0].positions[0].quantity).toBe(10)
      expect(workspace.store.portfolioHistory.at(-1)?.event?.kind).toBe('account-undo')
    } finally { await workspace.close() }
  })

  it('keeps separate accounts and uses the latest dated imported price', async () => {
    const workspace = await mount()
    try {
      await act(async () => { await workspace.store.commitImport(preview('first', 10, 120), addOptions) })
      await act(async () => { await workspace.store.commitImport(preview('second', 8, 130), { ...addOptions, accountAlias: 'Other broker', statementDate: '2026-10-02' }) })
      expect(workspace.store.folios).toHaveLength(2)
      expect(workspace.store.snapshot).toMatchObject({ invested: 1800, currentValue: 2340 })
      expect(workspace.store.positions[0].quantity).toBe(18)
    } finally { await workspace.close() }
  })

  it('leaves both visible and persisted state intact when replacement cannot be saved', async () => {
    const workspace = await mount()
    try {
      await act(async () => { await workspace.store.commitImport(preview('first', 10, 120), addOptions) })
      const saved = localStorage.getItem('finverse:folios')
      const setItem = Storage.prototype.setItem
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (key === 'finverse:workspace-write:v1') throw new DOMException('Full', 'QuotaExceededError')
        setItem.call(this, key, value)
      })
      await act(async () => { await expect(workspace.store.commitImport(preview('new', 8, 130), replacement(workspace.store))).rejects.toThrow('could not be saved') })
      expect(localStorage.getItem('finverse:folios')).toBe(saved)
      expect(workspace.store.snapshot).toMatchObject({ invested: 1000, currentValue: 1200 })
    } finally { await workspace.close() }
  })

  it('rejects a failed batch or stale tab without applying an earlier account', async () => {
    const workspace = await mount()
    try {
      await act(async () => { await expect(workspace.store.commitImports([preview('valid', 10, 120), { ...preview('bad', 1, 100), id: '' }], addOptions)).rejects.toThrow('invalid statement metadata') })
      expect(workspace.store.folios).toEqual([])
      expect(loadFolios()).toEqual([])
      localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'other', name: 'Other tab', importedAt: Date.now(), positions: [] }]))
      await act(async () => { await expect(workspace.store.commitImport(preview('stale', 10, 120), addOptions)).rejects.toThrow('another tab') })
      expect(loadFolios()[0].id).toBe('other')
      expect(workspace.store.folios).toEqual([])
    } finally { await workspace.close() }
  })

  it('rejects records that cannot survive canonical backup and reload validation', async () => {
    const workspace = await mount()
    try {
      const tooLong = preview('long', 10, 120)
      tooLong.positions[0].name = 'A'.repeat(501)
      await act(async () => { await expect(workspace.store.commitImport(tooLong, addOptions)).rejects.toThrow('holding name') })
      await act(async () => { await expect(workspace.store.commitImport(preview('large', 1e16, 120), addOptions)).rejects.toThrow('quantity') })
      expect(workspace.store.folios).toEqual([])
      expect(loadFolios()).toEqual([])
    } finally { await workspace.close() }
  })
})
