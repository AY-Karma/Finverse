import { describe, expect, it } from 'vitest'
import { filterNewsEvents, pageCount, pagedEvents, sentimentForTitle, titleParts } from './monitorFeed'
import type { NewsItem } from './marketNews'

const item = (overrides: Partial<NewsItem>): NewsItem => ({
  id: overrides.id ?? 'x',
  title: '',
  source: 'News',
  sourceUrl: 'https://example.test',
  publishedAt: 0,
  matches: [],
  origin: 'wire',
  ...overrides,
})

const events: NewsItem[] = [
  item({ id: 'one', title: 'TCS is down 12% today', publishedAt: 2, matches: ['TCS'] }),
  item({ id: 'two', title: 'Reliance rises after earnings beat', publishedAt: 3, matches: ['RELIANCE'] }),
  item({ id: 'three', title: 'TCS names new director', publishedAt: 1, matches: ['TCS'] }),
  item({ id: 'four', title: 'Rupee steadies against the dollar', publishedAt: 4, matches: [] }),
]

describe('monitor feed', () => {
  it('filters by matched holding and sentiment, then sorts locally', () => {
    expect(filterNewsEvents(events, { query: '', ticker: 'TCS', sentiment: 'negative', sort: 'latest' }).map((event) => event.id)).toEqual(['one'])
    expect(filterNewsEvents(events, { query: '', ticker: 'all', sentiment: 'all', sort: 'company' }).map((event) => event.id)).toEqual(['four', 'two', 'one', 'three'])
  })

  it('keeps market-wide wire stories when no holding filter is active but drops them for a holding view', () => {
    expect(filterNewsEvents(events, { query: '', ticker: 'all', sentiment: 'all', sort: 'latest' }).map((event) => event.id)).toEqual(['four', 'two', 'one', 'three'])
    expect(filterNewsEvents(events, { query: '', ticker: 'RELIANCE', sentiment: 'all', sort: 'latest' }).map((event) => event.id)).toEqual(['two'])
  })

  it('matches the search text against tickers, headlines and publishers', () => {
    expect(filterNewsEvents(events, { query: 'tcs', ticker: 'all', sentiment: 'all', sort: 'latest' }).map((event) => event.id)).toEqual(['one', 'three'])
    expect(filterNewsEvents(events, { query: 'rupee', ticker: 'all', sentiment: 'all', sort: 'latest' }).map((event) => event.id)).toEqual(['four'])
    expect(filterNewsEvents(events, { query: 'reliance', ticker: 'all', sentiment: 'all', sort: 'latest' }).map((event) => event.id)).toEqual(['two'])
  })

  it('classifies and highlights a directional percentage', () => {
    expect(sentimentForTitle('TCS is down 12% today')).toBe('negative')
    expect(titleParts('TCS is down 12% today')).toContainEqual({ text: '12%', sentiment: 'negative' })
  })

  it('keeps page boundaries stable', () => {
    expect(pageCount(26, 25)).toBe(2)
    expect(pagedEvents(events, 2, 3).map((event) => event.id)).toEqual(['four'])
  })
})
