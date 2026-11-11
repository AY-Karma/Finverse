import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQuoteHandler } from '../api/quotes'

const NOW = Date.parse('2026-08-25T06:00:00Z')
const state = vi.hoisted(() => ({ resolveSymbol: vi.fn<(symbol: string) => Promise<string | null>>() }))
vi.mock('../api/nseSymbolChanges', () => ({ createNseSymbolResolver: () => state.resolveSymbol }))

beforeEach(() => { state.resolveSymbol.mockReset().mockResolvedValue(null) })

function yahooResponse(symbol = 'RELIANCE.NS', price = 1309.8, marketTime = 1787564702) {
  return Response.json({
    spark: {
      result: [
        {
          symbol,
          response: [
            {
              meta: {
                regularMarketPrice: price,
                chartPreviousClose: 1316,
                regularMarketTime: marketTime,
              },
            },
          ],
        },
      ],
      error: null,
    },
  })
}

function yahooBatchResponse(symbols: string[]) {
  return Response.json({ spark: { result: symbols.map((symbol) => ({ symbol, response: [{ meta: {
    regularMarketPrice: 100, chartPreviousClose: 99, regularMarketTime: 1787564702,
  } }] })) } })
}

describe('GET /api/quotes', () => {
  it.each([1e20, NOW / 1000 + 3600])('isolates a provider timestamp anomaly (%s) without losing healthy batch members', async (invalidTime) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ spark: { result: [
      { symbol: 'AAPL', response: [{ meta: { regularMarketPrice: 100, chartPreviousClose: 99, regularMarketTime: invalidTime } }] },
      { symbol: 'MSFT', response: [{ meta: { regularMarketPrice: 200, chartPreviousClose: 198, regularMarketTime: NOW / 1000 } }] },
    ] } }))
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request('http://localhost/api/quotes?symbols=AAPL,MSFT'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.quotes).toEqual([expect.objectContaining({ symbol: 'MSFT', price: 200, marketTime: new Date(NOW).toISOString() })])
    expect(body.errors).toEqual([{ symbol: 'AAPL', message: 'No quote returned by the provider.' }])
  })

  it.each([21, 25])('splits %i public quote symbols into Yahoo requests of at most twenty', async (count) => {
    const symbols = Array.from({ length: count }, (_, index) => `S${String(index).padStart(2, '0')}.NS`)
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      expect(url.pathname).toContain('/finance/spark')
      return yahooBatchResponse(url.searchParams.get('symbols')!.split(','))
    })
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request(`http://localhost/api/quotes?${new URLSearchParams({ symbols: symbols.join(',') })}`))
    const body = await response.json()
    const chunks = fetcher.mock.calls.map(([input]) => new URL(String(input)).searchParams.get('symbols')!.split(','))
    expect(chunks.map((chunk) => chunk.length)).toEqual([20, count - 20])
    expect(chunks.flat()).toEqual(symbols)
    expect(body.quotes).toHaveLength(count)
    expect(body.quotes.every((quote: { source: string }) => quote.source === 'yahoo')).toBe(true)
    expect(body.errors).toEqual([])
    expect(state.resolveSymbol).not.toHaveBeenCalled()
  })

  it('returns healthy chunks promptly and recovers a separately targeted missing chunk through NSE', async () => {
    const symbols = Array.from({ length: 25 }, (_, index) => `S${String(index).padStart(2, '0')}.NS`)
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.includes('/finance/spark')) {
        const chunk = url.searchParams.get('symbols')!.split(',')
        return chunk.includes('S20.NS') ? new Response('', { status: 503 }) : yahooBatchResponse(chunk)
      }
      return new Response('SYMBOL,SERIES,DATE1,PREV_CLOSE,CLOSE_PRICE\n' + symbols.map((symbol) => `${symbol.slice(0, -3)},EQ,24-Aug-2026,190,200`).join('\n'))
    })
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request(`http://localhost/api/quotes?${new URLSearchParams({ symbols: symbols.join(',') })}`))
    const body = await response.json()
    expect(body.provider).toBe('yahoo-unofficial')
    expect(body.quotes).toHaveLength(20)
    expect(body.quotes.slice(0, 20).every((quote: { source: string; price: number }) => quote.source === 'yahoo' && quote.price === 100)).toBe(true)
    expect(body.errors.map((error: { symbol: string }) => error.symbol)).toEqual(symbols.slice(20))
    expect(state.resolveSymbol).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(2)
    const recovered = await handler(new Request(`http://localhost/api/quotes?${new URLSearchParams({ symbols: symbols.slice(20).join(',') })}`))
    const recoveredBody = await recovered.json()
    expect(recoveredBody.quotes).toHaveLength(5)
    expect(recoveredBody.quotes.every((quote: { source: string; price: number }) => quote.source === 'nse-close' && quote.price === 200)).toBe(true)
    expect(state.resolveSymbol.mock.calls.map(([symbol]) => symbol)).toEqual(symbols.slice(20))
    expect(recoveredBody.errors).toEqual([])
  })

  it('keeps both Yahoo chunk errors when neither chunk nor NSE can provide quotes', async () => {
    const symbols = Array.from({ length: 25 }, (_, index) => `S${String(index).padStart(2, '0')}.NS`)
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (!url.pathname.includes('/finance/spark')) return new Response('', { status: 404 })
      return new Response('', { status: url.searchParams.get('symbols')!.includes('S20.NS') ? 503 : 429 })
    })
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request(`http://localhost/api/quotes?${new URLSearchParams({ symbols: symbols.join(',') })}`))
    const body = await response.json()
    expect(response.status).toBe(502)
    expect(body.quotes).toEqual([])
    expect(body.errors).toHaveLength(25)
    expect(body.errors[0].message).toContain('HTTP 429')
    expect(body.errors[0].message).toContain('HTTP 503')
  })

  it('reuses a recent batch but fetches a new provider response after one second', async () => {
    let now = NOW
    const fetcher = vi.fn<typeof fetch>(async () => yahooResponse())
    const handler = createQuoteHandler({ fetcher, now: () => now })
    const request = () => handler(new Request('http://localhost/api/quotes?symbols=RELIANCE.NS'))
    await request()
    now += 999
    await request()
    expect(fetcher).toHaveBeenCalledTimes(1)
    now += 1
    await request()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('returns normalized quotes with the provider market timestamp', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => yahooResponse())
    const handler = createQuoteHandler({ fetcher, now: () => NOW })

    const response = await handler(
      new Request('http://localhost/api/quotes?symbols=RELIANCE.NS'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=1, must-revalidate')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('symbols=RELIANCE.NS')
    expect(state.resolveSymbol).not.toHaveBeenCalled()
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
      errors: [],
    })
  })

  it('does not hold a healthy batch member behind unrelated NSE fallback work', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('/finance/spark') ? yahooResponse() : new Response(
      'SYMBOL,SERIES,DATE1,PREV_CLOSE,CLOSE_PRICE\nRELIANCE,EQ,24-Aug-2026,1300,1200\nTCS,EQ,24-Aug-2026,3900,4000\n',
    ))
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request('http://localhost/api/quotes?symbols=TCS.NS,RELIANCE.NS'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.provider).toBe('yahoo-unofficial')
    expect(body.quotes).toEqual([
      expect.objectContaining({ symbol: 'RELIANCE.NS', price: 1309.8, source: 'yahoo' }),
    ])
    expect(body.errors).toEqual([{ symbol: 'TCS.NS', message: 'No quote returned by the provider.' }])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(state.resolveSymbol).not.toHaveBeenCalled()
  })

  it('replaces a frozen NSE quote with a current official close', async () => {
    const oldTime = Date.parse('2026-07-16T10:00:00Z') / 1000
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('/finance/spark') ? yahooResponse('RELIANCE.NS', 1200, oldTime) : new Response(
      'SYMBOL,SERIES,DATE1,PREV_CLOSE,CLOSE_PRICE\nRELIANCE,EQ,24-Aug-2026,1300,1320\n',
    ))
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request('http://localhost/api/quotes?symbols=RELIANCE.NS'))
    const body = await response.json()
    expect(body.quotes).toEqual([expect.objectContaining({ symbol: 'RELIANCE.NS', price: 1320, marketTime: '2026-08-24T10:00:00.000Z', source: 'nse-close' })])
    expect(body.errors).toEqual([])
  })

  it('resolves an officially renamed symbol even when Yahoo still returns its frozen old quote', async () => {
    state.resolveSymbol.mockImplementation(async (symbol) => symbol === 'TATAMOTORS.NS' ? 'TMPV.NS' : null)
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.includes('/finance/spark')) return url.searchParams.get('symbols') === 'TMPV.NS'
        ? yahooResponse('TMPV.NS', 350) : yahooResponse('TATAMOTORS.NS', 900, Date.parse('2026-07-16T10:00:00Z') / 1000)
      return new Response('SYMBOL,SERIES,DATE1,PREV_CLOSE,CLOSE_PRICE\nTMPV,EQ,24-Aug-2026,340,350\n')
    })
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request('http://localhost/api/quotes?symbols=TATAMOTORS.NS'))
    const body = await response.json()
    expect(body.quotes).toEqual([expect.objectContaining({ symbol: 'TATAMOTORS.NS', resolvedSymbol: 'TMPV.NS', price: 350, source: 'yahoo' })])
    expect(body.errors).toEqual([])
  })

  it('withholds frozen NSE quotes when neither source provides the last completed session', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('/finance/spark')
      ? yahooResponse('SUSPENDED.NS', 1200, Date.parse('2026-07-16T10:00:00Z') / 1000)
      : new Response('SYMBOL,SERIES,DATE1,PREV_CLOSE,CLOSE_PRICE\nSUSPENDED,EQ,16-Jul-2026,1300,1320\n'))
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request('http://localhost/api/quotes?symbols=SUSPENDED.NS'))
    const body = await response.json()
    expect(response.status).toBe(502)
    expect(body.quotes).toEqual([])
    expect(body.errors).toEqual([{ symbol: 'SUSPENDED.NS', message: 'The provider quote is older than the last completed NSE session (2026-08-24).' }])
  })

  it.each(['2026-08-24T10:00:00Z', '2026-08-25T04:30:00Z'])('accepts an NSE quote from the completed session or current intraday date: %s', async (at) => {
    const fetcher = vi.fn<typeof fetch>(async () => yahooResponse('RELIANCE.NS', 1320, Date.parse(at) / 1000))
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request('http://localhost/api/quotes?symbols=RELIANCE.NS'))
    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(state.resolveSymbol).not.toHaveBeenCalled()
    expect((await response.json()).quotes).toEqual([expect.objectContaining({ symbol: 'RELIANCE.NS', price: 1320, source: 'yahoo' })])
  })

  it('does not infer quote staleness when the exchange calendar is unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => yahooResponse())
    const handler = createQuoteHandler({ fetcher, now: () => Date.parse('2027-01-05T06:00:00Z') })
    const response = await handler(new Request('http://localhost/api/quotes?symbols=RELIANCE.NS'))
    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(state.resolveSymbol).not.toHaveBeenCalled()
    expect((await response.json()).quotes).toEqual([expect.objectContaining({ symbol: 'RELIANCE.NS', source: 'yahoo' })])
  })

  it.each(['yahoo', 'nse-close'])('recovers a verified NSE rename through %s while preserving the requested symbol', async (source) => {
    state.resolveSymbol.mockImplementation(async (symbol) => symbol === 'TATAMOTORS.NS' ? 'TMPV.NS' : null)
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.includes('/finance/spark')) {
        if (url.searchParams.get('symbols') === 'TMPV.NS') return source === 'yahoo' ? yahooResponse('TMPV.NS', 350) : new Response('', { status: 404 })
        return yahooResponse()
      }
      return new Response('SYMBOL,SERIES,DATE1,PREV_CLOSE,CLOSE_PRICE\nTMPV,EQ,24-Aug-2026,340,350\n')
    })
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request('http://localhost/api/quotes?symbols=TATAMOTORS.NS'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.quotes).toEqual([
      expect.objectContaining({ symbol: 'TATAMOTORS.NS', resolvedSymbol: 'TMPV.NS', price: 350, source }),
    ])
    expect(body.errors).toEqual([])
  })

  it('retains healthy quotes when missing-symbol recovery cannot reach its reference', async () => {
    state.resolveSymbol.mockRejectedValue(new Error('Reference unavailable'))
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('/finance/spark') ? yahooResponse() : new Response('', { status: 404 }))
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request('http://localhost/api/quotes?symbols=UNKNOWN.NS,RELIANCE.NS'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.quotes).toEqual([expect.objectContaining({ symbol: 'RELIANCE.NS', price: 1309.8, source: 'yahoo' })])
    expect(body.errors).toEqual([{ symbol: 'UNKNOWN.NS', message: 'No quote returned by the provider.' }])
  })

  it('returns healthy quotes without starting stalled recovery or waiting for a recovery deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    state.resolveSymbol.mockReturnValue(new Promise(() => {}))
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('/finance/spark') ? yahooResponse() : new Response(
      'SYMBOL,SERIES,DATE1,PREV_CLOSE,CLOSE_PRICE\nRELIANCE,EQ,24-Aug-2026,1300,1200\n',
    ))
    try {
      const handler = createQuoteHandler({ fetcher, now: () => NOW })
      let response: Response | undefined
      const pending = handler(new Request('http://localhost/api/quotes?symbols=UNKNOWN.NS,RELIANCE.NS')).then((value) => { response = value; return value })
      await vi.advanceTimersByTimeAsync(0)
      expect(response).toBeDefined()
      expect(state.resolveSymbol).not.toHaveBeenCalled()
      expect(fetcher).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(8_000)
      await pending
      if (!response) throw new Error('Healthy quote response was not delivered.')
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.quotes).toEqual([expect.objectContaining({ symbol: 'RELIANCE.NS', source: 'yahoo' })])
      expect(body.errors).toEqual([{ symbol: 'UNKNOWN.NS', message: 'No quote returned by the provider.' }])
    } finally { vi.useRealTimers() }
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

  it('bounds stalled recovery when no live batch member is usable', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    state.resolveSymbol.mockReturnValue(new Promise(() => {}))
    const fetcher = vi.fn<typeof fetch>(async (input) => new Response('', { status: String(input).includes('/finance/spark') ? 503 : 404 }))
    try {
      const handler = createQuoteHandler({ fetcher, now: () => NOW })
      let response: Response | undefined
      const pending = handler(new Request('http://localhost/api/quotes?symbols=UNKNOWN.NS')).then((value) => { response = value; return value })
      await vi.advanceTimersByTimeAsync(7_999)
      expect(response).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      await pending
      if (!response) throw new Error('The bounded recovery did not return.')
      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({ quotes: [], errors: [{ symbol: 'UNKNOWN.NS', message: 'Quote provider returned HTTP 503.' }] })
      expect(state.resolveSymbol).toHaveBeenCalledExactlyOnceWith('UNKNOWN.NS')
    } finally { vi.useRealTimers() }
  })

  it('rejects delayed BSE-only quote requests before calling any provider', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request('http://localhost/api/quotes?symbols=500325.BO'))
    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
    expect(state.resolveSymbol).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({ error: 'Delayed BSE quotes are disabled. Use a verified NSE pricing mapping.' })
  })

  it('returns valid NSE quotes while excluding delayed BSE members from the upstream batch', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => yahooResponse())
    const handler = createQuoteHandler({ fetcher, now: () => NOW })
    const response = await handler(new Request('http://localhost/api/quotes?symbols=500325.BO,RELIANCE.NS'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('symbols')).toBe('RELIANCE.NS')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(body.quotes).toEqual([expect.objectContaining({ symbol: 'RELIANCE.NS', source: 'yahoo' })])
    expect(body.errors).toEqual([{ symbol: '500325.BO', message: 'Delayed BSE quotes are disabled. Use a verified NSE pricing mapping.' }])
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
