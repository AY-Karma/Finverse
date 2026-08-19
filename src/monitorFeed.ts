import type { HoldingMonitorEvent } from './holdingMonitor'

export type NewsSentiment = 'positive' | 'negative' | 'neutral'
export type NewsSort = 'latest' | 'company'

export interface NewsFeedFilters {
  query: string
  ticker: string
  sentiment: 'all' | NewsSentiment
  sort: NewsSort
}

const NEGATIVE_TERMS = /\b(down|fall(?:s|en)?|drop(?:s|ped)?|plung(?:e|es|ed)|declin(?:e|es|ed)|slump(?:s|ed)?|tumble(?:s|d)?|loss(?:es)?|miss(?:es|ed)?|weak(?:ens|er)?|cut(?:s|ting)?|downgrade[ds]?)\b/i
const POSITIVE_TERMS = /\b(up|rise[ns]?|gain(?:s|ed)?|jump(?:s|ed)?|surge(?:s|d)?|rall(?:y|ies|ied)?|soar(?:s|ed)?|beat(?:s)?|record profit|upgrade[ds]?)\b/i

export function sentimentForTitle(title: string): NewsSentiment {
  if (NEGATIVE_TERMS.test(title)) return 'negative'
  if (POSITIVE_TERMS.test(title)) return 'positive'
  return 'neutral'
}

/** Filters and orders the in-memory feed only. No extra holding data leaves the browser. */
export function filterNewsEvents(events: HoldingMonitorEvent[], filters: NewsFeedFilters): HoldingMonitorEvent[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return [...events]
    .filter((event) => {
      if (filters.ticker !== 'all' && event.ticker !== filters.ticker) return false
      if (filters.sentiment !== 'all' && sentimentForTitle(event.title) !== filters.sentiment) return false
      return !query || `${event.ticker} ${event.title} ${event.source}`.toLocaleLowerCase().includes(query)
    })
    .sort((left, right) => filters.sort === 'company'
      ? left.ticker.localeCompare(right.ticker) || right.title.localeCompare(left.title)
      : (right.publishedAt ?? 0) - (left.publishedAt ?? 0))
}

export function pageCount(itemCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(itemCount / pageSize))
}

export function pagedEvents(events: HoldingMonitorEvent[], page: number, pageSize: number): HoldingMonitorEvent[] {
  const offset = (page - 1) * pageSize
  return events.slice(offset, offset + pageSize)
}

export function titleParts(title: string): { text: string; sentiment: NewsSentiment }[] {
  const sentiment = sentimentForTitle(title)
  if (sentiment === 'neutral') return [{ text: title, sentiment }]
  return title.split(/(\d+(?:\.\d+)?%)/g).filter(Boolean).map((text) => ({
    text,
    sentiment: /\d+(?:\.\d+)?%/.test(text) ? sentiment : 'neutral',
  }))
}
