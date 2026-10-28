import { normalizePosition } from './instruments'
import { holdingIdentity } from './monitor'
import { MAX_EVENT_SYMBOLS, isEventDate, isEventSymbol, isOfficialEventUrl, type MarketEventPayload, type MarketEventsPayload, type MarketEventIssue } from './marketEventsProtocol'
import type { Position } from './types'

export type { MarketEventKind } from './marketEventsProtocol'
export interface MarketEvent extends MarketEventPayload { holdingId: string; instrumentIdentity: string; holdingName: string }
export interface MarketEventsFeed { events: MarketEvent[]; issues: MarketEventIssue[]; fetchedAt: number }
type Options = { signal?: AbortSignal; forceRefresh?: boolean }
const MAX_CONCURRENT_BATCHES = 3
const KINDS = ['results', 'meeting', 'dividend', 'corporate-action', 'filing']
const DATE_LABELS = ['Meeting date', 'Ex-date', 'Published']

function payloadEvent(value: unknown): value is MarketEventPayload {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 1000
    && typeof row.symbol === 'string' && isEventSymbol(row.symbol)
    && (row.isin === undefined || typeof row.isin === 'string' && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(row.isin))
    && (row.issuerIsin === undefined || row.kind === 'filing' && typeof row.issuerIsin === 'string' && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(row.issuerIsin))
    && typeof row.title === 'string' && row.title.length > 0 && row.title.length <= 500
    && typeof row.kind === 'string' && KINDS.includes(row.kind)
    && typeof row.date === 'string' && isEventDate(row.date)
    && typeof row.dateLabel === 'string' && DATE_LABELS.includes(row.dateLabel)
    && (row.kind === 'filing' ? row.dateLabel === 'Published' && typeof row.publishedAt === 'number' && Number.isFinite(row.publishedAt) && row.publishedAt > 0
      : row.kind === 'meeting' || row.kind === 'results' ? row.dateLabel === 'Meeting date' : row.dateLabel === 'Ex-date')
    && typeof row.sourceUrl === 'string' && row.sourceUrl.length <= 2000 && isOfficialEventUrl(row.sourceUrl) && row.source === 'NSE'
}

function eligible(position: Position): boolean {
  return (position.type === 'stock' || position.type === 'etf') && position.exchange === 'NSE' && position.exchangeSource === 'explicit'
    && position.currency === 'INR' && !position.identityIssue && isEventSymbol(position.ticker) && position.providerSymbol === `${position.ticker}.NS`
}

function holdingLabel(position: Position): string {
  return position.name && position.name !== position.ticker ? `${position.name} (${position.ticker})` : position.ticker
}

function coverageIssues(positions: Position[]): MarketEventIssue[] {
  const excluded = new Map<string, Set<string>>()
  for (const position of positions) {
    if (eligible(position)) continue
    const reason = position.type === 'mutual-fund' ? 'Mutual fund notices are not supplied by the NSE equity feed'
      : position.type !== 'stock' && position.type !== 'etf' ? 'Asset type not covered by the NSE equity feed'
        : position.exchange && position.exchange !== 'NSE' ? `${position.exchange} listings are not covered by this NSE feed`
          : 'Confirm the NSE listing in Settings for these holdings'
    const labels = excluded.get(reason) ?? new Set<string>()
    labels.add(holdingLabel(position))
    excluded.set(reason, labels)
  }
  return [...excluded].map(([reason, labels]) => ({ source: 'Company events', message: `${reason}: ${[...labels].join('; ')}.` }))
}

export function createMarketEventsLoader(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  const cache = new Map<string, { until: number; feed: MarketEventsPayload }>()

  async function request(symbols: string[], { signal, forceRefresh }: Options): Promise<MarketEventsPayload> {
    const key = [...symbols].sort().join(',')
    const cached = cache.get(key)
    if (!forceRefresh && cached && cached.until > now()) return cached.feed
    const deadline = AbortSignal.timeout(12_000)
    try {
      const response = await fetcher(`/api/events?symbols=${encodeURIComponent(key)}`, { signal: signal ? AbortSignal.any([signal, deadline]) : deadline })
      const value: unknown = await response.json()
      if (!value || typeof value !== 'object' || !('events' in value) || !Array.isArray(value.events) || value.events.length > 1000
        || !('issues' in value) || !Array.isArray(value.issues) || !('fetchedAt' in value) || typeof value.fetchedAt !== 'number' || !Number.isFinite(value.fetchedAt) || value.fetchedAt < 0 || value.fetchedAt > now() + 300_000) throw new Error('Invalid company events response')
      const issues: MarketEventIssue[] = value.issues.slice(0, 10).flatMap((issue: unknown) => {
        if (!issue || typeof issue !== 'object' || !('source' in issue) || typeof issue.source !== 'string' || !('message' in issue) || typeof issue.message !== 'string') return []
        return [{ source: issue.source.slice(0, 80), message: issue.message.slice(0, 300) }]
      })
      const events = value.events.filter(payloadEvent).filter((event) => symbols.includes(event.symbol))
      if (events.length < value.events.length) issues.push({ source: 'NSE', message: 'Some updates could not be verified and were omitted.' })
      if (!response.ok && !issues.length) throw new Error('Company events unavailable')
      const feed = { events, issues, fetchedAt: value.fetchedAt }
      if (cache.size >= 32) cache.delete(cache.keys().next().value!)
      cache.set(key, { until: now() + (issues.length ? 60_000 : 300_000), feed })
      return feed
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      return { events: [], issues: [{ source: 'NSE', message: 'Company updates are unavailable. Try again shortly or check NSE.' }], fetchedAt: 0 }
    }
  }

  return async (positions: Position[], options: Options = {}): Promise<MarketEventsFeed> => {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Cancelled', 'AbortError')
    const normalized = positions.map(normalizePosition)
    const supported = normalized.filter(eligible)
    const symbols = [...new Set(supported.map((position) => position.ticker))].sort()
    const issues = coverageIssues(normalized)
    if (!symbols.length) return { events: [], issues, fetchedAt: 0 }
    const batches = Array.from({ length: Math.ceil(symbols.length / MAX_EVENT_SYMBOLS) }, (_, index) => symbols.slice(index * MAX_EVENT_SYMBOLS, (index + 1) * MAX_EVENT_SYMBOLS))
    const feeds = new Array<MarketEventsPayload>(batches.length)
    let nextBatch = 0
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_BATCHES, batches.length) }, async () => {
      while (nextBatch < batches.length) {
        if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Cancelled', 'AbortError')
        const index = nextBatch++
        feeds[index] = await request(batches[index], options)
      }
    }))
    const events: MarketEvent[] = []
    const mismatches = new Map<string, { holding: Position; expected: Set<string> }>()
    const ambiguous = new Set<string>()
    for (const event of feeds.flatMap((feed) => feed.events)) {
      const expectedIsin = event.kind === 'filing' ? event.issuerIsin ?? event.isin : event.isin
      const symbolHoldings = supported.filter((position) => position.ticker === event.symbol)
      const candidates = symbolHoldings.filter((position) => !expectedIsin || !position.isin || position.isin === expectedIsin)
      const identities = new Set(candidates.map(holdingIdentity))
      if (!candidates.length) {
        for (const holding of symbolHoldings) {
          const mismatch = mismatches.get(holding.id) ?? { holding, expected: new Set<string>() }
          if (expectedIsin) mismatch.expected.add(expectedIsin)
          mismatches.set(holding.id, mismatch)
        }
        continue
      }
      if (identities.size !== 1) { ambiguous.add(event.symbol); continue }
      const holding = candidates[0]
      events.push({ ...event, holdingId: holding.id, holdingName: holding.name || holding.ticker, instrumentIdentity: holdingIdentity(holding) })
    }
    for (const { holding, expected } of mismatches.values()) issues.push({ source: 'Company events', message: `ISIN mismatch for ${holdingLabel(holding)}: holding ${holding.isin}, NSE ${[...expected].join(', ')}. These updates were skipped.` })
    if (ambiguous.size) issues.push({ source: 'Company events', message: `Conflicting imported listing identities for ${[...ambiguous].join(', ')}. Confirm these listings in Settings.` })
    const uniqueIssues = new Map([...issues, ...feeds.flatMap((feed) => feed.issues)].map((issue) => [`${issue.source}:${issue.message}`, issue]))
    return { events: [...new Map(events.map((event) => [`${event.id}:${event.instrumentIdentity}`, event])).values()], issues: [...uniqueIssues.values()], fetchedAt: Math.max(...feeds.map((feed) => feed.fetchedAt)) }
  }
}

export const loadMarketEvents = createMarketEventsLoader()
