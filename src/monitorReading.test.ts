import { describe, expect, it } from 'vitest'
import type { NewsItem } from './marketNews'
import { canonicalNewsUrl, emptyMonitorReadingState, groupNewsItems, MAX_READING_ARTICLES, newsReadingKey, parseMonitorReadingState, rememberArticles, updateArticleReading } from './monitorReading'

const article = (patch: Partial<NewsItem> = {}): NewsItem => ({ id: 'wire:1', title: 'Company reports revenue growth', source: 'Publisher A', sourceUrl: 'https://example.com/article', publishedAt: Date.UTC(2026, 9, 27, 10), origin: 'wire', matches: ['COMPANY'], ...patch })

describe('Monitor reading state', () => {
  it('preserves article state across serialization and changing transport IDs', () => {
    const item = article()
    let state = rememberArticles(emptyMonitorReadingState(), [item], 10)
    state = updateArticleReading(state, item, { openedAt: 11, savedAt: 12, dismissedAt: 13 })
    const restored = parseMonitorReadingState(JSON.parse(JSON.stringify(state)))
    expect(restored.articles[0]).toEqual({ key: newsReadingKey(item), seenAt: 10, openedAt: 11, savedAt: 12, dismissedAt: 13, item })
    expect(newsReadingKey(article({ id: 'search:changed' }))).toBe(restored.articles[0].key)
    expect(rememberArticles(restored, [item], 20)).toBe(restored)
  })

  it('groups only matching headlines on the same date or copies of one URL', () => {
    const groups = groupNewsItems([
      article(),
      article({ id: 'other', title: '  Company reports revenue growth ', source: 'Publisher B', sourceUrl: 'https://other.example/story', publishedAt: Date.UTC(2026, 9, 27, 9) }),
      article({ id: 'different-number', title: 'Company reports revenue growth of 2%', sourceUrl: 'https://example.com/number' }),
      article({ id: 'different-day', sourceUrl: 'https://example.com/yesterday', publishedAt: Date.UTC(2026, 9, 26, 10) }),
      article({ id: 'tracking-copy', sourceUrl: 'https://example.com/article?utm_source=wire#top' }),
    ])
    expect(groups).toHaveLength(3)
    expect(groups[0].sources.map((source) => source.source)).toEqual(['Publisher A', 'Publisher B'])
    expect(groups[0].sources).toHaveLength(2)
  })

  it('retains saved snapshots while bounding reading history', () => {
    const saved = updateArticleReading(emptyMonitorReadingState(), article(), { savedAt: 1 }, 1)
    const state = rememberArticles(saved, Array.from({ length: 600 }, (_, index) => article({ title: `Headline ${index}`, sourceUrl: `https://example.com/${index}` })), 2)
    expect(state.articles).toHaveLength(MAX_READING_ARTICLES)
    expect(state.articles[0].savedAt).toBe(1)
    expect(parseMonitorReadingState(state).articles).toHaveLength(MAX_READING_ARTICLES)
  })

  it('allows undo without losing saved or opened state', () => {
    const item = article()
    const state = updateArticleReading(emptyMonitorReadingState(), item, { savedAt: 1, openedAt: 2, dismissedAt: 3 }, 1)
    const undone = updateArticleReading(state, item, { dismissedAt: undefined }, 4)
    expect(undone.articles[0]).toMatchObject({ seenAt: 1, savedAt: 1, openedAt: 2 })
    expect(undone.articles[0].dismissedAt).toBeUndefined()
  })

  it('rejects unsafe saved links, invalid timestamps, duplicate records and unbounded preferences', () => {
    const state = updateArticleReading(emptyMonitorReadingState(), article(), { savedAt: 1 })
    expect(() => parseMonitorReadingState({ ...state, articles: [...state.articles, ...state.articles] })).toThrow()
    expect(() => parseMonitorReadingState({ ...state, articles: [{ ...state.articles[0], item: article({ sourceUrl: 'javascript:alert(1)' }) }] })).toThrow()
    expect(() => parseMonitorReadingState({ ...state, articles: [{ ...state.articles[0], openedAt: Number.NaN }] })).toThrow()
    expect(() => parseMonitorReadingState({ articles: [], follows: Array.from({ length: 31 }, (_, index) => ({ id: String(index), query: String(index), region: 'IN' })) })).toThrow()
    expect(() => parseMonitorReadingState({ articles: [], follows: [{ id: '1', query: 'Banks', region: 'IN' }, { id: '2', query: 'banks', region: 'IN' }] })).toThrow()
    expect(parseMonitorReadingState(undefined)).toEqual(emptyMonitorReadingState())
  })

  it('removes tracking data while retaining meaningful URL parameters', () => {
    expect(canonicalNewsUrl('https://example.com/story?id=1&utm_source=wire&gclid=tracking#top')).toBe('https://example.com/story?id=1')
    expect(() => canonicalNewsUrl('https://user:password@example.com/story')).toThrow()
  })
})
