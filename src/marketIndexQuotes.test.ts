import './test/storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicMarketQuote } from './marketData'

const provider = vi.hoisted(() => ({ quotes: vi.fn() }))
vi.mock('./marketData', async (original) => ({ ...await original<typeof import('./marketData')>(), marketData: provider }))

const now = new Date('2026-11-06T06:00:00Z').getTime()
const quote = (price = 25_000, at = now): PublicMarketQuote => ({ price, change: 100, pct: 0.4, at })

beforeEach(() => { localStorage.clear(); vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(now); provider.quotes.mockReset() })
afterEach(() => { localStorage.clear(); vi.useRealTimers() })

describe('fixed public index quotes', () => {
  it('requests and restores a selected global pair independently of a fresh default pair', async () => {
    const api = await import('./marketIndexQuotes')
    provider.quotes.mockResolvedValueOnce(new Map([['^NSEI', quote()], ['^NSEBANK', quote(50_000)]]))
    await api.loadMarketIndexQuotes()
    const ids = ['sp-500', 'nasdaq-composite']
    provider.quotes.mockResolvedValueOnce(new Map([['^GSPC', quote(6_000)], ['^IXIC', quote(20_000)]]))
    const global = await api.loadMarketIndexQuotes(undefined, false, ids)
    expect(provider.quotes.mock.calls[1][0]).toEqual(['^GSPC', '^IXIC'])
    expect(Object.keys(global.quotes)).toEqual(['^GSPC', '^IXIC'])
    api.persistMarketIndexQuotes()
    vi.resetModules()
    expect((await import('./marketIndexQuotes')).cachedMarketIndexQuotes(ids).quotes).toEqual(global.quotes)
  })

  it('keeps late default-pair results out of the selected global-pair snapshot', async () => {
    const api = await import('./marketIndexQuotes')
    let complete!: (quotes: Map<string, PublicMarketQuote>) => void
    provider.quotes.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const old = api.loadMarketIndexQuotes()
    await Promise.resolve()
    const ids = ['sp-500', 'dax']
    provider.quotes.mockResolvedValueOnce(new Map([['^GSPC', quote(6_000)], ['^GDAXI', quote(24_000)]]))
    const current = await api.loadMarketIndexQuotes(undefined, false, ids)
    complete(new Map([['^NSEI', quote()], ['^NSEBANK', quote(50_000)]]))
    await old
    expect(api.cachedMarketIndexQuotes(ids)).toBe(current)
    expect(Object.keys(current.quotes)).toEqual(['^GSPC', '^GDAXI'])
  })

  it('restores both index observations on reload and still requests fresh quotes immediately', async () => {
    const first = await import('./marketIndexQuotes')
    provider.quotes.mockResolvedValue(new Map([['^NSEI', quote()], ['^NSEBANK', quote(50_000)]]))
    const saved = await first.loadMarketIndexQuotes()
    vi.resetModules()
    const reloaded = await import('./marketIndexQuotes')
    expect(reloaded.cachedMarketIndexQuotes()).toEqual(saved)
    await reloaded.loadMarketIndexQuotes()
    expect(provider.quotes).toHaveBeenCalledTimes(2)
    vi.setSystemTime(now + 8 * 86_400_000)
    vi.resetModules()
    expect((await import('./marketIndexQuotes')).cachedMarketIndexQuotes().quotes).toEqual({})
  })

  it('batches only Bank Nifty and NIFTY 50 and shares concurrent loads and fresh cache', async () => {
    const { MARKET_INDICES, loadMarketIndexQuotes } = await import('./marketIndexQuotes')
    provider.quotes.mockResolvedValue(new Map(MARKET_INDICES.map((index) => [index.symbol, quote()])))
    const [first, second] = await Promise.all([loadMarketIndexQuotes(), loadMarketIndexQuotes()])
    expect(first).toBe(second)
    expect(provider.quotes).toHaveBeenCalledTimes(1)
    expect(provider.quotes.mock.calls[0][0]).toEqual(['^NSEBANK', '^NSEI'])
    expect(MARKET_INDICES.map((index) => index.id)).toEqual(['nifty-bank', 'nifty-50'])
    expect(Object.keys(first.quotes)).toHaveLength(2)
    expect(await loadMarketIndexQuotes()).toBe(first)
    expect(provider.quotes).toHaveBeenCalledTimes(1)
  })

  it('refreshes a healthy pair at one second rather than returning an older cache', async () => {
    const { loadMarketIndexQuotes } = await import('./marketIndexQuotes')
    provider.quotes.mockResolvedValue(new Map([['^NSEI', quote()], ['^NSEBANK', quote()]]))
    await loadMarketIndexQuotes()
    vi.advanceTimersByTime(999)
    await loadMarketIndexQuotes()
    expect(provider.quotes).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    await loadMarketIndexQuotes()
    expect(provider.quotes).toHaveBeenCalledTimes(2)
  })

  it('retains valid previous observations on partial and failed refreshes', async () => {
    const { MARKET_INDICES, INDEX_REFRESH_MS, loadMarketIndexQuotes } = await import('./marketIndexQuotes')
    provider.quotes.mockResolvedValueOnce(new Map(MARKET_INDICES.map((index) => [index.symbol, quote()])))
    await loadMarketIndexQuotes()
    vi.advanceTimersByTime(INDEX_REFRESH_MS)
    provider.quotes.mockResolvedValueOnce(new Map([['^NSEI', quote(25_100, Date.now())]]))
    const partial = await loadMarketIndexQuotes()
    expect(partial.quotes['^NSEI'].price).toBe(25_100)
    expect(partial.quotes['^NSEBANK']).toEqual(quote())
    expect(partial.unavailable).toContain('^NSEBANK')
    expect(partial.unavailable).not.toContain('^NSEI')
    vi.advanceTimersByTime(INDEX_REFRESH_MS)
    provider.quotes.mockRejectedValueOnce(new Error('Temporary outage'))
    const failed = await loadMarketIndexQuotes()
    expect(failed.quotes).toEqual(partial.quotes)
    expect(failed.unavailable).toHaveLength(2)
  })

  it('keeps a thirty-second retry window after the whole batch fails', async () => {
    const { loadMarketIndexQuotes, INDEX_REFRESH_MS } = await import('./marketIndexQuotes')
    provider.quotes.mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockResolvedValue(new Map([['^NSEI', quote()], ['^NSEBANK', quote()]]))
    await loadMarketIndexQuotes()
    vi.advanceTimersByTime(INDEX_REFRESH_MS)
    await loadMarketIndexQuotes()
    expect(provider.quotes).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_000 - INDEX_REFRESH_MS)
    await loadMarketIndexQuotes()
    expect(provider.quotes).toHaveBeenCalledTimes(2)
  })

  it('bypasses the fresh cache for a final session-close check', async () => {
    const { loadMarketIndexQuotes } = await import('./marketIndexQuotes')
    provider.quotes.mockResolvedValueOnce(new Map([['^NSEI', quote()]]))
    await loadMarketIndexQuotes()
    provider.quotes.mockResolvedValueOnce(new Map([['^NSEI', quote(25_100, now + 1_000)]]))
    vi.advanceTimersByTime(1_000)
    expect((await loadMarketIndexQuotes(undefined, true)).quotes['^NSEI'].price).toBe(25_100)
    expect(provider.quotes).toHaveBeenCalledTimes(2)
  })

  it('retains a newer observation and excludes unrelated symbols', async () => {
    const { INDEX_REFRESH_MS, loadMarketIndexQuotes } = await import('./marketIndexQuotes')
    provider.quotes.mockResolvedValueOnce(new Map([
      ['^NSEI', quote()], ['^NSEBANK', { ...quote(), change: NaN, pct: Infinity }],
      ['^GSPC', quote()], ['PRIVATE.NS', quote()],
    ]))
    const first = await loadMarketIndexQuotes()
    expect(Object.keys(first.quotes)).toEqual(['^NSEBANK', '^NSEI'])
    expect(first.quotes['^NSEBANK']).toMatchObject({ change: null, pct: null })
    vi.advanceTimersByTime(INDEX_REFRESH_MS)
    provider.quotes.mockResolvedValueOnce(new Map([['^NSEI', quote(20_000, now - 1_000)]]))
    const next = await loadMarketIndexQuotes()
    expect(next.quotes['^NSEI']).toEqual(quote())
    expect(next.unavailable).toContain('^NSEI')
  })

  it.each([
    quote(-1), quote(NaN), quote(100, now + 600_000), quote(100, 0), quote(100, NaN),
  ])('rejects invalid or future observations without losing the other index', async (invalid) => {
    const { loadMarketIndexQuotes } = await import('./marketIndexQuotes')
    provider.quotes.mockResolvedValueOnce(new Map([['^NSEI', quote()], ['^NSEBANK', invalid]]))
    const result = await loadMarketIndexQuotes()
    expect(Object.keys(result.quotes)).toEqual(['^NSEI'])
    expect(result.unavailable).toEqual(['^NSEBANK'])
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
