// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { createMarketEventsLoader, loadMarketEvents } from './marketEvents'
import { useMarketEvents } from './useMarketEvents'
import type { Position } from './types'

vi.mock('./marketEvents', async (importOriginal) => ({ ...await importOriginal<typeof import('./marketEvents')>(), loadMarketEvents: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('company event requests', () => {
  it('clears obsolete events on an empty successful refresh of a mixed stock and fund portfolio', async () => {
    const now = Date.now()
    const event = { id: 'results', symbol: 'INFY', title: 'Financial Results', kind: 'results', date: new Date(now).toISOString().slice(0, 10), dateLabel: 'Meeting date', source: 'NSE', sourceUrl: 'https://www.nseindia.com/companies-listing/corporate-filings-board-meetings' }
    let providerEvents = [event]
    const loader = createMarketEventsLoader(vi.fn(async () => Response.json({ events: providerEvents, issues: [], fetchedAt: now })))
    const load = vi.mocked(loadMarketEvents)
    load.mockImplementation(loader)
    const positions: Position[] = [
      { id: 'infy', ticker: 'INFY', name: 'Infosys', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100, exchange: 'NSE', exchangeSource: 'explicit', currency: 'INR', providerSymbol: 'INFY.NS' },
      { id: 'fund', ticker: 'FUND', name: 'Fund', type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 },
    ]
    const root = createRoot(document.createElement('div'))
    let controller!: ReturnType<typeof useMarketEvents>
    function Capture() { controller = useMarketEvents(positions, true, false); return null }
    try {
      await act(async () => root.render(<Capture />))
      expect(controller.feed.events).toHaveLength(1)
      expect(controller.feed.issues).toHaveLength(1)
      load.mockResolvedValueOnce({ events: [], issues: [{ source: 'NSE', message: 'Unavailable' }], fetchedAt: 0, sourceFailed: true })
      await act(async () => controller.refresh())
      expect(controller.feed.events).toHaveLength(1)
      expect(controller.feed.sourceFailed).toBe(true)
      providerEvents = []
      await act(async () => controller.refresh())
      expect(controller.feed.events).toEqual([])
      expect(controller.feed.sourceFailed).toBe(false)
    } finally { await act(async () => root.unmount()); load.mockReset() }
  })

  it('bypasses cache for explicit refreshes while retaining normal load caching and cancellation', async () => {
    const load = vi.mocked(loadMarketEvents)
    load.mockResolvedValue({ events: [], issues: [], fetchedAt: 1 })
    const root = createRoot(document.createElement('div'))
    let positions: Position[] = [{ id: 'infy', ticker: 'INFY', name: 'Infosys', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }]
    let masked = false
    let controller!: ReturnType<typeof useMarketEvents>
    function Capture() { controller = useMarketEvents(positions, true, masked); return null }

    try {
      await act(async () => root.render(<Capture />))
      expect(load.mock.lastCall?.[1]?.forceRefresh).toBe(false)
      const initialSignal = load.mock.lastCall![1]!.signal!
      await act(async () => controller.refresh())
      expect(initialSignal.aborted).toBe(true)
      expect(load.mock.lastCall?.[1]?.forceRefresh).toBe(true)

      positions = positions.map((position) => ({ ...position, lastPrice: 110 }))
      await act(async () => root.render(<Capture />))
      expect(load).toHaveBeenCalledTimes(2)
      const refreshedSignal = load.mock.lastCall![1]!.signal!
      masked = true
      await act(async () => root.render(<Capture />))
      expect(refreshedSignal.aborted).toBe(true)
      expect(controller.feed.events).toEqual([])
      masked = false
      await act(async () => root.render(<Capture />))
      expect(load).toHaveBeenCalledTimes(3)
      expect(load.mock.lastCall?.[1]?.forceRefresh).toBe(false)
      positions = positions.map((position) => ({ ...position, name: 'Updated company name', exchangeSource: 'explicit' }))
      await act(async () => root.render(<Capture />))
      expect(load).toHaveBeenCalledTimes(4)
      expect(load.mock.lastCall?.[0][0].name).toBe('Updated company name')
    } finally {
      await act(async () => root.unmount())
      load.mockReset()
    }
  })
})
