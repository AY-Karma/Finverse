const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/xml; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

interface NewsHandlerDependencies {
  fetcher: typeof fetch
}

function googleSearch(query: string): string {
  const url = new URL('https://news.google.com/rss/search')
  url.searchParams.set('q', `${query} when:14d`)
  url.searchParams.set('hl', 'en-IN')
  url.searchParams.set('gl', 'IN')
  url.searchParams.set('ceid', 'IN:en')
  return url.toString()
}

async function fetchFeed(url: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return null
    const body = await response.text()
    return /<item(?:\s|>)/i.test(body) ? body : null
  } catch {
    return null
  }
}

export function createNewsHandler(
  dependencies: Partial<NewsHandlerDependencies> = {},
): (request: Request) => Promise<Response> {
  const fetcher = dependencies.fetcher ?? fetch

  return async (request: Request) => {
    if (request.method !== 'GET') return new Response('Method not allowed.', { status: 405 })
    const params = new URL(request.url).searchParams
    const source = params.get('source')
    const query = params.get('q')?.trim() ?? ''
    let urls: string[]
    if (source === 'wire-et') {
      urls = ['https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms']
    } else if (source === 'wire-google') {
      urls = [googleSearch('Indian stock market NSE BSE')]
    } else if (source === 'search' && query.length > 0 && query.length <= 120) {
      const bing = new URL('https://www.bing.com/news/search')
      bing.searchParams.set('q', `${query} stock India`)
      bing.searchParams.set('format', 'RSS')
      urls = [googleSearch(`${query} stock India`), bing.toString()]
    } else {
      return new Response('Invalid news request.', { status: 400 })
    }

    for (const url of urls) {
      const feed = await fetchFeed(url, fetcher)
      if (feed) return new Response(feed, { status: 200, headers: HEADERS })
    }
    return new Response('News providers are unavailable.', { status: 502 })
  }
}

export const handleNewsRequest = createNewsHandler()

export default { fetch: handleNewsRequest }
