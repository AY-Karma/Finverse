// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreProvider, useStore } from './useStore'
import { loadSettings } from './store'
import { quoteKey } from './valuation'
import type { Position } from './types'

const { refreshQuotes } = vi.hoisted(() => ({ refreshQuotes: vi.fn() }))
vi.mock('./marketData', () => ({ marketData: { refreshQuotes } }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); refreshQuotes.mockReset() })

describe('portfolio saving', () => {
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
    const position: Position = { id: 'priced', ticker: 'PRICED', name: 'Priced', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }
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
