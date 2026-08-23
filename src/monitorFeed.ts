import type { NewsItem } from './marketNews'

export type NewsSentiment = 'positive' | 'negative' | 'neutral'
type NewsSort = 'latest' | 'company'

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

/** Filters and orders the in-memory feed only. No holding data leaves the browser. */
export function filterNewsEvents(events: NewsItem[], filters: NewsFeedFilters): NewsItem[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return [...events]
    .filter((event) => {
      if (filters.ticker !== 'all' && !event.matches.includes(filters.ticker)) return false
      if (filters.sentiment !== 'all' && sentimentForTitle(event.title) !== filters.sentiment) return false
      return !query || `${event.matches.join(' ')} ${event.title} ${event.source}`.toLocaleLowerCase().includes(query)
    })
    .sort((left, right) => {
      if (filters.sort === 'company') {
        const companyOrder = (left.matches[0] ?? '').localeCompare(right.matches[0] ?? '')
        if (companyOrder !== 0) return companyOrder
      }
      return (right.publishedAt ?? 0) - (left.publishedAt ?? 0)
    })
}

export function pageCount(itemCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(itemCount / pageSize))
}

export function pagedEvents(events: NewsItem[], page: number, pageSize: number): NewsItem[] {
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
