import { describe, expect, it, vi } from 'vitest'
import { createHistoryHandler } from '../api/history'

describe('GET /api/history', () => {
  it.each(['RELIANCE.NS', 'M&M.NS'])('normalizes valid daily closes for %s', async (symbol) => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        chart: {
          result: [
            {
              timestamp: [1787000000, 1787086400, 1787172800],
              indicators: { quote: [{ close: [100, null, 105.5] }] },
            },
          ],
        },
      }),
    )
    const handler = createHistoryHandler({ fetcher })

    const response = await handler(
      new Request(
        `http://localhost/api/history?symbol=${encodeURIComponent(symbol)}&from=2026-08-01&to=2026-08-25`,
      ),
    )

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('interval=1d')
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe(`/v8/finance/chart/${encodeURIComponent(symbol)}`)
    await expect(response.json()).resolves.toEqual({
      symbol,
      points: [
        { date: '2026-08-17', close: 100 },
        { date: '2026-08-19', close: 105.5 },
      ],
    })
  })

  it('rejects invalid dates and reversed ranges without fetching', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const handler = createHistoryHandler({ fetcher })

    const invalidDate = await handler(
      new Request('http://localhost/api/history?symbol=RELIANCE.NS&from=August&to=2026-08-25'),
    )
    const reversed = await handler(
      new Request('http://localhost/api/history?symbol=RELIANCE.NS&from=2026-08-25&to=2026-08-01'),
    )

    expect(invalidDate.status).toBe(400)
    expect(reversed.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('recovers an official symbol change while retaining the requested identity', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes('/OLD.NS?')) return new Response('', { status: 404 })
      if (url.includes('/NEW.NS?')) return Response.json({ chart: { result: [{ timestamp: [1787000000, 1787172800], indicators: { quote: [{ close: [100, 105.5] }] } }] } })
      if (url.includes('symbolchange.csv')) return new Response('NAME OF THE COMPANY,OLD SYMBOL,NEW SYMBOL,EFFECTIVE DATE\nCompany,OLD,NEW,01-JUL-2026\n')
      if (url.includes('SME_EQUITY_L.csv')) return new Response('SYMBOL,SERIES,ISIN_NUMBER\nSME,SM,INE002A01010\n')
      return new Response('SYMBOL,SERIES,ISIN NUMBER\nNEW,EQ,INE001A01010\n')
    })
    const response = await createHistoryHandler({ fetcher })(new Request('http://localhost/api/history?symbol=OLD.NS&from=2026-08-01&to=2026-08-25'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ symbol: 'OLD.NS', resolvedSymbol: 'NEW.NS', points: [{ close: 100 }, { close: 105.5 }] })
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it.each([
    { symbol: 'NEW.NS', now: '2026-11-07T06:00:00Z', report: '06-Nov-2026', expected: true },
    { symbol: 'OLD.NS', now: '2026-11-07T06:00:00Z', report: '06-Nov-2026', expected: true },
    { symbol: 'NEW.NS', now: '2026-11-07T06:00:00Z', report: '05-Nov-2026', expected: false },
    { symbol: 'NEW.NS', now: '2026-11-06T06:00:00Z', report: '06-Nov-2026', expected: false },
  ])('only appends a verified completed-session close for $symbol at $now from $report', async ({ symbol, now, report, expected }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
    const points = [Date.parse('2026-11-02T10:00:00Z') / 1000, Date.parse('2026-11-05T10:00:00Z') / 1000]
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes('/OLD.NS?')) return new Response('', { status: 404 })
      if (url.includes('/NEW.NS?')) return Response.json({ chart: { result: [{ timestamp: points, indicators: { quote: [{ close: [100, 105] }] } }] } })
      if (url.includes('sec_bhavdata_full_')) return new Response(`SYMBOL,SERIES,DATE1,PREV_CLOSE,CLOSE_PRICE\nNEW,EQ,${report},105,107\n`)
      if (url.includes('symbolchange.csv')) return new Response('NAME OF THE COMPANY,OLD SYMBOL,NEW SYMBOL,EFFECTIVE DATE\nCompany,OLD,NEW,01-JUL-2026\n')
      if (url.includes('SME_EQUITY_L.csv')) return new Response('SYMBOL,SERIES,ISIN_NUMBER\nSME,SM,INE002A01010\n')
      return new Response('SYMBOL,SERIES,ISIN NUMBER\nNEW,EQ,INE001A01010\n')
    })
    try {
      const response = await createHistoryHandler({ fetcher })(new Request(`http://localhost/api/history?symbol=${symbol}&from=2026-11-02&to=2026-11-06`))
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.points).toHaveLength(expected ? 3 : 2)
      expect(body.points.slice(0, 2)).toEqual([{ date: '2026-11-02', close: 100 }, { date: '2026-11-05', close: 105 }])
      if (expected) {
        expect(body.points[2]).toEqual({ date: '2026-11-06', close: 107 })
        expect(body.supplementalClose).toEqual({ date: '2026-11-06', source: 'nse-close' })
      } else expect(body.supplementalClose).toBeUndefined()
    } finally { vi.useRealTimers() }
  })
})
