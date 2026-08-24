import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveQuote, Position } from './types'
import {
  fetchLiveQuotes,
  fetchUsdInrRate,
  fetchYahooPrice,
  isMarketOpen,
  marketStatusText,
  quoteRefreshIssueText,
} from './live'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('market status text', () => {
  it('describes the initial fetch while the market is open', () => {
    expect(marketStatusText(true, true, true, true)).toBe('Market open - fetching latest available data')
  })

  it('describes the initial fetch outside market hours', () => {
    expect(marketStatusText(false, true, true, true)).toBe('Market closed - fetching latest available data')
  })

  it('keeps the fetch message visible while USD conversion is still loading', () => {
    expect(marketStatusText(true, true, false, true)).toBe('Market open - fetching latest available data')
  })

  it('continues polling on weekdays when a future holiday calendar is unavailable', () => {
    expect(isMarketOpen(new Date('2027-01-04T04:00:00.000Z'))).toBe(true)
  })

  it('reports partial quote retention without treating skipped daily NAVs as failures', () => {
    expect(quoteRefreshIssueText({ quotes: {}, updated: 7, failed: 1, skipped: 2 }))
      .toBe('1 quote retained from previous or imported values.')
    expect(quoteRefreshIssueText({ quotes: {}, updated: 0, failed: 0, skipped: 2 })).toBeNull()
  })
})

describe('market data client', () => {
  it('uses the same-origin quote endpoint and preserves the market timestamp', async () => {
    const marketTime = '2026-08-24T09:45:02.000Z'
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        provider: 'yahoo-unofficial',
        fetchedAt: '2026-08-25T06:00:00.000Z',
        quotes: [
          {
            symbol: 'RELIANCE.NS',
            price: 1309.8,
            previousClose: 1316,
            change: -6.2,
            changePct: -0.47,
            marketTime,
            source: 'yahoo',
          },
        ],
        errors: [],
      }),
    )
    vi.stubGlobal('fetch', fetcher)

    await expect(fetchYahooPrice('RELIANCE.NS')).resolves.toEqual({
      price: 1309.8,
      change: -6.2,
      pct: -0.47,
      at: Date.parse(marketTime),
      fetchedAt: Date.parse('2026-08-25T06:00:00.000Z'),
      source: 'yahoo',
    })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/quotes?symbols=RELIANCE.NS',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('uses the Frankfurter publication date instead of the HTTP request time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ date: '2026-08-24', rates: { INR: 87.42 } }),
    ))

    await expect(fetchUsdInrRate()).resolves.toEqual({
      usdInr: 87.42,
      at: Date.parse('2026-08-24T00:00:00Z'),
    })
  })

  it('batches equity holdings and retains a failed holding without hiding the partial failure', async () => {
    const positions: Position[] = [
      position('RELIANCE'),
      position('TCS'),
    ]
    const previous: Record<string, LiveQuote> = {
      'EQ:TCS': { price: 2200, at: 1, source: 'yahoo' },
    }
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        provider: 'yahoo-unofficial',
        fetchedAt: '2026-08-25T06:00:00.000Z',
        quotes: [
          {
            symbol: 'RELIANCE.NS',
            price: 1309.8,
            previousClose: 1316,
            change: -6.2,
            changePct: -0.47,
            marketTime: '2026-08-24T09:45:02.000Z',
            source: 'yahoo',
          },
        ],
        errors: [{ symbol: 'TCS.NS', message: 'No quote returned by the provider.' }],
      }),
    )
    vi.stubGlobal('fetch', fetcher)

    const result = await fetchLiveQuotes(positions, previous)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('RELIANCE.NS%2CTCS.NS')
    expect(result).toMatchObject({ updated: 1, failed: 1, skipped: 0 })
    expect(result.quotes['EQ:TCS']).toEqual(previous['EQ:TCS'])
    expect(result.quotes['EQ:RELIANCE']).toMatchObject({
      price: 1309.8,
      at: Date.parse('2026-08-24T09:45:02.000Z'),
    })
  })
})

function position(ticker: string): Position {
  return {
    id: ticker,
    ticker,
    name: ticker,
    type: 'stock',
    quantity: 1,
    buyPrice: 1,
    lastPrice: 1,
    invested: 1,
    exchange: 'NSE',
  }
}
