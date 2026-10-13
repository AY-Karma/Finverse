// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveFolios } from './store'
import { captureWorkspaceRecords, hasWorkspaceRecovery, recoverWorkspaceWrite, restorePreviousWorkspace, workspaceWritesBlocked, writeWorkspaceRecords } from './workspaceStorage'

const JOURNAL = 'finverse:workspace-write:v1'
function originalWorkspace() {
  localStorage.setItem('finverse:folios', 'old holdings')
  localStorage.setItem('finverse:settings', JSON.stringify({ allowExternalData: true, hideValues: true }))
  localStorage.setItem('finverse:history:v2:TCS.NS', 'cached history')
  return captureWorkspaceRecords()
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

describe('workspace restore storage', () => {
  it('keeps a durable previous workspace and rebuilds caches after successful restore or undo', async () => {
    const expected = originalWorkspace()
    const next = { ...expected, 'finverse:folios': 'new holdings' }
    await writeWorkspaceRecords(next, expected)
    expect(localStorage.getItem('finverse:folios')).toBe('new holdings')
    expect(localStorage.getItem('finverse:history:v2:TCS.NS')).toBeNull()
    expect(hasWorkspaceRecovery()).toBe(true)
    expect(workspaceWritesBlocked()).toBe(false)
    await restorePreviousWorkspace(captureWorkspaceRecords())
    expect(localStorage.getItem('finverse:folios')).toBe('old holdings')
    expect(JSON.parse(localStorage.getItem('finverse:settings')!).allowExternalData).toBe(false)
  })

  it('rejects a stale preview and a pending journal before any restore mutation', async () => {
    const expected = originalWorkspace()
    localStorage.setItem('finverse:folios', 'changed in another tab')
    await expect(writeWorkspaceRecords({ ...expected, 'finverse:folios': 'new' }, expected)).rejects.toThrow('changed after this preview')
    expect(localStorage.getItem('finverse:folios')).toBe('changed in another tab')
    localStorage.setItem(JOURNAL, JSON.stringify({ version: 1, id: 'pending', phase: 'writing', before: expected }))
    await expect(writeWorkspaceRecords(expected, captureWorkspaceRecords())).rejects.toThrow('recovery is pending')
    expect(saveFolios([])).toBe(false)
    expect(localStorage.getItem('finverse:folios')).toBe('changed in another tab')
  })

  it('retains the original workspace when browser storage cannot even create the journal', async () => {
    const expected = originalWorkspace()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    await expect(writeWorkspaceRecords({ ...expected, 'finverse:folios': 'new' }, expected)).rejects.toThrow('original workspace has been retained')
    expect(captureWorkspaceRecords()).toEqual(expected)
  })

  it('rolls back a failure between canonical writes', async () => {
    const expected = originalWorkspace()
    const setItem = Storage.prototype.setItem
    let fail = true
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'finverse:settings' && fail) { fail = false; throw new DOMException('Full', 'QuotaExceededError') }
      setItem.call(this, key, value)
    })
    await expect(writeWorkspaceRecords({ ...expected, 'finverse:folios': 'new' }, expected)).rejects.toThrow('original workspace has been retained')
    expect(captureWorkspaceRecords()).toEqual(expected)
    expect(localStorage.getItem(JOURNAL)).toBeNull()
    expect(localStorage.getItem('finverse:history:v2:TCS.NS')).toBe('cached history')
  })

  it('recovers the originals on startup even when the immediate rollback also failed', async () => {
    const expected = originalWorkspace()
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'finverse:settings' || (key === 'finverse:folios' && value === 'old holdings')) throw new DOMException('Full', 'QuotaExceededError')
      setItem.call(this, key, value)
    })
    await expect(writeWorkspaceRecords({ ...expected, 'finverse:folios': 'new' }, expected)).rejects.toThrow('recovery journal')
    expect(localStorage.getItem('finverse:folios')).toBe('new')
    expect(workspaceWritesBlocked()).toBe(true)
    vi.restoreAllMocks()
    expect(await recoverWorkspaceWrite()).toEqual({ recovered: true, error: null })
    expect(captureWorkspaceRecords()).toEqual(expected)
    expect(workspaceWritesBlocked()).toBe(false)
  })

  it('never undoes a committed restore when final journal cleanup failed', async () => {
    const expected = originalWorkspace()
    const removeItem = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key === JOURNAL) throw new DOMException('Blocked', 'SecurityError')
      removeItem.call(this, key)
    })
    await writeWorkspaceRecords({ ...expected, 'finverse:folios': 'new' }, expected)
    expect(JSON.parse(localStorage.getItem(JOURNAL)!).phase).toBe('committed')
    vi.restoreAllMocks()
    expect(await recoverWorkspaceWrite()).toEqual({ recovered: false, error: null })
    expect(localStorage.getItem('finverse:folios')).toBe('new')
    expect(localStorage.getItem(JOURNAL)).toBeNull()
  })

  it('refuses malformed recovery records without deleting them', async () => {
    localStorage.setItem(JOURNAL, '{broken')
    expect((await recoverWorkspaceWrite()).error).toBeTruthy()
    expect(localStorage.getItem(JOURNAL)).toBe('{broken')
    expect(workspaceWritesBlocked()).toBe(true)
  })

  it('lets ordinary mutations preserve the last restore recovery copy and compatible caches', async () => {
    const expected = originalWorkspace()
    await writeWorkspaceRecords({ ...expected, 'finverse:folios': 'restored holdings' }, expected)
    const recoveryCopy = localStorage.getItem('finverse:workspace-previous:v1')
    localStorage.setItem('finverse:history:v2:TCS.NS', 'fresh compatible history')
    const current = captureWorkspaceRecords()
    await writeWorkspaceRecords({ ...current, 'finverse:folios': 'updated holdings' }, current, { keepRecoveryCopy: false, invalidateCaches: false })
    expect(localStorage.getItem('finverse:workspace-previous:v1')).toBe(recoveryCopy)
    expect(localStorage.getItem('finverse:history:v2:TCS.NS')).toBe('fresh compatible history')
    await restorePreviousWorkspace(captureWorkspaceRecords())
    expect(localStorage.getItem('finverse:folios')).toBe('old holdings')
  })
})
