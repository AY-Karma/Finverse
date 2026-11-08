import { eligibleHoldings, matchedTickers, rssItems, type NewsItem } from './marketNews'
import { canonicalNewsUrl } from './monitorReading'
import type { Position } from './types'

export type MarketBriefingTopic = 'policy' | 'china' | 'global' | 'india' | 'commodities' | 'earnings' | 'economy'
export const MARKET_BRIEFING_VERSION = 3
type RecapCadence = 'weekly' | 'monthly'
export interface MarketBriefingStory {
  id: string
  title: string
  source: string
  sourceUrl: string
  publishedAt: number
  topic: MarketBriefingTopic
  region: 'India' | 'Global' | 'China'
  /** Distinct publishers in the loaded feeds, not readership or social engagement. */
  coverage: number
  score: number
  matches: string[]
}

interface BriefingOptions {
  from: string
  through: string
  positions?: Position[]
  ranking?: 'app' | 'google' | 'recap'
  cadence?: RecapCadence
}
interface BriefingResult { items: MarketBriefingStory[]; issues: string[] }
interface BriefingCandidate extends NewsItem { providerRank?: number }
type TextFetcher = (url: string, signal?: AbortSignal) => Promise<string>

const TOPICS = ['india', 'global', 'china', 'policy', 'commodities'] as const
const DAY = 86_400_000
const MAX_STORIES = 24
const FINANCE = /\b(?:stocks?|shares?|markets?|equities|indices|index|nifty|sensex|nasdaq|dow|s&p|rbi|repo|monetary|interest rates?|inflation|gdp|federal reserve|central bank|pboc|ecb|bonds?|yields?|tariffs?|rupee|crude|oil|gold|earnings|profits?|recession|stimulus|banking|economy|economic)\b/i
const PROMOTIONAL = /\b(?:stocks? to (?:buy|sell|watch)|buy or sell|top \d+|multibaggers?|stock picks?|price targets?|target price|horoscope|sponsored|advertorial|how to invest|best stocks?|investment tips?|technical (?:outlook|analysis)|trading ideas?)\b/i
const STOP_WORDS = new Set('a an the and or for to of in on at as by with from after before amid over this that is are was were be has have had its it their new today latest news live updates update market markets stock stocks share shares says said percent per cent'.split(' '))
const NORMAL_WORDS: Record<string, string> = { hikes: 'hike', hiked: 'hike', raises: 'hike', raised: 'hike', cuts: 'cut', lowered: 'cut', lowers: 'cut', rates: 'rate', falls: 'fall', fell: 'fall', plunges: 'fall', plunged: 'fall', rises: 'rise', rose: 'rise', rallies: 'rise', rallied: 'rise', gains: 'rise' }

function periodBounds({ from, through }: BriefingOptions): { start: number; end: number } | null {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  try {
    if (!valid(from) || !valid(through)) return null
    const start = Date.parse(`${from}T00:00:00+05:30`)
    const end = Date.parse(`${through}T00:00:00+05:30`) + DAY
    return end > start && end - start <= 40 * DAY ? { start, end } : null
  } catch { return null }
}

function cleanTitle(item: NewsItem): string {
  const title = item.title.trim().replace(/\s+/g, ' ')
  const suffix = ` - ${item.source.trim()}`
  return title.toLowerCase().endsWith(suffix.toLowerCase()) ? title.slice(0, -suffix.length).trim() : title
}

function isMarketRecapHeadline(title: string): boolean {
  if (/\bbank holidays?\b/i.test(title)) return false
  const rateDecision = /\b(?:rbi|reserve bank|federal reserve|fed|ecb|pboc|bank of (?:england|japan))\b/i.test(title)
    && /\b(?:rates?|repo|monetary policy|quantitative easing)\b/i.test(title)
    && /\b(?:raises?|raised|hikes?|hiked|cuts?|lowers?|lowered|holds?|keeps?|kept|maintains?|maintained|leaves?|left|unchanged|decision|easing|tightening)\b/i.test(title)
  const economicRelease = /\b(?:inflation|cpi|gdp|unemployment|payrolls?|pmi|retail sales)\b/i.test(title)
    && /\d|\b(?:data|report|growth|eases?|cools?|accelerates?|slows?|rises?|falls?|expands?|contracts?|beats?|misses?)\b/i.test(title)
  const earnings = /\b(?:earnings|quarterly profits?|quarterly results|revenue)\b/i.test(title)
  if (rateDecision || economicRelease || earnings) return true
  const market = /\b(?:stocks?|shares?|equities|indices|nifty|sensex|nasdaq|dow|s&p|nikkei|hang seng|shanghai|ftse|dax|stoxx|bonds?|yields?|currenc(?:y|ies)|forex|rupee|dollar|commodit(?:y|ies)|crude|oil|gold|silver|(?:global|world|financial|asian|european|indian|china) markets?)\b/i.test(title)
  if (!market) return false
  const political = /\b(?:politic(?:s|al)|elections?|midterms?|campaign|voters?|democrats?|republicans?|parliament|senate|president|prime minister)\b/i.test(title)
  return !political || /\b(?:rall(?:y|ies|ied)|surge[sd]?|ris(?:e[sn]?|ing)|rose|fall(?:s|ing)?|fell|drop(?:s|ped|ping)?|slid(?:e[sd]?|ing)|slump[sd]?|plung(?:e[sd]?|ing)|jump(?:s|ed)?|gain[sd]?|losses|retreat[sd]?|weigh[sd]?|react[sd]?|strengthen[sd]?|weaken[sd]?|selloff|sell-off|trading|yields?)\b/i.test(title)
}

function topicOf(title: string): MarketBriefingTopic {
  if (/\b(?:rbi|repo|monetary|interest rate|federal reserve|central bank|pboc|ecb)\b/i.test(title)) return 'policy'
  if (/\b(?:china|chinese|hang seng|shanghai|shenzhen)\b/i.test(title)) return 'china'
  if (/\b(?:oil|crude|gold|silver|rupee|commodit)\b/i.test(title)) return 'commodities'
  if (/\b(?:earnings|profit|revenue|quarterly results)\b/i.test(title)) return 'earnings'
  if (/\b(?:inflation|gdp|recession|jobs|unemployment|economy|economic)\b/i.test(title)) return 'economy'
  if (/\b(?:india|indian|nifty|sensex|nse|bse|sebi)\b/i.test(title)) return 'india'
  return 'global'
}

function regionOf(title: string): MarketBriefingStory['region'] {
  if (/\b(?:china|chinese|hang seng|shanghai|shenzhen|pboc)\b/i.test(title)) return 'China'
  if (/\b(?:india|indian|nifty|sensex|nse|bse|rbi|repo|rupee|sebi)\b/i.test(title)) return 'India'
  return 'Global'
}

function tokens(title: string): Set<string> {
  return new Set((title.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 1 && !STOP_WORDS.has(word)).map((word) => NORMAL_WORDS[word] ?? word))
}

function direction(title: string): string {
  const up = /\b(?:hikes?|raises?|raised|increases?|rises?|rall(?:y|ies)|surges?|gains?)\b/i.test(title)
  const down = /\b(?:cuts?|lowers?|lowered|reduces?|falls?|fell|plunges?|losses|declines?)\b/i.test(title)
  return up && down ? 'mixed' : up ? 'up' : down ? 'down' : 'flat'
}

function sameEvent(a: MarketBriefingStory, b: MarketBriefingStory): boolean {
  if (a.sourceUrl === b.sourceUrl) return true
  if (a.region !== b.region || a.topic !== b.topic || Math.abs(a.publishedAt - b.publishedAt) > 3 * DAY || direction(a.title) !== direction(b.title)) return false
  const figures = (title: string) => [...title.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]).sort().join('|')
  if (figures(a.title) !== figures(b.title)) return false
  const left = tokens(a.title)
  const right = tokens(b.title)
  if (left.size === right.size && [...left].every((word) => right.has(word))) return true
  const policyActor = (title: string) => /\b(?:rbi|reserve bank of india)\b/i.test(title) ? 'rbi'
    : /\b(?:federal reserve|fed)\b/i.test(title) ? 'fed'
      : /\b(?:ecb|european central bank)\b/i.test(title) ? 'ecb'
        : /\b(?:pboc|people.s bank of china)\b/i.test(title) ? 'pboc' : null
  const actor = policyActor(a.title)
  if (a.topic !== 'policy' || !actor || actor !== policyActor(b.title)) return false
  const common = [...left].filter((word) => right.has(word)).length
  return common >= 4 && common / Math.max(left.size, right.size) >= .65
}

function publisherKey(source: string): string {
  return source.toLowerCase().replace(/^the\s+|^www\.|\.com$/g, '').replace(/[^a-z0-9]/g, '')
}

function recapWindows(options: BriefingOptions): { from: string; through: string }[] {
  if (!periodBounds(options)) return []
  const step = options.cadence === 'weekly' ? 1 : 7
  const end = Date.parse(`${options.through}T00:00:00Z`)
  const windows = []
  for (let start = Date.parse(`${options.from}T00:00:00Z`); start <= end; start += step * DAY) {
    windows.push({ from: new Date(start).toISOString().slice(0, 10), through: new Date(Math.min(end, start + (step - 1) * DAY)).toISOString().slice(0, 10) })
  }
  return windows
}

/** Select importance within time buckets, then tell the period's story oldest first. */
export function selectRecapNews(items: MarketBriefingStory[], options: BriefingOptions, limit = options.cadence === 'weekly' ? 3 : 5): MarketBriefingStory[] {
  const bounds = periodBounds(options)
  if (!bounds || limit <= 0) return []
  const step = (options.cadence === 'weekly' ? 1 : 7) * DAY
  const buckets = new Map<number, MarketBriefingStory>()
  const eligible = items.filter((story) => Number.isFinite(story.publishedAt) && story.publishedAt >= bounds.start && story.publishedAt < bounds.end)
  for (const story of eligible) {
    const bucket = Math.floor((story.publishedAt - bounds.start) / step)
    const previous = buckets.get(bucket)
    if (!previous || story.score > previous.score) buckets.set(bucket, story)
  }
  const winners = [...buckets.entries()].sort(([a], [b]) => a - b).map(([, story]) => story)
  const count = Math.min(Math.floor(limit), winners.length)
  if (!count) return []
  // Reserve space across the period, choosing importance within each part.
  const selected = Array.from({ length: count }, (_, index) => {
    const part = winners.slice(Math.ceil(index * winners.length / count), Math.ceil((index + 1) * winners.length / count))
    return part.reduce((best, story) => story.score > best.score ? story : best)
  })
  for (const story of [...eligible].sort((a, b) => b.score - a.score)) {
    if (selected.length >= limit) break
    if (!selected.some((previous) => sameEvent(previous, story))) selected.push(story)
  }
  return selected.sort((a, b) => a.publishedAt - b.publishedAt)
}

/** Coverage is a ranking signal in these feeds, not a measurement of public popularity. */
export function rankMarketBriefing(items: BriefingCandidate[], options: BriefingOptions): MarketBriefingStory[] {
  const bounds = periodBounds(options)
  if (!bounds) return []
  const googleOrder = options.ranking === 'google' || options.ranking === 'recap'
  const holdings = googleOrder ? [] : eligibleHoldings(options.positions ?? [])
  const groups: { story: MarketBriefingStory; publishers: Set<string>; providerRank: number }[] = []
  const now = Date.now()
  const ordered = googleOrder ? items : [...items].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  for (const [index, item] of ordered.entries()) {
    if (item.publishedAt == null || !Number.isFinite(item.publishedAt) || item.publishedAt < bounds.start || item.publishedAt >= bounds.end || item.publishedAt > now || !item.source.trim()) continue
    const title = cleanTitle(item)
    if (title.length < 15 || title.length > 300 || PROMOTIONAL.test(title)) continue
    if (googleOrder ? !isMarketRecapHeadline(title) : !FINANCE.test(title)) continue
    let sourceUrl: string
    try { sourceUrl = canonicalNewsUrl(item.sourceUrl) } catch { continue }
    const story: MarketBriefingStory = {
      id: `news:${sourceUrl}`, title, source: item.source.trim(), sourceUrl, publishedAt: item.publishedAt,
      topic: topicOf(title), region: regionOf(title), coverage: 1, score: 0, matches: matchedTickers(title, holdings),
    }
    const group = groups.find((candidate) => sameEvent(candidate.story, story))
    if (group) {
      group.publishers.add(publisherKey(story.source))
      group.story.matches = [...new Set([...group.story.matches, ...story.matches])]
      group.providerRank = Math.min(group.providerRank, item.providerRank ?? index)
    } else groups.push({ story, publishers: new Set([publisherKey(story.source)]), providerRank: item.providerRank ?? index })
  }
  if (options.ranking === 'recap') return groups.map(({ story, publishers, providerRank }) => {
    const broadMarket = /\b(?:global|world|wall street|asian|european|china|chinese|indian) (?:stocks?|markets?|equities)|\b(?:nifty|sensex|nasdaq|s&p|nikkei|hang seng|stoxx|bond yields)\b/i.test(story.title)
    const materiality = broadMarket || story.topic === 'policy' || story.topic === 'economy' ? 1.5 : 0
    return { ...story, coverage: publishers.size, score: 4 / (1 + providerRank / 5) + materiality + Math.min(2, Math.log2(publishers.size)) }
  }).sort((a, b) => b.score - a.score)
  if (googleOrder) return groups.slice(0, MAX_STORIES).map(({ story, publishers }) => ({ ...story, coverage: publishers.size }))
  const scored = groups.map(({ story, publishers }) => {
    const coverage = publishers.size
    const freshness = Math.max(0, 1 - (Math.min(now, bounds.end) - story.publishedAt) / (bounds.end - bounds.start))
    const materiality = story.topic === 'policy' || story.topic === 'china' || /\b(?:crash|plung|tariff|war|recession|record|stimulus)\b/i.test(story.title) ? 4 : 1
    return { ...story, coverage, score: Math.log2(coverage + 1) * 5 + materiality + (story.region === 'India' ? 2 : 0) + Math.min(2, story.matches.length) + freshness * 2 }
  }).sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt || a.id.localeCompare(b.id))
  // Reserve one place for each material topic before filling the remaining space by rank.
  const selected = new Set(scored.filter((story, index) => ['policy', 'china', 'global', 'commodities'].includes(story.topic) && scored.findIndex((item) => item.topic === story.topic) === index).map((story) => story.id))
  const cutoff = (scored[0]?.score ?? 0) * .6
  for (const story of scored) {
    if (selected.size >= MAX_STORIES) break
    if (story.score >= cutoff) selected.add(story.id)
  }
  return scored.filter((story) => selected.has(story.id))
}

async function requestText(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(12_000)
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

export function createMarketBriefingLoader(fetchText: TextFetcher = requestText) {
  const cache = new Map<string, { at: number; items: BriefingCandidate[]; issues: string[] }>()
  return async ({ from, through, positions, ranking = 'app', cadence, signal, forceRefresh }: BriefingOptions & { signal?: AbortSignal; forceRefresh?: boolean }): Promise<BriefingResult> => {
    signal?.throwIfAborted()
    if (!periodBounds({ from, through })) return { items: [], issues: ['Choose a valid market-news period of up to 40 days.'] }
    const options = { from, through, positions, ranking, cadence }
    const key = `${MARKET_BRIEFING_VERSION}:${ranking}:${cadence ?? ''}:${from}:${through}`
    const cached = cache.get(key)
    if (!forceRefresh && cached && Date.now() - cached.at < 10 * 60_000) return { items: rankMarketBriefing(cached.items, options), issues: cached.issues }
    const issues: string[] = []
    const requests = ranking === 'recap' ? recapWindows(options).map((window) => ({ ...window, topic: 'recap' }))
      : (ranking === 'google' ? ['recap'] : TOPICS).map((topic) => ({ from, through, topic }))
    const batches: BriefingCandidate[][] = requests.map(() => [])
    let cursor = 0
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (cursor < requests.length && !signal?.aborted) {
        const index = cursor++
        const request = requests[index]
        const { topic } = request
        try {
          const params = new URLSearchParams({ source: 'briefing', ...request, v: String(MARKET_BRIEFING_VERSION) })
          const text = await fetchText(`/api/news?${params}`, signal)
          if (!/<rss(?:\s|>)/i.test(text)) throw new Error('Invalid news feed.')
          const bounds = periodBounds(request)!
          rssItems(text, 'Market news').forEach((item, providerRank) => {
            if (item.publishedAt == null || item.publishedAt < bounds.start || item.publishedAt >= bounds.end) return
            batches[index].push({ id: `${topic}:${item.link}`, title: item.title, source: item.publisher, sourceUrl: item.link, publishedAt: item.publishedAt, matches: [], origin: 'wire', providerRank })
          })
        } catch {
          if (signal?.aborted) return
          issues.push(`${ranking === 'recap' ? request.from : topic === 'china' ? 'China' : topic[0].toUpperCase() + topic.slice(1)} news is unavailable.`)
        }
      }
    }))
    signal?.throwIfAborted()
    const items = batches.flat()
    if (items.length) {
      if (cache.size >= 8) cache.delete(cache.keys().next().value!)
      cache.set(key, { at: Date.now(), items, issues })
    }
    return { items: rankMarketBriefing(items, options), issues }
  }
}

export const loadMarketBriefing = createMarketBriefingLoader()
