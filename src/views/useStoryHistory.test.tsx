// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useStoryHistory } from './useStoryHistory'
import type { Position } from '../types'

const history = vi.hoisted(() => vi.fn())
vi.mock('../marketData', () => ({ BENCHMARKS: [], marketData: { history } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('keeps saved story prices when retrying the same period fails', async () => {
  const positions: Position[] = [{ id: 'tcs', ticker: 'TCS', name: 'TCS', type: 'stock', exchange: 'NSE', currency: 'INR', sector: 'Technology', quantity: 1, invested: 100, buyPrice: 100, lastPrice: 110 }]
  const points = [{ date: '2026-10-30', close: 100 }, { date: '2026-11-06', close: 110 }]
  history.mockResolvedValue(points)
  let result: ReturnType<typeof useStoryHistory>
  function Probe() {
    result = useStoryHistory(positions, true, '2026-11-07')
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<Probe />))
    expect(Object.values(result!.histories)).toEqual([points])
    history.mockRejectedValue(new Error('Offline'))
    await act(async () => result!.retry())
    expect(result!.failed).toBe(true)
    expect(Object.values(result!.histories)).toEqual([points])
  } finally {
    await act(async () => root.unmount())
  }
})
