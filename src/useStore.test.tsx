// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreProvider, useStore, type ImportPreview } from './useStore'
import { loadSettings } from './store'
import { quoteKey } from './valuation'
import type { Position } from './types'
import { holdingIdentity } from './monitor'
import { createWorkspaceArchive, parseWorkspaceArchive, restoreWorkspaceArchive } from './workspaceArchive'
import { captureWorkspaceRecords } from './workspaceStorage'
import * as live from './live'

const { refreshQuotes } = vi.hoisted(() => ({ refreshQuotes: vi.fn() }))
vi.mock('./marketData', () => ({ marketData: { refreshQuotes } }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); refreshQuotes.mockReset() })

describe('portfolio saving', () => {
  it('waits for a saved import before starting market requests and stops after removing the last folio', async () => {
    vi.useFakeTimers()
    vi.spyOn(live, 'isMarketOpen').mockReturnValue(true)
    localStorage.setItem('finverse:settings', JSON.stringify({ ...loadSettings(), allowExternalData: true }))
    refreshQuotes.mockResolvedValue({ quotes: {}, updated: 0, failed: 0, skipped: 1 })
    const preview: ImportPreview = {
      id: 'first-import', fileName: 'holdings.csv', createdAt: Date.now(), issues: [], rejectedCount: 0, duplicateCount: 0, unmatchedCount: 0,
      positions: [{ id: 'first-holding', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }],
    }
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
      expect(store.marketDataRefreshing).toBe(false)
      await act(async () => {
        expect(await store.refreshNow()).toMatchObject({ ok: false, reason: 'disabled' })
        await vi.advanceTimersByTimeAsync(10 * 60_000)
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(refreshQuotes).not.toHaveBeenCalled()
      const setItem = Storage.prototype.setItem
      const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (key === 'finverse:workspace-write:v1') throw new DOMException('Full', 'QuotaExceededError')
        setItem.call(this, key, value)
      })
      await act(async () => { await expect(store.commitImport(preview)).rejects.toThrow('could not be saved') })
      expect(store.positions).toEqual([])
      expect(refreshQuotes).not.toHaveBeenCalled()
      failure.mockRestore()
      await act(async () => { expect(await store.commitImport(preview)).toBe(true) })
      expect(refreshQuotes).toHaveBeenCalledOnce()
      expect(refreshQuotes.mock.calls[0][0]).toMatchObject([{ ticker: 'TCS' }])
      await act(async () => { expect(await store.removeFolio(store.folios[0].id)).toBe(true) })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000)
        document.dispatchEvent(new Event('visibilitychange'))
        expect(await store.refreshNow()).toMatchObject({ ok: false, reason: 'disabled' })
      })
      expect(store.marketDataRefreshing).toBe(false)
      expect(refreshQuotes).toHaveBeenCalledOnce()
    } finally { await act(async () => root.unmount()) }
  })

  it('allows correcting a mistaken foreign venue when the original amounts are explicitly INR', async () => {
    const position: Position = { id: 'inr-venue', ticker: 'TCS', name: 'TCS', type: 'stock', exchange: 'LSE', currency: 'INR', providerSymbol: 'TCS', identityVersion: 2, exchangeSource: 'explicit', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'account', name: 'Account', importedAt: 1, positions: [position] }]))
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
      await act(async () => store.confirmInstrument('inr-venue', { ticker: 'TCS', type: 'stock', exchange: 'NSE', currency: 'INR', providerSymbol: 'TCS.NS' }))
      expect(store.positions[0]).toMatchObject({ exchange: 'NSE', currency: 'INR', invested: 100, lastPrice: 120 })
      expect(store.positions[0].identityIssue).toBeUndefined()
      expect(store.snapshot).toMatchObject({ invested: 100, currentValue: 120 })
    } finally { await act(async () => root.unmount()) }
  })

  it('rejects listing corrections that would relabel unsupported amounts as INR', async () => {
    const position: Position = { id: 'foreign', ticker: 'TCS', name: 'Example', type: 'stock', exchange: 'NSE', reportedCurrency: 'EUR', providerSymbol: 'TCS.NS', identityVersion: 2, exchangeSource: 'explicit', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'account', name: 'Account', importedAt: 1, positions: [position] }]))
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
      const persisted = localStorage.getItem('finverse:folios')
      await act(async () => {
        await expect(store.confirmInstrument('foreign', { ticker: 'TCS', type: 'stock', exchange: 'NSE', currency: 'INR', providerSymbol: 'TCS.NS' })).rejects.toThrow('corrected INR statement')
      })
      expect(localStorage.getItem('finverse:folios')).toBe(persisted)
      expect(store.positions[0]).toMatchObject({ reportedCurrency: 'EUR', invested: 100, lastPrice: 120 })
      expect(store.positions[0].currency).toBeUndefined()
      expect(store.snapshot).toMatchObject({ invested: 0, currentValue: 0 })
    } finally { await act(async () => root.unmount()) }
  })

  it('refreshes quotes manually and keeps prepared holdings stable', async () => {
    const position: Position = { exchange: 'NSE', currency: 'INR', identityVersion: 2, exchangeSource: 'explicit', providerSymbol: 'TCS.NS', id: 'overlap', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'test', name: 'Test', importedAt: 1, positions: [position] }]))
    localStorage.setItem('finverse:settings', JSON.stringify({ ...loadSettings(), allowExternalData: true }))
    refreshQuotes.mockResolvedValue({ quotes: {}, updated: 0, failed: 0, skipped: 0 })
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
      const preparedPositions = store.positions
      let finishQuotes!: () => void
      refreshQuotes.mockImplementationOnce(() => new Promise((resolve) => {
        finishQuotes = () => resolve({ quotes: { [quoteKey(position)]: { price: 150, at: Date.now(), source: 'yahoo' } }, updated: 1, failed: 0, skipped: 0 })
      }))
      let pending!: ReturnType<typeof store.refreshNow>
      await act(async () => { pending = store.refreshNow() })
      expect(refreshQuotes).toHaveBeenCalledTimes(2)
      await act(async () => { finishQuotes(); expect(await pending).toMatchObject({ ok: true }) })
      expect(store.positions).toBe(preparedPositions)
      expect(store.snapshot.currentValue).toBe(150)
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps a fresh workspace writable when StrictMode replays startup effects', async () => {
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<StrictMode><StoreProvider><Capture /></StoreProvider></StrictMode>))
      expect(localStorage.getItem('finverse:folios')).toBe('[]')
      expect(store.workspaceReadOnly).toBe(false)
      expect(store.settingsSaved).toBe(true)
      expect(container.textContent).not.toContain('changed in another tab')
    } finally { await act(async () => root.unmount()) }
  })
  it('preserves another tab\'s preferences before its storage event arrives', async () => {
    const position: Position = { id: 'holding', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'test', name: 'Test', importedAt: 1, positions: [position] }]))
    localStorage.setItem('finverse:settings', JSON.stringify({ ...loadSettings(), allowExternalData: true }))
    refreshQuotes.mockResolvedValue({ quotes: {}, updated: 0, failed: 0, skipped: 0 })
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
      const sessionSettings = store.settings
      const staleRefresh = store.refreshNow
      const otherTabSettings = JSON.stringify({ ...sessionSettings, allowExternalData: false })
      localStorage.setItem('finverse:settings', otherTabSettings)
      await act(async () => { expect(await staleRefresh()).toMatchObject({ ok: false, reason: 'disabled' }) })
      await act(async () => store.setSettings({ ...sessionSettings, density: 'compact' }))
      expect(localStorage.getItem('finverse:settings')).toBe(otherTabSettings)
      expect(store.settings).toEqual({ ...sessionSettings, allowExternalData: false })
      expect(refreshQuotes).toHaveBeenCalledTimes(1)
      expect(store.workspaceReadOnly).toBe(true)
      expect(store.settingsSaved).toBe(false)
      expect(container.textContent).toContain('Reload before saving')
    } finally { await act(async () => root.unmount()) }
  })
  it.each(['preferences', 'restore'])('cancels polling and stale manual refreshes after another tab changes %s', async (change) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T06:00:00Z'))
    const position: Position = { exchange: 'NSE', currency: 'INR', identityVersion: 2, exchangeSource: 'explicit', providerSymbol: 'PRICED.NS', id: 'priced', ticker: 'PRICED', name: 'Priced', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'test', name: 'Test', importedAt: Date.now(), positions: [position] }]))
    localStorage.setItem('finverse:settings', JSON.stringify({ ...loadSettings(), allowExternalData: true }))
    let signal!: AbortSignal
    refreshQuotes.mockImplementation((_positions, _previous, requestSignal: AbortSignal) => {
      signal = requestSignal
      return new Promise((_resolve, reject) => requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true }))
    })
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
      const staleRefresh = store.refreshNow
      expect(signal.aborted).toBe(false)
      await act(async () => {
        if (change === 'restore') {
          await restoreWorkspaceArchive(createWorkspaceArchive([], store.settings, []), captureWorkspaceRecords())
        } else localStorage.setItem('finverse:settings', JSON.stringify({ ...store.settings, allowExternalData: false }))
        window.dispatchEvent(new StorageEvent('storage', { key: change === 'restore' ? 'finverse:workspace-write:v1' : 'finverse:settings' }))
      })
      expect(signal.aborted).toBe(true)
      expect(store.settings.allowExternalData).toBe(false)
      expect(store.workspaceReadOnly).toBe(true)
      expect(store.snapshot.quotes).toEqual({})
      await act(async () => {
        expect(await staleRefresh()).toMatchObject({ ok: false, reason: 'disabled' })
        expect(await store.refreshNow()).toMatchObject({ ok: false, reason: 'disabled' })
        await vi.advanceTimersByTimeAsync(10 * 60_000)
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(refreshQuotes).toHaveBeenCalledTimes(1)
      expect(JSON.parse(localStorage.getItem('finverse:settings')!).allowExternalData).toBe(false)
    } finally { await act(async () => root.unmount()) }
  })
  it.each(['timer', 'visibility'])('checks durable consent before automatic quote refresh via %s, without a storage event', async (trigger) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T06:00:00Z'))
    vi.spyOn(live, 'isMarketOpen').mockReturnValue(true)
    const position: Position = { id: 'holding', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'test', name: 'Test', importedAt: 1, positions: [position] }]))
    localStorage.setItem('finverse:settings', JSON.stringify({ ...loadSettings(), allowExternalData: true }))
    refreshQuotes.mockResolvedValue({ quotes: {}, updated: 0, failed: 0, skipped: 0 })
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
      expect(refreshQuotes).toHaveBeenCalledOnce()
      const externalSettings = JSON.stringify({ ...store.settings, allowExternalData: false })
      localStorage.setItem('finverse:settings', externalSettings)
      await act(async () => {
        if (trigger === 'timer') await vi.advanceTimersByTimeAsync(5 * 60_000)
        else {
          vi.setSystemTime(new Date('2026-10-13T06:05:00Z'))
          document.dispatchEvent(new Event('visibilitychange'))
        }
      })
      expect(refreshQuotes).toHaveBeenCalledOnce()
      expect(store.settings.allowExternalData).toBe(false)
      expect(store.workspaceReadOnly).toBe(true)
      expect(localStorage.getItem('finverse:settings')).toBe(externalSettings)
    } finally { await act(async () => root.unmount()) }
  })
  it('rejects INR scheme confirmation for an unsupported fund currency', async () => {
    const fund: Position = { id: 'foreign-fund', reportedCurrency: 'EUR', ticker: 'Example', name: 'Example Fund Direct Growth', type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'account', name: 'Account', importedAt: Date.now(), positions: [fund] }]))
    localStorage.setItem('finverse:settings', JSON.stringify({ ...loadSettings(), allowExternalData: true }))
    refreshQuotes.mockResolvedValue({ quotes: {}, updated: 0, failed: 0, skipped: 1 })
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
      await expect(store.confirmFundScheme('foreign-fund', { schemeCode: 2, schemeName: 'Example Fund Direct Growth' })).rejects.toThrow('INR mutual-fund holdings only')
      expect(store.positions[0].mfScheme).toBeUndefined()
    } finally { await act(async () => root.unmount()) }
  })
  it('persists a reviewed BSE listing without changing its holding amounts', async () => {
    const holding: Position = { id: 'bse', ticker: '500112', name: 'Example BSE Holding', type: 'stock', quantity: 2, buyPrice: 100, invested: 200, lastPrice: 120, exchange: 'BSE', currency: 'INR', providerSymbol: '500112.BO', identityVersion: 2 }
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'account', name: 'Account', importedAt: Date.now(), positions: [holding] }]))
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
      expect(store.positions[0].identityIssue).toContain('numeric BSE')
      await act(async () => { await expect(store.confirmInstrument('bse', { ticker: '500112', type: 'stock', exchange: 'BSE', currency: 'INR' })).rejects.toThrow('numeric BSE') })
      expect(store.positions[0].providerSymbol).toBe('500112.BO')
      await act(async () => store.confirmInstrument('bse', { ticker: '500112', type: 'stock', exchange: 'BSE', currency: 'INR', providerSymbol: 'SBIN.BO', sector: 'Financials' }))
      expect(store.positions[0]).toMatchObject({ id: 'bse', exchange: 'BSE', exchangeSource: 'explicit', currency: 'INR', providerSymbol: 'SBIN.BO', sector: 'Financials', quantity: 2, invested: 200, lastPrice: 120 })
      expect(store.positions[0].identityIssue).toBeUndefined()
      const archive = parseWorkspaceArchive(JSON.stringify(createWorkspaceArchive(store.folios, store.settings, store.portfolioHistory)))
      expect(archive.archive.folios[0].positions[0].providerSymbol).toBe('SBIN.BO')
    } finally { await act(async () => root.unmount()) }
  })
  it('saves a confirmed scheme and rekeys its watch rule together, keeping both recoverable in a backup', async () => {
    const fund: Position = { id: 'fund', ticker: 'Example', name: 'Example Equity Fund Direct IDCW', type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'account', name: 'Account', importedAt: Date.now(), positions: [fund] }]))
    localStorage.setItem('finverse:settings', JSON.stringify({ ...loadSettings(), allowExternalData: true }))
    const normalizedFund = (await import('./instruments')).normalizePosition(fund)
    localStorage.setItem('finverse:monitor:v1', JSON.stringify({ version: 1, events: [], alerts: [], rules: [{ id: 'rule', holdingId: fund.id, holding: fund.name, instrumentIdentity: holdingIdentity(normalizedFund), condition: 'price_above', threshold: 100, active: true }] }))
    refreshQuotes.mockResolvedValue({ quotes: {}, updated: 0, failed: 0, skipped: 1 })
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
      await act(async () => store.confirmFundScheme('fund', { schemeCode: 2, schemeName: 'Example Equity Fund Direct Plan IDCW Option' }))
      expect(store.positions[0].mfScheme?.code).toBe(2)
      const monitor = JSON.parse(localStorage.getItem('finverse:monitor:v1')!)
      expect(monitor.rules[0].instrumentIdentity).toBe(holdingIdentity(store.positions[0]))
      const backup = parseWorkspaceArchive(JSON.stringify(createWorkspaceArchive(store.folios, store.settings, store.portfolioHistory)))
      expect(backup.archive.folios[0].positions[0].mfScheme?.code).toBe(2)
      const before = localStorage.getItem('finverse:folios')
      const setItem = Storage.prototype.setItem
      const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (key === 'finverse:workspace-write:v1') throw new DOMException('Full', 'QuotaExceededError')
        setItem.call(this, key, value)
      })
      await expect(store.confirmFundScheme('fund', { schemeCode: 3, schemeName: 'Example Equity Fund Direct Plan IDCW Option' })).rejects.toThrow('could not be saved')
      expect(localStorage.getItem('finverse:folios')).toBe(before)
      expect(store.positions[0].mfScheme?.code).toBe(2)
      failure.mockRestore()
    } finally { await act(async () => root.unmount()) }
  })
  it('does not save a partial valuation as a complete tracked snapshot', async () => {
    const positions: Position[] = [
      { id: 'priced', ticker: 'PRICED', name: 'Priced', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 },
      { id: 'missing', ticker: 'MISSING', name: 'Missing', type: 'stock', quantity: 1, buyPrice: 1000, invested: 1000, lastPrice: null },
    ]
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'test', name: 'Test', importedAt: Date.now(), positions }]))
    localStorage.setItem('finverse:settings', JSON.stringify({ ...loadSettings(), allowExternalData: false }))
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<StoreProvider><div /></StoreProvider>))
      expect(localStorage.getItem('finverse:portfolio-snapshots')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it('gates retained prices consistently and cancels manual refresh when external permission is revoked', async () => {
    const position: Position = { exchange: 'NSE', currency: 'INR', identityVersion: 2, exchangeSource: 'explicit', providerSymbol: 'PRICED.NS', id: 'priced', ticker: 'PRICED', name: 'Priced', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'test', name: 'Test', importedAt: Date.now(), positions: [position] }]))
    localStorage.setItem('finverse:settings', JSON.stringify({ ...loadSettings(), allowExternalData: true }))
    refreshQuotes.mockResolvedValueOnce({ quotes: { [quoteKey(position)]: { price: 150, at: Date.now(), source: 'yahoo' } }, updated: 1, failed: 0, skipped: 0 })
    let store!: ReturnType<typeof useStore>
    const Capture = () => { store = useStore(); return null }
    const root = createRoot(document.createElement('div'))
    let signal!: AbortSignal
    refreshQuotes.mockImplementationOnce((_positions, _previous, requestSignal: AbortSignal) => {
      signal = requestSignal
      return new Promise((_resolve, reject) => requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true }))
    })
    try {
      await act(async () => root.render(<StoreProvider><Capture /></StoreProvider>))
      expect(store.snapshot.currentValue).toBe(150)
      const pending = store.refreshNow()
      await act(async () => store.setSettings({ ...store.settings, allowExternalData: false }))
      expect(signal.aborted).toBe(true)
      await expect(pending).resolves.toMatchObject({ ok: false })
      expect(store.snapshot.currentValue).toBe(120)
      expect(store.snapshot.quotes).toEqual({})
      expect(store.snapshot.dailyChange).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps the workspace available and offers a retry after storage fails', async () => {
    let storageAvailable = false
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        if (!storageAvailable) throw new DOMException('Full', 'QuotaExceededError')
      },
    })
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<StoreProvider><div>Workspace</div></StoreProvider>))
      expect(container.textContent).toContain('Workspace')
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be saved')

      storageAvailable = true
      const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry saving')
      await act(async () => retry?.click())
      expect(container.querySelector('[role="alert"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })
})
