import type { Position } from './types'

export interface NewsItem {
  id: string
  title: string
  summary?: string
  source: string
  sourceUrl: string
  publishedAt?: number
  /** Tickers from the user's book this story mentions; empty for market-wide wire stories. */
  matches: string[]
  /** Which layer produced the story: the standing market wire or the active search. */
  origin: 'wire' | 'search'
}

interface MonitorIssue {
  source: string
  message: string
}

interface NewsFetch {
  items: NewsItem[]
  issues: MonitorIssue[]
}

/**
 * True-external seam. The page only needs normalized news items, never vendor payloads.
 * Wire = one Indian market RSS feed; companyNews = on-demand per-query search.
 */
export interface MarketNewsAdapter {
  fetchWire(options: { signal?: AbortSignal }): Promise<NewsFetch>
  fetchCompanyNews(query: string, options: { signal?: AbortSignal }): Promise<NewsFetch>
}

export interface LoadedMarketFeed extends NewsFetch {
  fetchedAt: number
}

const WIRE_SOURCES = [
  { name: 'Economic Times Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { name: 'Business Standard Markets', url: 'https://www.business-standard.com/rss/markets-106.rss' },
] as const

const WIRE_CACHE_MS = 15 * 60 * 1000
const WIRE_FAILURE_CACHE_MS = 5 * 60 * 1000
const SEARCH_CACHE_MS = 15 * 60 * 1000
const SEARCH_FAILURE_CACHE_MS = 2 * 60 * 1000
const NEWS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const RETRY_DELAY_MS = 700

type TextFetcher = (url: string, signal?: AbortSignal) => Promise<string>

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Retry was cancelled.', 'AbortError')) }, { once: true })
  })
}

function proxied(url: string): string {
  return `https://corsproxy.io/?url=${encodeURIComponent(url)}`
}

interface RawNewsItem {
  title: string
  link: string
  publisher: string
  publishedAt?: number
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

function xmlTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  return match ? decodeXml(match[1]) : undefined
}

/** Tolerant RSS 2.0 reader for the two shapes we consume (publisher feeds and Bing News). */
export function rssItems(payload: string, fallbackPublisher: string): RawNewsItem[] {
  return [...payload.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap((match) => {
    const block = match[1]
    const title = xmlTag(block, 'title') ?? ''
    const link = (xmlTag(block, 'link') ?? '').trim()
    if (!title || !link || !/^https?:\/\//i.test(link)) return []
    const dateText = xmlTag(block, 'pubDate')
    const parsedAt = dateText ? Date.parse(dateText) : Number.NaN
    return [{
      title,
      link,
      publisher: xmlTag(block, 'source') ?? xmlTag(block, 'news:source') ?? fallbackPublisher,
      publishedAt: Number.isFinite(parsedAt) ? parsedAt : undefined,
    }]
  })
}

function toNewsItem(raw: RawNewsItem, idPrefix: string, origin: 'wire' | 'search', cutoff: number): NewsItem | undefined {
  if (raw.publishedAt != null && raw.publishedAt < cutoff) return undefined
  return {
    id: `${idPrefix}:${raw.link}`,
    title: raw.title,
    summary: undefined,
    source: raw.publisher,
    sourceUrl: raw.link,
    publishedAt: raw.publishedAt,
    matches: [],
    origin,
  }
}

// Boilerplate suffixes only. Words like "Industries" stay because they separate
// similarly named groups (Reliance Industries vs Reliance Power).
const NAME_STOPWORDS = /^(LTD|LIMITED|THE|AND|CO|COMPANY|OF|INDIA)$/

/** Meaningful leading words of a company name ("HDFC Bank Ltd" → ["HDFC", "BANK"]). */
export function significantNameWords(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !NAME_STOPWORDS.test(word))
    .slice(0, 3)
}

function tickerMentioned(titleUpper: string, ticker: string): boolean {
  return new RegExp(`(^|[^A-Z0-9])${escapeRegExp(ticker)}($|[^A-Z0-9])`).test(titleUpper)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Which of the user's holdings a headline is about: exact ticker word, collapsed ticker
 * ("HCL Tech" → HCLTECH), or every significant company-name word. */
export function matchedTickers(title: string, holdings: { ticker: string; name: string }[]): string[] {
  const titleUpper = ` ${title.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ')} `
  const titleCollapsed = titleUpper.replace(/ /g, '')
  return holdings.flatMap((holding) => {
    const ticker = holding.ticker.trim().toUpperCase()
    const words = significantNameWords(holding.name)
    const collapsedTicker = ticker.replace(/[^A-Z0-9]/g, '')
    const mentioned = (ticker.length >= 2 && tickerMentioned(titleUpper, ticker)) ||
      (collapsedTicker.length >= 4 && titleCollapsed.includes(collapsedTicker)) ||
      (words.length > 0 && words.every((word) => titleUpper.includes(word)))
    return mentioned ? [holding.ticker] : []
  })
}

export function eligibleHoldings(positions: Position[]): { ticker: string; name: string }[] {
  // Mutual funds have no meaningful news identity in the wire; equities and ETFs do.
  return positions
    .filter((position) => position.type === 'stock' || position.type === 'etf' ||
      (position.type === 'other' && Boolean(position.providerSymbol)))
    .map((position) => ({ ticker: position.ticker, name: position.name }))
}

export function dedupeItems(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.title.trim().toLowerCase()}:${item.sourceUrl}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function createMarketNewsAdapter(requestText: TextFetcher = fetchText): MarketNewsAdapter {
  let wireCache: { at: number; ttl: number; result: NewsFetch } | null = null
  const searchCache = new Map<string, { at: number; ttl: number; result: NewsFetch }>()

  // The public CORS relay rejects requests in short bursts between long healthy
  // stretches; one quick retry rescues most of them. Aborted requests never retry.
  const request = async (url: string, signal?: AbortSignal): Promise<string> => {
    try {
      return await requestText(url, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      await delay(RETRY_DELAY_MS, signal)
      return requestText(url, signal)
    }
  }

  async function fetchFeed(name: string, url: string, cutoff: number, signal?: AbortSignal): Promise<NewsFetch> {
    const payload = await request(proxied(url), signal)
    const items = rssItems(payload, name)
      .map((raw) => toNewsItem(raw, 'wire', 'wire', cutoff))
      .filter((item): item is NewsItem => item != null)
    return { items, issues: [] }
  }

  const fetchWire = async ({ signal }: { signal?: AbortSignal } = {}): Promise<NewsFetch> => {
    if (wireCache && Date.now() - wireCache.at < wireCache.ttl) return wireCache.result
    const cutoff = Date.now() - NEWS_MAX_AGE_MS
    // Every reachable feed contributes; a partial outage still shows news and names the dead feed.
    const outcomes = await Promise.allSettled(WIRE_SOURCES.map((source) => fetchFeed(source.name, source.url, cutoff, signal)))
    if (signal?.aborted) throw new DOMException('Wire refresh was cancelled.', 'AbortError')
    const fulfilled = outcomes.filter((outcome): outcome is PromiseFulfilledResult<NewsFetch> => outcome.status === 'fulfilled')
    const issues = fulfilled.length === WIRE_SOURCES.length ? [] : WIRE_SOURCES
      .filter((_, index) => outcomes[index].status === 'rejected')
      .map((source): MonitorIssue => ({ source: source.name, message: 'feed unreachable — showing the other wire sources.' }))
    if (fulfilled.length === 0) {
      const rateLimited = outcomes.some((outcome) => outcome.status === 'rejected' && String(outcome.reason).includes('429'))
      const failure = { items: [], issues: [{ source: 'Market wire', message: rateLimited ? 'News feeds are rate-limiting requests. Retrying in 5 minutes.' : 'Market news is unavailable right now. Retrying in 5 minutes.' }] }
      wireCache = { at: Date.now(), ttl: WIRE_FAILURE_CACHE_MS, result: failure }
      return failure
    }
    const result = { items: dedupeItems(fulfilled.flatMap((outcome) => outcome.value.items)), issues }
    wireCache = { at: Date.now(), ttl: WIRE_CACHE_MS, result }
    return result
  }

  const fetchCompanyNews = async (query: string, { signal }: { signal?: AbortSignal } = {}): Promise<NewsFetch> => {
    const key = query.trim().toLowerCase()
    if (!key) return { items: [], issues: [] }
    const cached = searchCache.get(key)
    if (cached && Date.now() - cached.at < cached.ttl) return cached.result
    const target = `https://www.bing.com/news/search?q=${encodeURIComponent(query.trim())}&format=RSS`
    const cutoff = Date.now() - NEWS_MAX_AGE_MS
    try {
      const payload = await request(proxied(target), signal)
      if (signal?.aborted) throw new DOMException('Company search was cancelled.', 'AbortError')
      const result = { items: rssItems(payload, 'Bing News').map((raw) => toNewsItem(raw, `search:${key}`, 'search', cutoff)).filter((item): item is NewsItem => item != null), issues: [] }
      searchCache.set(key, { at: Date.now(), ttl: SEARCH_CACHE_MS, result })
      return result
    } catch (error) {
      const rateLimited = String(error).includes('429')
      const result = { items: [], issues: [{ source: `Search · ${query}`, message: rateLimited ? 'The news search source is rate-limiting requests. Try again shortly.' : 'Company news search failed. Try another query or refresh later.' }] }
      searchCache.set(key, { at: Date.now(), ttl: SEARCH_FAILURE_CACHE_MS, result })
      return result
    }
  }

  return { fetchWire, fetchCompanyNews }
}

const marketNewsAdapter = createMarketNewsAdapter()

/** Wire always loads; the optional query layers a company deep-dive on top. Both failures surface as issues. */
export async function loadMarketFeed(
  positions: Position[],
  options: { signal?: AbortSignal; query?: string } = {},
  adapter: MarketNewsAdapter = marketNewsAdapter,
): Promise<LoadedMarketFeed> {
  const holdings = eligibleHoldings(positions)
  const [wire, search] = await Promise.all([
    adapter.fetchWire(options),
    options.query?.trim() ? adapter.fetchCompanyNews(options.query, options) : Promise.resolve({ items: [] as NewsItem[], issues: [] as MonitorIssue[] }),
  ])
  const tagged = dedupeItems([...wire.items, ...search.items]).map((item) => ({
    ...item,
    matches: matchedTickers(item.title, holdings),
  }))
  return { items: tagged, issues: [...search.issues, ...wire.issues], fetchedAt: Date.now() }
}
