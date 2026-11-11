// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMarketIndexQuotes } from './useMarketIndexQuotes'

const state = vi.hoisted(() => ({ open: true, load: vi.fn(), empty: { quotes: {}, checkedAt: 0, unavailable: [] } }))
vi.mock('./live', () => ({ isMarketOpen: () => state.open, CLOSED_QUOTE_RECHECK_MS: 24 * 60 * 60_000 }))
vi.mock('./marketIndexQuotes', () => ({
  INDEX_REFRESH_MS: 1_000,
  cachedMarketIndexQuotes: () => state.empty, loadMarketIndexQuotes: state.load,
  nextMarketIndexRefreshAt: () => Date.now() + 1_000,
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let allowed = true
let result: ReturnType<typeof useMarketIndexQuotes>
function Capture() { result = useMarketIndexQuotes(allowed); return null }
const render = () => act(async () => root.render(<Capture />))

beforeEach(() => {
  vi.useFakeTimers()
  state.open = true
  state.load.mockReset().mockResolvedValue({ quotes: { '^NSEI': { price: 25_000, change: 100, pct: 0.4, at: Date.now() } }, checkedAt: Date.now(), unavailable: [] })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  allowed = true
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })

describe('index quote refresh lifecycle', () => {
  it('schedules from the cache deadline instead of rounding delayed results to another polling tick', async () => {
    state.load.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
      return { quotes: {}, checkedAt: Date.now(), unavailable: [] }
    })
    await render()
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    await act(async () => { await vi.advanceTimersByTimeAsync(999) })
    expect(state.load).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(state.load).toHaveBeenCalledTimes(2)
  })

  it('makes no request before permission and clears visible quotes after permission is removed', async () => {
    allowed = false
    await render()
    expect(state.load).not.toHaveBeenCalled()
    allowed = true
    await render()
    expect(state.load).toHaveBeenCalledTimes(1)
    expect(result.quotes['^NSEI'].price).toBe(25_000)
    const signal = state.load.mock.calls[0][0] as AbortSignal
    allowed = false
    await render()
    expect(signal.aborted).toBe(false)
    expect(result.quotes).toEqual({})
    await act(async () => vi.advanceTimersByTime(90_000))
    expect(state.load).toHaveBeenCalledTimes(1)
  })

  it('loads once on entry and polls only while the Indian market is open', async () => {
    state.open = false
    await render()
    await act(async () => vi.advanceTimersByTime(90_000))
    expect(state.load).toHaveBeenCalledTimes(1)
    state.open = true
    await act(async () => vi.advanceTimersByTime(5_000))
    expect(state.load).toHaveBeenCalledTimes(2)
    state.open = false
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(state.load).toHaveBeenCalledTimes(3)
  })

  it('pauses when hidden and catches up once when visible', async () => {
    await render()
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(90_000) })
    expect(state.load).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(state.load).toHaveBeenCalledTimes(2)
  })

  it('does not refetch on repeated tab returns while the market stays closed', async () => {
    state.open = false
    await render()
    for (let i = 0; i < 3; i++) {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      await act(async () => document.dispatchEvent(new Event('visibilitychange')))
      await act(async () => vi.advanceTimersByTime(60_000))
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    }
    expect(state.load).toHaveBeenCalledOnce()
    state.open = true
    await act(async () => vi.advanceTimersByTime(5_000))
    expect(state.load).toHaveBeenCalledTimes(2)
  })

  it('defers a hidden offhours entry until visible, then loads only once', async () => {
    state.open = false
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await render()
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(state.load).not.toHaveBeenCalled()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(state.load).toHaveBeenCalledOnce()
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(state.load).toHaveBeenCalledOnce()
    expect(result.loading).toBe(false)
  })

  it('catches up once on return after a day suspended, then stays paused', async () => {
    vi.setSystemTime(new Date('2026-10-13T18:00:00Z'))
    state.open = false
    await render()
    vi.setSystemTime(new Date('2026-10-14T18:00:00Z'))
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(state.load).toHaveBeenCalledTimes(2)
    expect(state.load.mock.calls[1][1]).toBe(true)
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(state.load).toHaveBeenCalledTimes(2)
  })

  it('captures a close missed while hidden once on return, then stays paused', async () => {
    await render()
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    state.open = false
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(state.load).toHaveBeenCalledOnce()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(state.load).toHaveBeenCalledTimes(2)
    expect(state.load.mock.calls[1][1]).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(60_000)
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(state.load).toHaveBeenCalledTimes(2)
  })

  it('checks the final index prices once when the market closes without a navigation', async () => {
    await render()
    expect(state.load).toHaveBeenCalledTimes(1)
    state.open = false
    await act(async () => vi.advanceTimersByTime(5_000))
    expect(state.load).toHaveBeenCalledTimes(2)
    expect(state.load.mock.calls[1][1]).toBe(true)
    await act(async () => vi.advanceTimersByTime(90_000))
    expect(state.load).toHaveBeenCalledTimes(2)
  })

  it('waits for an in-flight request before fetching the final index close', async () => {
    let complete!: (value: typeof state.empty) => void
    state.load.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    await render()
    state.open = false
    await act(async () => vi.advanceTimersByTime(5_000))
    expect(state.load).toHaveBeenCalledTimes(1)
    await act(async () => complete({ quotes: {}, checkedAt: Date.now(), unavailable: [] }))
    await act(async () => vi.advanceTimersByTime(5_000))
    expect(state.load).toHaveBeenCalledTimes(2)
    expect(state.load.mock.calls[1][1]).toBe(true)
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(state.load).toHaveBeenCalledTimes(2)
  })

  it('aborts pending work on permission removal and ignores late results', async () => {
    let complete!: (value: typeof state.empty) => void
    state.load.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    await render()
    const signal = state.load.mock.calls[0][0] as AbortSignal
    allowed = false
    await render()
    expect(signal.aborted).toBe(true)
    await act(async () => complete({ quotes: {}, checkedAt: 123, unavailable: [] }))
    expect(result.checkedAt).toBe(0)
  })
})
