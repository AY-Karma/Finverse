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

  it('emphasizes a share movement figure while keeping the sentence neutral and intact', () => {
    expect(sentimentForTitle('TCS is down 12% today')).toBe('negative')
    const title = 'TCS shares are down 12% today'
    const parts = titleParts(title)
    expect(parts).toEqual([
      { text: 'TCS shares are down ', sentiment: 'neutral' },
      { text: '12%', sentiment: 'negative', highlighted: true },
      { text: ' today', sentiment: 'neutral' },
    ])
    expect(parts.map((part) => part.text).join('')).toBe(title)
  })

  it('highlights signed price and impact figures and leaves deal values neutral', () => {
    const title = 'TCS shares up +1.25%, impact +₹1,768; Infosys shares down −₹1,437.50; ₹5 crore deal'
    const parts = titleParts(title)
    expect(parts.map((part) => part.text).join('')).toBe(title)
    expect(parts).toContainEqual({ text: '+1.25%', sentiment: 'positive', highlighted: true })
    expect(parts).toContainEqual({ text: '+₹1,768', sentiment: 'positive', highlighted: true })
    expect(parts).toContainEqual({ text: '−₹1,437.50', sentiment: 'negative', highlighted: true })
    expect(parts).toContainEqual({ text: '₹5 crore', sentiment: 'neutral', highlighted: true })
  })

  it('keeps operating figures neutral and preserves ordinary headline text', () => {
    expect(titleParts('Revenue up 5%, profit down 2%').filter((part) => part.text.endsWith('%')).every((part) => part.sentiment === 'neutral')).toBe(true)
    expect(titleParts('TCS shares rise as revenue grows 10%')).toContainEqual({ text: '10%', sentiment: 'neutral', highlighted: true })
    expect(titleParts('TCS shares revenue up 10%')).toContainEqual({ text: '10%', sentiment: 'neutral', highlighted: true })
    expect(titleParts('Forecast returns of 5%-7%').filter((part) => part.highlighted).every((part) => part.sentiment === 'neutral')).toBe(true)
    expect(titleParts('TCS names new director')).toEqual([{ text: 'TCS names new director', sentiment: 'neutral' }])
  })

  it('associates each share move with its local direction in mixed news', () => {
    const parts = titleParts('TCS shares gain 1.25%, HDFC Bank shares down 0.86%, profit down 2%')
    expect(parts.filter((part) => part.highlighted)).toEqual([
      { text: '1.25%', sentiment: 'positive', highlighted: true },
      { text: '0.86%', sentiment: 'negative', highlighted: true },
      { text: '2%', sentiment: 'neutral', highlighted: true },
    ])
  })

  it('keeps signed operating figures neutral beside an actual share-price move', () => {
    for (const title of [
      'TCS revenue -2%, profit +5% in latest quarter',
      'Revenue: −₹500, profit +₹250',
      'TCS profits -2%, revenues +5% in latest quarter',
      'TCS reports -2% revenue growth',
      'TCS Q2 PAT +5%',
      'A +₹5 crore contract and an unspecified -2% figure',
    ]) {
      const parts = titleParts(title)
      expect(parts.map((part) => part.text).join('')).toBe(title)
      expect(parts.filter((part) => part.highlighted).every((part) => part.sentiment === 'neutral')).toBe(true)
    }
    expect(titleParts('TCS shares gain +1.25% as revenue falls -2%').filter((part) => part.highlighted)).toEqual([
      { text: '+1.25%', sentiment: 'positive', highlighted: true },
      { text: '-2%', sentiment: 'neutral', highlighted: true },
    ])
    expect(titleParts('Profit misses estimates as shares fall -3%')).toContainEqual({ text: '-3%', sentiment: 'negative', highlighted: true })
  })

  it('handles explicitly reported price movements and sign formats without coloring generic keywords', () => {
    expect(titleParts('Share price rose by nearly 2.5%')).toContainEqual({ text: '2.5%', sentiment: 'positive', highlighted: true })
    expect(titleParts('Stock is trading down 0.8%')).toContainEqual({ text: '0.8%', sentiment: 'negative', highlighted: true })
    expect(titleParts('Impact USD -500, +₹250, and a Rs. 5 crore contract').filter((part) => part.highlighted)).toEqual([
      { text: 'USD -500', sentiment: 'negative', highlighted: true },
      { text: '+₹250', sentiment: 'neutral', highlighted: true },
      { text: 'Rs. 5 crore', sentiment: 'neutral', highlighted: true },
    ])
    expect(titleParts('Earnings beat expectations after cost cuts')).toEqual([{ text: 'Earnings beat expectations after cost cuts', sentiment: 'neutral' }])
  })

  it('keeps page boundaries stable', () => {
    expect(pageCount(26, 25)).toBe(2)
    expect(pagedEvents(events, 2, 3).map((event) => event.id)).toEqual(['four'])
  })
})
