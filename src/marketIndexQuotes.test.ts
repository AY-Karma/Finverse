import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicMarketQuote } from './marketData'

const provider = vi.hoisted(() => ({ quotes: vi.fn() }))
vi.mock('./marketData', async (original) => ({ ...await original<typeof import('./marketData')>(), marketData: provider }))

const now = new Date('2026-11-06T06:00:00Z').getTime()
const quote = (price = 25_000, at = now): PublicMarketQuote => ({ price, change: 100, pct: 0.4, at })

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(now); provider.quotes.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('public Indian index quotes', () => {
  it('batches all five fixed indices and shares concurrent loads and fresh cache', async () => {
    const { MARKET_INDICES, loadMarketIndexQuotes } = await import('./marketIndexQuotes')
    provider.quotes.mockResolvedValue(new Map(MARKET_INDICES.map((index) => [index.symbol, quote()])))
    const [first, second] = await Promise.all([loadMarketIndexQuotes(), loadMarketIndexQuotes()])
    expect(first).toBe(second)
    expect(provider.quotes).toHaveBeenCalledTimes(1)
    expect(provider.quotes.mock.calls[0][0]).toEqual(['^NSEI', '^BSESN', '^NSEBANK', '^NSMIDCP', '^NSEMDCP50'])
    expect(Object.keys(first.quotes)).toHaveLength(5)
    expect(await loadMarketIndexQuotes()).toBe(first)
    expect(provider.quotes).toHaveBeenCalledTimes(1)
  })

  it('retains valid previous observations on partial and failed refreshes', async () => {
    const { MARKET_INDICES, INDEX_REFRESH_MS, loadMarketIndexQuotes } = await import('./marketIndexQuotes')
    provider.quotes.mockResolvedValueOnce(new Map(MARKET_INDICES.map((index) => [index.symbol, quote()])))
    await loadMarketIndexQuotes()
    vi.advanceTimersByTime(INDEX_REFRESH_MS)
    provider.quotes.mockResolvedValueOnce(new Map([['^NSEI', quote(25_100, Date.now())]]))
    const partial = await loadMarketIndexQuotes()
    expect(partial.quotes['^NSEI'].price).toBe(25_100)
    expect(partial.quotes['^BSESN']).toEqual(quote())
    expect(partial.unavailable).toContain('^BSESN')
    expect(partial.unavailable).not.toContain('^NSEI')
    vi.advanceTimersByTime(INDEX_REFRESH_MS)
    provider.quotes.mockRejectedValueOnce(new Error('Temporary outage'))
    const failed = await loadMarketIndexQuotes()
    expect(failed.quotes).toEqual(partial.quotes)
    expect(failed.unavailable).toHaveLength(5)
  })

  it('rejects invalid, future and older observations and excludes unrelated symbols', async () => {
    const { INDEX_REFRESH_MS, loadMarketIndexQuotes } = await import('./marketIndexQuotes')
    provider.quotes.mockResolvedValueOnce(new Map([
      ['^NSEI', quote()], ['^BSESN', quote(-1)], ['^NSEBANK', quote(100, now + 600_000)],
      ['^NSMIDCP', { ...quote(), price: NaN }], ['^NSEMDCP50', { ...quote(), change: NaN, pct: Infinity }],
      ['PRIVATE.NS', quote()],
    ]))
    const first = await loadMarketIndexQuotes()
    expect(Object.keys(first.quotes)).toEqual(['^NSEI', '^NSEMDCP50'])
    expect(first.quotes['^NSEMDCP50']).toMatchObject({ change: null, pct: null })
    vi.advanceTimersByTime(INDEX_REFRESH_MS)
    provider.quotes.mockResolvedValueOnce(new Map([['^NSEI', quote(20_000, now - 1_000)]]))
    const next = await loadMarketIndexQuotes()
    expect(next.quotes['^NSEI']).toEqual(quote())
    expect(next.unavailable).toContain('^NSEI')
  })

  it('cancels a load without admitting data after the caller leaves', async () => {
    const { loadMarketIndexQuotes, cachedMarketIndexQuotes } = await import('./marketIndexQuotes')
    let complete!: (quotes: Map<string, PublicMarketQuote>) => void
    provider.quotes.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    const controller = new AbortController()
    const result = loadMarketIndexQuotes(controller.signal)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    controller.abort()
    complete(new Map([['^NSEI', quote()]]))
    await rejected
    expect(cachedMarketIndexQuotes().quotes).toEqual({})
  })
})
