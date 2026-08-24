import { describe, expect, it, vi } from 'vitest'
import { createQuoteHandler } from '../api/quotes'

const NOW = Date.parse('2026-08-25T06:00:00Z')

function yahooResponse() {
  return Response.json({
    spark: {
      result: [
        {
          symbol: 'RELIANCE.NS',
          response: [
            {
              meta: {
                regularMarketPrice: 1309.8,
                chartPreviousClose: 1316,
                regularMarketTime: 1787564702,
              },
            },
          ],
        },
      ],
      error: null,
    },
  })
}

describe('GET /api/quotes', () => {
  it('returns normalized quotes with the provider market timestamp', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => yahooResponse())
    const handler = createQuoteHandler({ fetcher, now: () => NOW })

    const response = await handler(
      new Request('http://localhost/api/quotes?symbols=TCS.NS,RELIANCE.NS'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vercel-cdn-cache-control')).toContain('s-maxage=60')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('symbols=RELIANCE.NS%2CTCS.NS')
    await expect(response.json()).resolves.toEqual({
      provider: 'yahoo-unofficial',
      fetchedAt: new Date(NOW).toISOString(),
      quotes: [
        {
          symbol: 'RELIANCE.NS',
          price: 1309.8,
          previousClose: 1316,
          change: -6.2,
          changePct: expect.closeTo(-0.4711246201),
          marketTime: new Date(1787564702 * 1000).toISOString(),
          source: 'yahoo',
        },
      ],
      errors: [{ symbol: 'TCS.NS', message: 'No quote returned by the provider.' }],
    })
  })

  it('uses the official NSE close when Yahoo is unavailable', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          'SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE\n' +
            'RELIANCE, EQ, 24-Aug-2026, 1316.00, 1310.00, 1320.00, 1302.40, 1309.80, 1309.80\n',
          { status: 200, headers: { 'content-type': 'text/csv' } },
        ),
      )
    const handler = createQuoteHandler({ fetcher, now: () => NOW })

    const response = await handler(
      new Request('http://localhost/api/quotes?symbols=RELIANCE.NS'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.quotes).toEqual([
      {
        symbol: 'RELIANCE.NS',
        price: 1309.8,
        previousClose: 1316,
        change: -6.2,
        changePct: expect.closeTo(-0.4711246201),
        marketTime: '2026-08-24T10:00:00.000Z',
        source: 'nse-close',
      },
    ])
  })

  it('rejects malformed symbols before making an upstream request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const handler = createQuoteHandler({ fetcher, now: () => NOW })

    const response = await handler(
      new Request('http://localhost/api/quotes?symbols=https%3A%2F%2Fexample.com'),
    )

    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: 'Symbols must use a supported market symbol format.',
    })
  })

  it('rejects portfolios larger than the endpoint limit', async () => {
    const symbols = Array.from({ length: 26 }, (_, index) => `S${index}.NS`).join(',')
    const handler = createQuoteHandler({ fetcher: vi.fn<typeof fetch>(), now: () => NOW })

    const response = await handler(
      new Request(`http://localhost/api/quotes?symbols=${symbols}`),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Request at most 25 symbols.',
    })
  })
})
