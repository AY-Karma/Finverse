import type { LiveQuote } from './types'
import { fetchNavByCode, fetchYahooPrices } from './live'
import { readSearchResults } from './fundSchemes'
import { parseWatchSecurity, type WatchSecurity } from './watchSecurity'

const MAX_PER_SOURCE = 8
const QUERY_PATTERN = /^[A-Za-z0-9 &.'()-]{2,40}$/
const LINK_LIKE = /\bwww\b|\.(com|in|org|net|io|co)\b/i

export type WatchSearchSource = 'stocks' | 'funds'
export interface WatchSearchResult { securities: WatchSecurity[]; unavailable: WatchSearchSource[] }

/** Only a plain name or symbol is searched; links, URLs and arbitrary text are rejected before any request. */
export function cleanWatchQuery(raw: string): string | null {
  const query = raw.trim().replace(/\s+/g, ' ')
  return QUERY_PATTERN.test(query) && !LINK_LIKE.test(query) ? query : null
}

async function searchEquities(query: string, signal: AbortSignal): Promise<WatchSecurity[]> {
  const response = await fetch(`/api/nseListings?${new URLSearchParams({ q: query })}`, { signal })
  if (!response.ok) throw new Error('NSE search unavailable.')
  const payload = await response.json() as { results?: unknown }
  if (!Array.isArray(payload.results)) throw new Error('Invalid NSE search response.')
  return payload.results.slice(0, MAX_PER_SOURCE).flatMap((item: Record<string, unknown>) => {
    const security = parseWatchSecurity({ kind: 'equity', symbol: item?.providerSymbol, isin: item?.isin, type: item?.type, name: item?.name })
    return security ? [security] : []
  })
}

const fundScore = ({ name }: WatchSecurity) => Number(/\bdirect\b/i.test(name)) + Number(/\bgrowth\b/i.test(name))

async function searchFunds(query: string, signal: AbortSignal): Promise<WatchSecurity[]> {
  const response = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`, { signal })
  if (!response.ok) throw new Error('Fund search unavailable.')
  const payload = await readSearchResults(response, signal)
  if (!Array.isArray(payload)) throw new Error('Invalid fund search response.')
  const funds = payload.flatMap((item: Record<string, unknown>) => {
    const security = parseWatchSecurity({ kind: 'fund', code: item?.schemeCode, name: item?.schemeName })
    return security ? [security] : []
  })
  return funds.sort((left, right) => fundScore(right) - fundScore(left)).slice(0, MAX_PER_SOURCE)
}

/** Search results come only from the NSE listings and mfapi.in scheme index. */
export async function searchWatchSecurities(query: string, signal: AbortSignal): Promise<WatchSearchResult> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  const [stocks, funds] = await Promise.allSettled([searchEquities(query, deadline), searchFunds(query, deadline)])
  signal.throwIfAborted()
  return {
    securities: [...(stocks.status === 'fulfilled' ? stocks.value : []), ...(funds.status === 'fulfilled' ? funds.value : [])],
    unavailable: [...(stocks.status === 'rejected' ? ['stocks' as const] : []), ...(funds.status === 'rejected' ? ['funds' as const] : [])],
  }
}

/** Funds use the daily published NAV; stocks and ETFs use the same quote route as holdings. */
export async function fetchWatchQuote(security: WatchSecurity, signal?: AbortSignal): Promise<LiveQuote | null> {
  if (security.kind === 'fund') return fetchNavByCode(security.code, signal)
  const quote = (await fetchYahooPrices([security.symbol], signal)).get(security.symbol)
  return quote ? { price: quote.price, at: quote.at, fetchedAt: quote.fetchedAt, source: quote.source, change: quote.change, changePct: quote.pct } : null
}
