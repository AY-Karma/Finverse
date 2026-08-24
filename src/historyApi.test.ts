import { describe, expect, it, vi } from 'vitest'
import { createHistoryHandler } from '../api/history'

describe('GET /api/history', () => {
  it('normalizes valid daily closes', async () => {
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
        'http://localhost/api/history?symbol=RELIANCE.NS&from=2026-08-01&to=2026-08-25',
      ),
    )

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('interval=1d')
    await expect(response.json()).resolves.toEqual({
      symbol: 'RELIANCE.NS',
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
})
