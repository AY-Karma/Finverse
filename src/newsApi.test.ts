import { describe, expect, it, vi } from 'vitest'
import { createNewsHandler } from '../api/news'

const STORY = '<rss><channel><item><title>Reliance rises</title><link>https://example.com/story</link></item></channel></rss>'

describe('news API', () => {
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
})
