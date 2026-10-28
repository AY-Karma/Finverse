// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { loadMarketEvents } from './marketEvents'
import { useMarketEvents } from './useMarketEvents'
import type { Position } from './types'

vi.mock('./marketEvents', () => ({ loadMarketEvents: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('company event requests', () => {
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
    } finally {
      await act(async () => root.unmount())
      load.mockReset()
    }
  })
})
