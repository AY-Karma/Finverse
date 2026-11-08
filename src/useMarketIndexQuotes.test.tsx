// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMarketIndexQuotes } from './useMarketIndexQuotes'

const state = vi.hoisted(() => ({ open: true, load: vi.fn(), empty: { quotes: {}, checkedAt: 0, unavailable: [] } }))
vi.mock('./live', () => ({ isMarketOpen: () => state.open }))
vi.mock('./marketIndexQuotes', () => ({ INDEX_REFRESH_MS: 30_000, cachedMarketIndexQuotes: () => state.empty, loadMarketIndexQuotes: state.load }))
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
    await act(async () => vi.advanceTimersByTime(30_000))
    expect(state.load).toHaveBeenCalledTimes(2)
    state.open = false
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(state.load).toHaveBeenCalledTimes(2)
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
