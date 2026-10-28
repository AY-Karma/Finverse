import { describe, expect, it, vi } from 'vitest'
import { createMarketEventsLoader } from './marketEvents'
import type { MarketEventPayload } from './marketEventsProtocol'
import type { Position } from './types'

const NOW = Date.parse('2026-10-27T12:00:00Z')
const position: Position = { id: 'infy', ticker: 'INFY', name: 'Infosys', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100, exchange: 'NSE', exchangeSource: 'explicit', currency: 'INR', providerSymbol: 'INFY.NS', isin: 'INE009A01021' }
const event: MarketEventPayload = { id: 'meeting:INFY', symbol: 'INFY', title: 'Financial Results', kind: 'results', date: '2026-10-28', dateLabel: 'Meeting date', source: 'NSE', sourceUrl: 'https://www.nseindia.com/companies-listing/corporate-filings-board-meetings' }
const response = (events: unknown[] = [event], issues: unknown[] = []) => Response.json({ events, issues, fetchedAt: NOW })

describe('company event loading', () => {
  it('distinguishes routine coverage notes from unavailable source data', async () => {
    const fund: Position = { id: 'fund', ticker: 'FUND', name: 'Fund', type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }
    const complete = await createMarketEventsLoader(vi.fn(async () => response([])), () => NOW)([position, fund])
    expect(complete.events).toEqual([])
    expect(complete.issues.some((issue) => issue.source === 'Company events')).toBe(true)
    expect(complete.sourceFailed).toBe(false)
    const failed = await createMarketEventsLoader(vi.fn(async () => response([], [{ source: 'NSE filings', message: 'Unavailable' }])), () => NOW)([position, fund])
    expect(failed.sourceFailed).toBe(true)
  })

  it('runs at most three symbol batches together and starts queued batches as slots open', async () => {
    const pending: (() => void)[] = []
    const fetcher = vi.fn<typeof fetch>(() => new Promise((resolve) => { pending.push(() => resolve(response([]))) }))
    const positions = Array.from({ length: 76 }, (_, index) => ({ ...position, id: `holding-${index}`, ticker: `STOCK${index}`, providerSymbol: `STOCK${index}.NS`, isin: undefined }))
    const loading = createMarketEventsLoader(fetcher, () => NOW)(positions)
    expect(fetcher).toHaveBeenCalledTimes(3)
    pending[1]()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4))
    for (const resolve of pending) resolve()
    expect((await loading).issues).toEqual([])
  })

  it('bypasses cached results only for an explicit refresh', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response())
    const load = createMarketEventsLoader(fetcher, () => NOW)
    await load([position])
    fetcher.mockImplementation(async () => response([{ ...event, id: 'new-event' }]))
    expect((await load([position])).events[0].id).toBe(event.id)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((await load([position], { forceRefresh: true })).events[0].id).toBe('new-event')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect((await load([position])).events[0].id).toBe('new-event')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('cancels active batches and does not start queued batches after abort', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true })
    }))
    const positions = Array.from({ length: 76 }, (_, index) => ({ ...position, id: `holding-${index}`, ticker: `STOCK${index}`, providerSymbol: `STOCK${index}.NS`, isin: undefined }))
    const loading = createMarketEventsLoader(fetcher, () => NOW)(positions, { signal: controller.signal })
    const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls.every(([, options]) => options!.signal!.aborted)).toBe(true)
  })

  it('names excluded holdings and distinguishes unsupported funds from identity mismatches', async () => {
    const fund: Position = { ...position, id: 'fund', name: 'Example Direct Growth Fund', type: 'mutual-fund', exchange: undefined, exchangeSource: undefined, providerSymbol: undefined, isin: undefined }
    const load = createMarketEventsLoader(vi.fn(async () => response([{ ...event, isin: 'INE000A01010' }])), () => NOW)
    const feed = await load([position, fund])
    expect(feed.events).toEqual([])
    const messages = feed.issues.map(issue => issue.message).join(' ')
    expect(messages).toContain(fund.name)
    expect(messages).toContain(position.name)
    expect(messages).toMatch(/mutual fund/i)
    expect(messages).toMatch(/ISIN/i)
  })

  it('uses the verified current equity ISIN for issuer filings with historical source metadata', async () => {
    const filing: MarketEventPayload = { ...event, kind: 'filing', dateLabel: 'Published', publishedAt: NOW, isin: 'INE000A01010', issuerIsin: position.isin, sourceUrl: 'https://nsearchives.nseindia.com/corporate/INFY.pdf' }
    const feed = await createMarketEventsLoader(vi.fn(async () => response([filing])), () => NOW)([position])
    expect(feed.events).toHaveLength(1)
    expect(feed.events[0]).toMatchObject({ holdingId: position.id, isin: filing.isin, issuerIsin: position.isin })
    expect(feed.issues).toEqual([])
  })

  it('does not use issuer identity to bypass security-specific event matching', async () => {
    const action = { ...event, kind: 'dividend', dateLabel: 'Ex-date', isin: 'INE000A01010', issuerIsin: position.isin }
    const feed = await createMarketEventsLoader(vi.fn(async () => response([action])), () => NOW)([position])
    expect(feed.events).toEqual([])
    expect(feed.issues).not.toEqual([])
  })

  it('attaches a verified NSE holding identity and caches a response', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response())
    const load = createMarketEventsLoader(fetcher, () => NOW)
    const feed = await load([position])
    expect(feed.events).toEqual([expect.objectContaining({ holdingId: 'infy', holdingName: 'Infosys', instrumentIdentity: expect.stringContaining('INFY') })])
    expect(feed.issues).toEqual([])
    await load([position])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/api/events?symbols=INFY')
  })

  it('does not request unsupported venues, inferred listings, funds or conflicting mappings', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const feed = await createMarketEventsLoader(fetcher, () => NOW)([
      { ...position, exchange: 'BSE', providerSymbol: 'INFY.BO' }, { ...position, exchangeSource: 'inferred' },
      { ...position, type: 'mutual-fund' }, { ...position, providerSymbol: 'OTHER.NS' },
    ])
    expect(fetcher).not.toHaveBeenCalled()
    expect(feed.issues.map(issue => issue.message).join(' ')).toMatch(/BSE|NSE listing|Mutual fund/)
  })

  it('rejects a contradictory ISIN and does not guess between conflicting same-symbol listings', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response([{ ...event, isin: 'INE000A01010' }]))
    const mismatch = await createMarketEventsLoader(fetcher, () => NOW)([position])
    expect(mismatch.events).toEqual([])
    expect(mismatch.issues.some(issue => issue.message.includes('ISIN mismatch') && issue.message.includes(position.name))).toBe(true)
    fetcher.mockImplementation(async () => response())
    const ambiguous = await createMarketEventsLoader(fetcher, () => NOW)([position, { ...position, id: 'conflict', isin: 'INE000A01010' }])
    expect(ambiguous.events).toEqual([])
  })

  it('only matches an ambiguous symbol when the source ISIN identifies one listing', async () => {
    const load = createMarketEventsLoader(vi.fn(async () => response([{ ...event, isin: position.isin }])), () => NOW)
    const feed = await load([position, { ...position, id: 'conflict', isin: 'INE000A01010' }])
    expect(feed.events.map(row => row.holdingId)).toEqual(['infy'])
  })

  it('filters invalid dates, unsafe source links and unrelated server symbols', async () => {
    const load = createMarketEventsLoader(vi.fn(async () => response([
      { ...event, date: '2026-02-31' }, { ...event, sourceUrl: 'javascript:alert(1)' }, { ...event, symbol: 'OTHER' },
    ])), () => NOW)
    const feed = await load([position])
    expect(feed.events).toEqual([])
    expect(feed.issues[0].message).toContain('omitted')
  })

  it('preserves partial-source issues and explains network failures', async () => {
    const partial = await createMarketEventsLoader(vi.fn(async () => response([event], [{ source: 'NSE filings', message: 'Unavailable' }])), () => NOW)([position])
    expect(partial.events).toHaveLength(1)
    expect(partial.issues).toHaveLength(1)
    const failed = await createMarketEventsLoader(vi.fn(async () => { throw new Error('Offline') }), () => NOW)([position])
    expect(failed.events).toEqual([])
    expect(failed.fetchedAt).toBe(0)
    expect(failed.issues[0].message).toContain('unavailable')
  })

  it('does not swallow caller cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn<typeof fetch>()
    await expect(createMarketEventsLoader(fetcher, () => NOW)([position], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('splits larger portfolios into bounded symbol requests', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response([]))
    const positions = Array.from({ length: 26 }, (_, index) => ({ ...position, id: `holding-${index}`, ticker: `STOCK${index}`, providerSymbol: `STOCK${index}.NS`, isin: undefined }))
    await createMarketEventsLoader(fetcher, () => NOW)(positions)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(new URL(fetcher.mock.calls[0][0].toString(), 'http://localhost').searchParams.get('symbols')?.split(',')).toHaveLength(25)
  })
})
