import { describe, expect, it } from 'vitest'
import { filterNewsEvents, pageCount, pagedEvents, sentimentForTitle, titleParts } from './monitorFeed'
import type { HoldingMonitorEvent } from './holdingMonitor'

const events: HoldingMonitorEvent[] = [
  { id: 'one', ticker: 'TCS', kind: 'news', title: 'TCS is down 12% today', source: 'News', sourceUrl: 'https://example.test/one', publishedAt: 2, official: false },
  { id: 'two', ticker: 'RELIANCE', kind: 'news', title: 'Reliance rises after earnings beat', source: 'News', sourceUrl: 'https://example.test/two', publishedAt: 3, official: false },
  { id: 'three', ticker: 'TCS', kind: 'news', title: 'TCS names new director', source: 'News', sourceUrl: 'https://example.test/three', publishedAt: 1, official: false },
]

describe('monitor feed', () => {
  it('filters known holdings and sentiment, then sorts locally', () => {
    expect(filterNewsEvents(events, { query: '', ticker: 'TCS', sentiment: 'negative', sort: 'latest' }).map((event) => event.id)).toEqual(['one'])
    expect(filterNewsEvents(events, { query: '', ticker: 'all', sentiment: 'all', sort: 'company' }).map((event) => event.ticker)).toEqual(['RELIANCE', 'TCS', 'TCS'])
  })

  it('classifies and highlights a directional percentage', () => {
    expect(sentimentForTitle('TCS is down 12% today')).toBe('negative')
    expect(titleParts('TCS is down 12% today')).toContainEqual({ text: '12%', sentiment: 'negative' })
  })

  it('keeps page boundaries stable', () => {
    expect(pageCount(26, 25)).toBe(2)
    expect(pagedEvents(events, 2, 2).map((event) => event.id)).toEqual(['three'])
  })
})
