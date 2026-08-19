import type { Position } from './types'

export type HoldingEventKind = 'announcement' | 'corporate-action' | 'results' | 'board-meeting' | 'news'

export interface HoldingMonitorEvent {
  id: string
  ticker: string
  kind: HoldingEventKind
  title: string
  summary?: string
  source: string
  sourceUrl: string
  /** Source publication time when the provider supplied one. */
  publishedAt?: number
  eventAt?: number
  official: boolean
}

export interface HoldingBriefing {
  attention: HoldingMonitorEvent[]
  upcoming: HoldingMonitorEvent[]
  updates: HoldingMonitorEvent[]
  coverage: {
    eligibleHoldings: number
    matchedHoldings: number
    unsupportedHoldings: number
  }
}

export interface HoldingIdentity {
  ticker: string
  name: string
  exchange?: Position['exchange']
  isin?: string
  providerSymbol?: string
}

export interface MonitorSourceIssue {
  source: string
  message: string
}

export interface HoldingMonitorFetch {
  events: HoldingMonitorEvent[]
  issues: MonitorSourceIssue[]
}

/** True-external seam. The page only needs normalized events, never vendor payloads. */
export interface HoldingMonitorAdapter {
  fetchEvents(holdings: HoldingIdentity[], options: { signal?: AbortSignal }): Promise<HoldingMonitorFetch>
}

export interface LoadedHoldingBriefing extends HoldingBriefing {
  fetchedAt: number
  issues: MonitorSourceIssue[]
}

const ATTENTION_TERMS = /rights issue|buy-?back|resignation|credit rating|fraud|merger|demerger|acquisition|change in director|auditor/i
const UPCOMING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function normalizedTicker(value: string): string {
  return value.trim().toUpperCase().replace(/\.(NS|NSE|BSE)$/, '')
}

function supported(position: Position): boolean {
  if (position.type === 'stock' || position.type === 'etf') return true
  // Older equity imports had no Type column, so the importer stored them as
  // "other" while still assigning their exchange/provider symbol.
  return position.type === 'other' && Boolean(position.providerSymbol) && (position.exchange === 'NSE' || position.exchange === 'BSE')
}

function eventKey(event: HoldingMonitorEvent): string {
  return `${normalizedTicker(event.ticker)}:${event.sourceUrl}:${event.title.trim().toLowerCase()}`
}

function byNewest(left: HoldingMonitorEvent, right: HoldingMonitorEvent): number {
  return (right.publishedAt ?? 0) - (left.publishedAt ?? 0)
}

/**
 * Classifies already-normalized public events for the holdings currently in the browser.
 * No position amount, cost basis, or valuation is part of this interface.
 */
export function buildHoldingBriefing(positions: Position[], events: HoldingMonitorEvent[], now = Date.now()): HoldingBriefing {
  const eligible = positions.filter(supported)
  const owned = new Set(eligible.map((position) => normalizedTicker(position.ticker)))
  const seen = new Set<string>()
  const matched = events.filter((event) => {
    if (!owned.has(normalizedTicker(event.ticker))) return false
    const key = eventKey(event)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const matchedTickers = new Set(matched.map((event) => normalizedTicker(event.ticker)))
  const attention = matched.filter((event) => event.official && ATTENTION_TERMS.test(event.title)).sort(byNewest)
  const attentionIds = new Set(attention.map((event) => event.id))
  const upcoming = matched.filter((event) => !attentionIds.has(event.id) && event.eventAt != null && event.eventAt >= now && event.eventAt - now <= UPCOMING_WINDOW_MS).sort((left, right) => (left.eventAt ?? 0) - (right.eventAt ?? 0))
  const upcomingIds = new Set(upcoming.map((event) => event.id))
  const updates = matched.filter((event) => !attentionIds.has(event.id) && !upcomingIds.has(event.id)).sort(byNewest)

  return {
    attention,
    upcoming,
    updates,
    coverage: {
      eligibleHoldings: eligible.length,
      matchedHoldings: matchedTickers.size,
      unsupportedHoldings: positions.length - eligible.length,
    },
  }
}

const NEWS_MAX_HOLDINGS = 20
const NEWS_CACHE_MS = 10 * 60 * 1000
type TextFetcher = (url: string, signal?: AbortSignal) => Promise<string>

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

/** Production and test adapters share the same interface; only their external fetcher varies. */
export function createHoldingMonitorAdapter(requestText: TextFetcher = fetchText): HoldingMonitorAdapter {
  let newsCache: { key: string; at: number; events: HoldingMonitorEvent[] } | null = null

  const fetchNews = async (holdings: HoldingIdentity[], signal?: AbortSignal): Promise<HoldingMonitorFetch> => {
    const selected = holdings.slice(0, NEWS_MAX_HOLDINGS)
    const cacheKey = selected.map((holding) => `${normalizedTicker(holding.ticker)}:${holding.name}`).join('|')
    if (newsCache?.key === cacheKey && Date.now() - newsCache.at < NEWS_CACHE_MS) return { events: newsCache.events, issues: [] }
    const results = await Promise.allSettled(selected.map(async (holding) => {
      const company = holding.name.trim() || holding.providerSymbol || holding.ticker
      const query = encodeURIComponent(`"${company}" stock`)
      const payload = await requestText(`/api/google-news/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`, signal)
      return rssItems(payload).slice(0, 8).flatMap((article, index): HoldingMonitorEvent[] => {
        const title = article.title
        const sourceUrl = article.link
        if (!title || !sourceUrl) return []
        return [{
          id: `google-news:${normalizedTicker(holding.ticker)}:${sourceUrl || index}`,
          ticker: holding.ticker,
          kind: 'news',
          title,
          source: article.source || 'Google News',
          sourceUrl,
          publishedAt: article.publishedAt,
          official: false,
        }]
      })
    }))
    if (signal?.aborted) throw new DOMException('Monitor refresh was cancelled.', 'AbortError')
    const events = results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    const failures = results.filter((result) => result.status === 'rejected').length
    const issues = failures ? [{ source: 'Google News', message: failures === selected.length ? 'Portfolio news is unavailable right now.' : `News is unavailable for ${failures} holding${failures === 1 ? '' : 's'}.` }] : []
    if (failures === 0 && events.length > 0) newsCache = { key: cacheKey, at: Date.now(), events }
    return { events, issues }
  }

  return {
    async fetchEvents(holdings, { signal }) {
      return fetchNews(holdings, signal)
    },
  }
}

export const holdingMonitorAdapter = createHoldingMonitorAdapter()

export async function loadHoldingBriefing(
  positions: Position[],
  options: { signal?: AbortSignal } = {},
  adapter: HoldingMonitorAdapter = holdingMonitorAdapter,
): Promise<LoadedHoldingBriefing> {
  const holdings = positions.filter(supported).map((position) => ({
    ticker: position.ticker,
    name: position.name,
    exchange: position.exchange,
    isin: position.isin,
    providerSymbol: position.providerSymbol,
  }))
  const result = await adapter.fetchEvents(holdings, options)
  return { ...buildHoldingBriefing(positions, result.events), issues: result.issues, fetchedAt: Date.now() }
}

function rssItems(xml: string): { title: string; link: string; source: string; publishedAt?: number }[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1]
    const published = xmlValue(item, 'pubDate')
    const parsed = published ? Date.parse(published) : Number.NaN
    return {
      title: xmlValue(item, 'title'),
      link: xmlValue(item, 'link'),
      source: xmlValue(item, 'source'),
      publishedAt: Number.isNaN(parsed) ? undefined : parsed,
    }
  })
}

function xmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!match) return ''
  return decodeXml(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim())
}

function decodeXml(value: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' }
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&(amp|apos|gt|lt|quot);/g, (_, entity: string) => named[entity])
}
