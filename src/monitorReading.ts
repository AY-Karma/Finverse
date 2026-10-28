import type { NewsItem, NewsRegion } from './marketNews'

export interface ArticleReading {
  key: string
  seenAt: number
  openedAt?: number
  savedAt?: number
  dismissedAt?: number
  item: NewsItem
}
export interface NewsFollow { id: string; query: string; region: NewsRegion }
export interface MonitorReadingState { articles: ArticleReading[]; follows: NewsFollow[] }
export interface NewsGroup { key: string; item: NewsItem; sources: NewsItem[] }
export const MAX_READING_ARTICLES = 500
export const MAX_NEWS_FOLLOWS = 30

export function emptyMonitorReadingState(): MonitorReadingState { return { articles: [], follows: [] } }

export function canonicalNewsUrl(value: string): string {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid article link.')
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key)
  }
  url.searchParams.sort()
  return url.toString()
}

function normalizedTitle(title: string): string { return title.trim().replace(/\s+/g, ' ').toLowerCase() }

export function newsReadingKey(item: NewsItem): string {
  const day = item.publishedAt == null ? canonicalNewsUrl(item.sourceUrl) : new Date(item.publishedAt).toISOString().slice(0, 10)
  return `${normalizedTitle(item.title)}|${day}`
}

export function groupNewsItems(items: NewsItem[]): NewsGroup[] {
  const groups: NewsGroup[] = []
  const byUrl = new Map<string, NewsGroup>()
  const byHeadline = new Map<string, NewsGroup>()
  for (const item of [...items].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))) {
    let url: string
    try { url = canonicalNewsUrl(item.sourceUrl) } catch { continue }
    const key = newsReadingKey(item)
    const group = byUrl.get(url) ?? byHeadline.get(key)
    if (group) {
      if (!group.sources.some((source) => canonicalNewsUrl(source.sourceUrl) === url)) group.sources.push(item)
      group.item = { ...group.item, matches: [...new Set([...group.item.matches, ...item.matches])] }
      byUrl.set(url, group)
      byHeadline.set(key, group)
    } else {
      const next = { key, item, sources: [item] }
      groups.push(next)
      byUrl.set(url, next)
      byHeadline.set(key, next)
    }
  }
  return groups
}

export function rememberArticles(state: MonitorReadingState, items: NewsItem[], now: number): MonitorReadingState {
  const known = new Set(state.articles.map((article) => article.key))
  const unseen = groupNewsItems(items).filter((group) => !known.has(group.key)).map((group) => ({ key: group.key, seenAt: now, item: group.item }))
  return unseen.length ? { ...state, articles: boundArticles([...state.articles, ...unseen]) } : state
}

function boundArticles(articles: ArticleReading[]): ArticleReading[] {
  return [...articles].sort((a, b) => Number(Boolean(b.savedAt)) - Number(Boolean(a.savedAt)) || b.seenAt - a.seenAt).slice(0, MAX_READING_ARTICLES)
}

export function updateArticleReading(state: MonitorReadingState, item: NewsItem, patch: Partial<Pick<ArticleReading, 'openedAt' | 'savedAt' | 'dismissedAt'>>, now = Date.now()): MonitorReadingState {
  const key = newsReadingKey(item)
  const previous = state.articles.find((article) => article.key === key)
  const article = { ...previous, key, seenAt: previous?.seenAt ?? now, item, ...patch }
  return { ...state, articles: boundArticles([...state.articles.filter((row) => row.key !== key), article]) }
}

export function parseMonitorReadingState(value: unknown): MonitorReadingState {
  if (value === undefined) return emptyMonitorReadingState()
  const fail = (): never => { throw new Error('Saved news preferences are invalid.') }
  const object = (row: unknown): Record<string, unknown> => !row || typeof row !== 'object' || Array.isArray(row) ? fail() : row as Record<string, unknown>
  const text = (row: unknown, maximum: number): string => typeof row !== 'string' || !row.trim() || row.length > maximum ? fail() : row
  const timestamp = (row: unknown): number => typeof row !== 'number' || !Number.isFinite(row) || row < 0 || row > 8_640_000_000_000_000 ? fail() : row
  const list = (row: unknown, maximum: number): unknown[] => !Array.isArray(row) || row.length > maximum ? fail() : row
  const root = object(value)
  const articles = list(root.articles, MAX_READING_ARTICLES).map((raw): ArticleReading => {
    const row = object(raw)
    const snapshot = object(row.item)
    const item: NewsItem = {
      id: text(snapshot.id, 2500), title: text(snapshot.title, 1000), source: text(snapshot.source, 200),
      sourceUrl: text(snapshot.sourceUrl, 2500), origin: snapshot.origin === 'wire' || snapshot.origin === 'search' ? snapshot.origin : fail(),
      matches: list(snapshot.matches, 100).map((match) => text(match, 120)),
      ...(snapshot.publishedAt === undefined ? {} : { publishedAt: timestamp(snapshot.publishedAt) }),
    }
    try { canonicalNewsUrl(item.sourceUrl) } catch { return fail() }
    const result: ArticleReading = { key: text(row.key, 4000), seenAt: timestamp(row.seenAt), item }
    if (result.key !== newsReadingKey(item)) return fail()
    for (const field of ['openedAt', 'savedAt', 'dismissedAt'] as const) if (row[field] !== undefined) result[field] = timestamp(row[field])
    return result
  })
  const follows = list(root.follows, MAX_NEWS_FOLLOWS).map((raw): NewsFollow => {
    const row = object(raw)
    const region = row.region === 'IN' || row.region === 'US' || row.region === 'GB' ? row.region : fail()
    return { id: text(row.id, 200), query: text(row.query, 120), region }
  })
  if (new Set(articles.map((row) => row.key)).size !== articles.length || new Set(follows.map((row) => row.id)).size !== follows.length || new Set(follows.map((row) => `${row.region}:${row.query.trim().toLowerCase()}`)).size !== follows.length) return fail()
  return { articles, follows }
}
