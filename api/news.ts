import { createRequestBudget, readBoundedText } from './requestBudget.js'

const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/xml; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
}

interface NewsHandlerDependencies {
  fetcher: typeof fetch
}

const SEARCH_MARKETS = {
  IN: { locale: 'en-IN', suffix: 'stock India' },
  US: { locale: 'en-US', suffix: 'stock United States' },
  GB: { locale: 'en-GB', suffix: 'stock United Kingdom' },
} as const

function googleSearch(query: string, region: keyof typeof SEARCH_MARKETS = 'IN'): string {
  const url = new URL('https://news.google.com/rss/search')
  url.searchParams.set('q', `${query} when:14d`)
  url.searchParams.set('hl', SEARCH_MARKETS[region].locale)
  url.searchParams.set('gl', region)
  url.searchParams.set('ceid', `${region}:en`)
  return url.toString()
}

async function fetchFeed(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<string | null> {
  try {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(4_000)])
    const response = await fetcher(url, { signal: deadline })
    if (!response.ok) return null
    const body = await readBoundedText(response, 1024 * 1024, deadline)
    return /<item(?:\s|>)/i.test(body) ? body : null
  } catch {
    return null
  }
}

export function createNewsHandler(
  dependencies: Partial<NewsHandlerDependencies> = {},
): (request: Request) => Promise<Response> {
  const fetcher = dependencies.fetcher ?? fetch
  const budget = createRequestBudget()

  return async (request: Request) => {
    if (request.method !== 'GET') return new Response('Method not allowed.', { status: 405 })
    const params = new URL(request.url).searchParams
    const source = params.get('source')
    const query = params.get('q')?.trim() ?? ''
    const region = params.get('region') ?? 'IN'
    if (region !== 'IN' && region !== 'US' && region !== 'GB') {
      return new Response('Invalid news region.', { status: 400 })
    }
    let urls: string[]
    if (source === 'wire-et') {
      urls = ['https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms']
    } else if (source === 'wire-google') {
      urls = [googleSearch('Indian stock market NSE BSE')]
    } else if (source === 'search' && query.length > 0 && query.length <= 120) {
      const market = SEARCH_MARKETS[region]
      const searchQuery = `${query} ${market.suffix}`
      const bing = new URL('https://www.bing.com/news/search')
      bing.searchParams.set('q', searchQuery)
      bing.searchParams.set('format', 'RSS')
      bing.searchParams.set('mkt', market.locale)
      urls = [googleSearch(searchQuery, region), bing.toString()]
    } else {
      return new Response('Invalid news request.', { status: 400 })
    }

    return budget(urls.join('|'), 300_000, async (signal) => {
      for (const url of urls) {
        if (signal.aborted) break
        const feed = await fetchFeed(url, fetcher, signal)
        if (feed) return new Response(feed, { status: 200, headers: HEADERS })
      }
      return new Response('News providers are unavailable.', { status: 502, headers: { 'Cache-Control': 'no-store' } })
    })
  }
}

export const handleNewsRequest = createNewsHandler()

export default { fetch: handleNewsRequest }
