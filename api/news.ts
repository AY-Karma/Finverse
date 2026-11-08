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

const BRIEFING_QUERIES = {
  recap: '("global stocks" OR "world stock markets" OR "Wall Street stocks" OR "Asian stocks" OR "European stocks" OR "China stocks" OR "Hang Seng" OR Nikkei OR "S&P 500" OR Nasdaq OR Nifty OR Sensex OR "bond yields" OR "currency markets" OR "crude oil prices" OR "gold prices" OR "RBI repo rate" OR "Federal Reserve interest rates" OR "ECB interest rates")',
  india: '(Nifty OR Sensex OR "Indian stocks" OR "Indian markets")',
  global: '("global stocks" OR "Wall Street" OR "Federal Reserve" OR tariffs OR ECB)',
  china: '("China stocks" OR "Chinese stocks" OR "Hang Seng" OR "China economy" OR PBOC)',
  policy: '(RBI OR "repo rate" OR "monetary policy" OR "interest rates")',
  commodities: '("crude oil" OR "gold prices" OR rupee OR inflation)',
} as const

function calendarDate(value: string): number | null {
  const at = Date.parse(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value ? at : null
}

function briefingUrl(params: URLSearchParams): string | null {
  const topic = params.get('topic') ?? ''
  const from = params.get('from') ?? ''
  const through = params.get('through') ?? ''
  const start = calendarDate(from)
  const end = calendarDate(through)
  const today = calendarDate(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10))!
  const day = 86_400_000
  if (!Object.prototype.hasOwnProperty.call(BRIEFING_QUERIES, topic) || start == null || end == null || end < start || end - start >= 40 * day || start < today - 90 * day || end > today) return null
  const url = new URL(googleSearch('', topic === 'global' || topic === 'china' ? 'US' : 'IN'))
  const nextDay = new Date(end + day).toISOString().slice(0, 10)
  // Overfetch the opening day; the reader applies exact India-time bounds.
  const priorDay = new Date(start - day).toISOString().slice(0, 10)
  url.searchParams.set('q', `${BRIEFING_QUERIES[topic as keyof typeof BRIEFING_QUERIES]} after:${priorDay} before:${nextDay}`)
  return url.toString()
}

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

function fetchCompanyFeed(urls: string[], fetcher: typeof fetch, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) return Promise.resolve(null)
  const controller = new AbortController()
  const providerSignal = AbortSignal.any([signal, controller.signal])
  return new Promise((resolve) => {
    let settled = false
    let failures = 0
    let fallbackStarted = false
    const finish = (feed: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(hedge)
      signal.removeEventListener('abort', abort)
      controller.abort()
      resolve(feed)
    }
    const abort = () => finish(null)
    const receive = (feed: string | null) => {
      if (settled) return
      if (feed) finish(feed)
      else if (++failures === 2) finish(null)
    }
    const startFallback = () => {
      if (fallbackStarted || settled) return
      fallbackStarted = true
      void fetchFeed(urls[1], fetcher, providerSignal).then(receive)
    }
    // Fast Google results retain precedence; after 500ms the first healthy feed wins.
    const hedge = setTimeout(startFallback, 500)
    signal.addEventListener('abort', abort, { once: true })
    void fetchFeed(urls[0], fetcher, providerSignal).then((feed) => {
      receive(feed)
      if (!feed) startFallback()
    })
  })
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
    if (source === 'briefing') {
      const url = briefingUrl(params)
      if (!url) return new Response('Invalid market briefing period or topic.', { status: 400 })
      urls = [url]
    } else if (source === 'wire-et') {
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
      const feed = urls.length === 1
        ? await fetchFeed(urls[0], fetcher, signal)
        : await fetchCompanyFeed(urls, fetcher, signal)
      if (feed) return new Response(feed, { status: 200, headers: HEADERS })
      return new Response('News providers are unavailable.', { status: 502, headers: { 'Cache-Control': 'no-store' } })
    })
  }
}

export const handleNewsRequest = createNewsHandler()

export default { fetch: handleNewsRequest }
