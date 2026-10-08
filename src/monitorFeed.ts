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

export function titleParts(title: string): { text: string; sentiment: NewsSentiment; highlighted?: boolean }[] {
  const amounts = /(?<!\w)[+−-]?(?:₹|Rs\.?|INR|USD|\$|£|€)\s*[+−-]?\d+(?:,\d+)*(?:\.\d+)?(?:\s*(?:crore|cr|lakh|million|billion|bn)\b)?|(?<!\w)[+−-]?\d+(?:,\d+)*(?:\.\d+)?%/gi
  const shareMove = /\b(?:shares?|stock|share price|stock price)\s+(?:(?:is|are|was|were)\s+)?(?:(?:trades?|traded|trading)\s+)?(up|down|gains?|gained|rises?|rose|risen|jumps?|jumped|surges?|surged|rally|rallies|rallied|soars?|soared|falls?|fell|fallen|drops?|dropped|plunges?|plunged|declines?|declined|slumps?|slumped|tumbles?|tumbled)\s+(?:by\s+)?(?:(?:about|nearly|almost|over)\s+)?$/i
  const upwardMove = /^(up|gain|rise|rose|risen|jump|surge|rall|soar)/i
  const parts: ReturnType<typeof titleParts> = []
  let offset = 0
  for (const match of title.matchAll(amounts)) {
    if (match.index > offset) parts.push({ text: title.slice(offset, match.index), sentiment: 'neutral' })
    const text = match[0]
    let sentiment: NewsSentiment = 'neutral'
    const followsRange = /^[−-]/.test(text) && /[\d%]$/.test(title.slice(0, match.index))
    if (/[−-]/.test(text) && !followsRange) sentiment = 'negative'
    else if (text.includes('+')) sentiment = 'positive'
    else if (text.endsWith('%')) {
      const direction = title.slice(0, match.index).match(shareMove)?.[1]
      if (direction) sentiment = upwardMove.test(direction) ? 'positive' : 'negative'
    }
    parts.push({ text, sentiment, highlighted: true })
    offset = match.index + text.length
  }
  if (offset < title.length) parts.push({ text: title.slice(offset), sentiment: 'neutral' })
  return parts.length ? parts : [{ text: title, sentiment: 'neutral' }]
}
