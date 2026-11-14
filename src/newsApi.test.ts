import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNewsHandler } from '../api/news'

const STORY = '<rss><channel><item><title>Reliance rises</title><link>https://example.com/story</link></item></channel></rss>'

afterEach(() => vi.useRealTimers())

describe('news API', () => {
  it('requires revalidation after its five-minute edge cache instead of serving ten more stale minutes', async () => {
    const response = await createNewsHandler({ fetcher: vi.fn(async () => new Response(STORY)) })(new Request('http://localhost/api/news?source=wire-et'))
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe('public, s-maxage=300, must-revalidate')
  })
  it('hedges a slow company provider after 500ms and cancels the losing request', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>((url, options) => {
      if (url.toString().includes('bing.com')) return Promise.resolve(new Response(STORY))
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
      })
    })
    const pending = createNewsHandler({ fetcher })(new Request('http://localhost/api/news?source=search&q=RELIANCE'))

    await vi.advanceTimersByTimeAsync(499)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect((await pending).status).toBe(200)
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('keeps fast primary results without sending a fallback request', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>(async () => new Response(STORY))
    const response = await createNewsHandler({ fetcher })(new Request('http://localhost/api/news?source=search&q=RELIANCE'))

    await vi.advanceTimersByTimeAsync(500)
    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(['failed', 'pending'])('keeps the primary alive with a %s fallback and cancels fallback when primary wins', async (fallback) => {
    vi.useFakeTimers()
    let releasePrimary!: (response: Response) => void
    const fetcher = vi.fn<typeof fetch>((url, options) => {
      if (!url.toString().includes('bing.com')) return new Promise((resolve) => { releasePrimary = resolve })
      if (fallback === 'failed') return Promise.resolve(new Response('', { status: 503 }))
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
      })
    })
    let settled = false
    const pending = createNewsHandler({ fetcher })(new Request('http://localhost/api/news?source=search&q=RELIANCE'))
      .then((response) => { settled = true; return response })

    await vi.advanceTimersByTimeAsync(500)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(settled).toBe(false)
    releasePrimary(new Response(STORY))
    expect((await pending).status).toBe(200)
    expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true)
  })

  it('fetches company news on the server and falls back when the first provider fails', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(new Response(STORY, { status: 200 }))
    const response = await createNewsHandler({ fetcher })(new Request('http://localhost/api/news?source=search&q=RELIANCE'))

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Reliance rises')
    expect(fetcher.mock.calls[0][0].toString()).toContain('news.google.com/rss/search')
    expect(fetcher.mock.calls[1][0].toString()).toContain('bing.com/news/search')
    expect(new URL(fetcher.mock.calls[0][0].toString()).searchParams.get('q')).toBe('RELIANCE stock India when:14d')
    expect(new URL(fetcher.mock.calls[0][0].toString()).searchParams.get('gl')).toBe('IN')
  })

  it.each([
    { region: 'US', locale: 'en-US', company: 'Apple', suffix: 'stock United States' },
    { region: 'GB', locale: 'en-GB', company: 'Shell', suffix: 'stock United Kingdom' },
  ])('uses the $region market for holding searches and provider fallback', async ({ region, locale, company, suffix }) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(new Response(STORY))
    const response = await createNewsHandler({ fetcher })(new Request(`http://localhost/api/news?source=search&q=${company}&region=${region}`))
    const google = new URL(fetcher.mock.calls[0][0].toString())
    const bing = new URL(fetcher.mock.calls[1][0].toString())

    expect(response.status).toBe(200)
    expect(google.searchParams.get('q')).toBe(`${company} ${suffix} when:14d`)
    expect(google.searchParams.get('hl')).toBe(locale)
    expect(google.searchParams.get('gl')).toBe(region)
    expect(google.searchParams.get('ceid')).toBe(`${region}:en`)
    expect(bing.searchParams.get('q')).toBe(`${company} ${suffix}`)
    expect(bing.searchParams.get('mkt')).toBe(locale)
  })

  it.each(['DE', 'us', '', 'US%2CIN'])('rejects unsupported region %s before contacting a provider', async (region) => {
    const fetcher = vi.fn<typeof fetch>()
    const response = await createNewsHandler({ fetcher })(new Request(`http://localhost/api/news?source=search&q=Apple&region=${region}`))
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid news region.')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects arbitrary upstream URLs', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const response = await createNewsHandler({ fetcher })(new Request('http://localhost/api/news?source=https://example.com/private'))

    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('coalesces simultaneous feed requests and briefly caches provider failures', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }))
    const handler = createNewsHandler({ fetcher })
    const request = () => new Request('http://localhost/api/news?source=wire-et')
    const responses = await Promise.all(Array.from({ length: 20 }, () => handler(request())))
    expect(responses.every((response) => response.status === 502)).toBe(true)
    await handler(request())
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects excessive distinct concurrent requests before upstream work', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetcher = vi.fn<typeof fetch>(async () => {
      await gate
      return new Response(STORY)
    })
    const handler = createNewsHandler({ fetcher })
    const pending = Array.from({ length: 20 }, (_, index) => handler(
      new Request(`http://localhost/api/news?source=search&q=S${index}`),
    ))
    release()
    const responses = await Promise.all(pending)
    expect(responses.some((response) => response.status === 429)).toBe(true)
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(8)
    expect(responses.find((response) => response.status === 429)?.headers.get('retry-after')).toBeTruthy()
  })

  it('loads a full calendar month with fixed briefing queries instead of the wire fourteen-day filter', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'))
    const fetcher = vi.fn<typeof fetch>(async () => new Response(STORY))
    const response = await createNewsHandler({ fetcher })(new Request('http://localhost/api/news?source=briefing&topic=policy&from=2026-10-01&through=2026-10-31'))
    expect(response.status).toBe(200)
    const upstream = new URL(fetcher.mock.calls[0][0].toString())
    expect(upstream.hostname).toBe('news.google.com')
    expect(upstream.searchParams.get('q')).toContain('RBI OR "repo rate"')
    expect(upstream.searchParams.get('q')).toContain('after:2026-09-30 before:2026-11-01')
    expect(upstream.searchParams.get('q')).not.toContain('when:14d')
  })

  it.each(['global', 'china'])('queries international publications for the %s briefing topic', async (topic) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'))
    const fetcher = vi.fn<typeof fetch>(async () => new Response(STORY))
    const response = await createNewsHandler({ fetcher })(new Request(`http://localhost/api/news?source=briefing&topic=${topic}&from=2026-11-01&through=2026-11-06`))
    expect(response.status).toBe(200)
    expect(new URL(fetcher.mock.calls[0][0].toString()).searchParams.get('gl')).toBe('US')
  })

  it('uses one combined regional and global recap query without forcing chronological sorting', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    const fetcher = vi.fn<typeof fetch>(async () => new Response(STORY))
    const response = await createNewsHandler({ fetcher })(new Request('http://localhost/api/news?source=briefing&topic=recap&from=2026-10-01&through=2026-10-31'))
    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const upstream = new URL(fetcher.mock.calls[0][0].toString())
    const query = upstream.searchParams.get('q')!
    for (const topic of ['"RBI repo rate"', '"China stocks"', '"global stocks"', '"Federal Reserve interest rates"', 'after:2026-09-30 before:2026-11-01']) expect(query).toContain(topic)
    expect(query).not.toMatch(/OR (?:tariffs|inflation|RBI|ECB) OR/)
    expect(upstream.searchParams.has('scoring')).toBe(false)
  })

  it.each([
    'topic=policy&from=2026-02-30&through=2026-03-04',
    'topic=policy&from=2026-11-06&through=2026-11-01',
    'topic=policy&from=2026-09-01&through=2026-11-06',
    'topic=policy&from=2026-07-01&through=2026-07-06',
    'topic=policy&from=2026-11-01&through=2026-11-07',
    'topic=https://private.test&from=2026-11-01&through=2026-11-06',
    'topic=constructor&from=2026-11-01&through=2026-11-06',
  ])('rejects invalid or unbounded briefing requests: %s', async (query) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'))
    const fetcher = vi.fn<typeof fetch>()
    expect((await createNewsHandler({ fetcher })(new Request(`http://localhost/api/news?source=briefing&${query}`))).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses the India calendar day when validating the latest briefing date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-06T18:31:00Z'))
    const fetcher = vi.fn<typeof fetch>(async () => new Response(STORY))
    const response = await createNewsHandler({ fetcher })(new Request('http://localhost/api/news?source=briefing&topic=india&from=2026-11-01&through=2026-11-07'))
    expect(response.status).toBe(200)
  })
})
