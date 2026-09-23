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
  })

  it('rejects arbitrary upstream URLs', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const response = await createNewsHandler({ fetcher })(new Request('http://localhost/api/news?source=https://example.com/private'))

    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
