import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarketBriefingLoader, rankMarketBriefing, selectRecapNews } from './marketBriefing'
import type { NewsItem } from './marketNews'
import type { Position } from './types'

const now = Date.parse('2026-11-06T12:00:00Z')
const period = { from: '2026-11-01', through: '2026-11-06' }
const item = (title: string, patch: Partial<NewsItem> = {}): NewsItem => ({
  id: title, title, source: 'Reuters', sourceUrl: `https://news.test/${encodeURIComponent(title)}`,
  publishedAt: now - 3_600_000, matches: [], origin: 'wire', ...patch,
})
const holding: Position = { id: 'tcs', ticker: 'TCS', name: 'Tata Consultancy Services', type: 'stock', quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100 }
const feed = (title = 'RBI raises repo rate to 6 percent') => `<rss><channel><item><title>${title}</title><link>https://publisher.test/news</link><source>Publisher</source><pubDate>${new Date(now - 3_600_000).toUTCString()}</pubDate></item></channel></rss>`

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('market briefing ranking', () => {
  it('selects the leading story from every month week, including the final partial week, oldest first', () => {
    const options = { from: '2026-10-01', through: '2026-10-31', ranking: 'recap' as const, cadence: 'monthly' as const }
    const rows = [29, 22, 15, 8, 1].flatMap((day, week) => [
      item(`Global stocks rally after economic release ${week}`, { publishedAt: Date.parse(`2026-10-${String(day).padStart(2, '0')}T08:00:00Z`) }),
      item(`Shares of local company report quarterly earnings ${week}`, { publishedAt: Date.parse(`2026-10-${String(day + 1).padStart(2, '0')}T08:00:00Z`) }),
    ])
    const selected = selectRecapNews(rankMarketBriefing(rows, options), options)
    expect(selected).toHaveLength(5)
    expect(selected.map((story) => new Date(story.publishedAt).getUTCDate())).toEqual([1, 8, 15, 22, 29])
    expect(selected.every((story) => story.title.startsWith('Global stocks'))).toBe(true)
  })

  it('balances weekly news across early, middle and late days before sorting by publication time', () => {
    const options = { from: '2026-11-02', through: '2026-11-06', ranking: 'recap' as const, cadence: 'weekly' as const }
    const stories = rankMarketBriefing([2, 3, 4, 5, 6].map((day) => item(`Global stocks rally after market development ${day}`, { publishedAt: Date.parse(`2026-11-0${day}T08:00:00Z`) })), options)
      .map((story) => ({ ...story, score: new Date(story.publishedAt).getUTCDate() === 3 ? 100 : 1 }))
    const selected = selectRecapNews(stories, options)
    expect(selected.map((story) => new Date(story.publishedAt).getUTCDate())).toEqual([3, 4, 6])
  })

  it('fills sparse timelines with other important stories without repeating an event or crossing period bounds', () => {
    const options = { ...period, ranking: 'recap' as const, cadence: 'weekly' as const }
    const stories = rankMarketBriefing([
      item('RBI raises repo rate to 6 percent'),
      item('China stocks plunge after weak property data'),
      item('Gold prices climb after dollar falls'),
    ], options)
    const outside = { ...stories[0], id: 'outside', sourceUrl: 'https://outside.test', publishedAt: Date.parse('2026-10-30T08:00:00Z'), score: 100 }
    const selected = selectRecapNews([...stories, stories[0], outside], options)
    expect(selected).toHaveLength(3)
    expect(new Set(selected.map((story) => story.id)).size).toBe(3)
    expect(selected.some((story) => story.id === 'outside')).toBe(false)
    expect(selectRecapNews(stories, options, 0)).toEqual([])
  })

  it('gives recap market impact and publisher coverage modest weight without personal or freshness boosts', () => {
    const options = { ...period, ranking: 'recap' as const, cadence: 'weekly' as const, positions: [holding] }
    const stories = rankMarketBriefing([
      item('TCS quarterly earnings exceed analyst expectations'),
      item('Global stocks plunge as bond yields surge'),
      item('Global stocks plunge as bond yields surge', { source: 'Another publisher', sourceUrl: 'https://other.test/markets' }),
    ], options)
    expect(stories[0]).toMatchObject({ title: 'Global stocks plunge as bond yields surge', coverage: 2, matches: [] })
  })

  it('excludes political commentary and bank notices from recaps while retaining market reactions and economic releases', () => {
    const rejected = [
      'How Tariffs Became the Most Hated Word in Politics',
      'US midterm election results vindicate Alberta approach on tariffs',
      'Inflation dominates the presidential election campaign',
      'Bank holidays next week: check the RBI calendar for branch closures',
      'RBI responds to allegations raised in parliament',
    ]
    const accepted = [
      'China stocks plunge after property stimulus disappoints markets',
      'Global stocks slide as bond yields rise',
      'Nikkei rallies as exporters benefit from weaker yen',
      'Hang Seng plunges after disappointing stimulus announcement',
      'RBI raises repo rate to 6 percent',
      'US inflation cools to 2.1% in September report',
      'Stocks rally as election results ease tariff uncertainty',
      'ECB holds interest rates unchanged',
    ]
    const result = rankMarketBriefing([...rejected, ...accepted].map((title) => item(title)), { ...period, ranking: 'google' })
    expect(result.map((story) => story.title)).toEqual(accepted)
  })

  it('preserves Google recap order without freshness, coverage or holding boosts', () => {
    const rows = [
      item('TCS quarterly profit rises 12% on strong demand', { publishedAt: Date.parse('2026-10-03T10:00:00Z') }),
      item('RBI raises repo rate as inflation accelerates', { publishedAt: Date.parse('2026-10-30T10:00:00Z') }),
      item('TCS quarterly profit rises 12% on strong demand', { source: 'Financial Times', sourceUrl: 'https://ft.test/tcs', publishedAt: Date.parse('2026-10-04T10:00:00Z') }),
    ]
    const options = { from: '2026-10-01', through: '2026-10-31', positions: [holding] }
    const recap = rankMarketBriefing(rows, { ...options, ranking: 'google' })
    expect(recap.map((story) => story.title)).toEqual([rows[0].title, rows[1].title])
    expect(recap[0]).toMatchObject({ sourceUrl: rows[0].sourceUrl, publishedAt: rows[0].publishedAt, coverage: 2, score: 0, matches: [] })
    expect(rankMarketBriefing(rows, options)[0].title).toBe(rows[1].title)
  })

  it('keeps date and link checks when preserving the provider order', () => {
    const rows = [
      item('China stocks fall amid economic slowdown', { publishedAt: Date.parse('2026-10-31T10:00:00Z') }),
      item('Crude oil prices surge after supply disruption', { sourceUrl: 'javascript:alert(1)' }),
      item('RBI raises repo rate as inflation accelerates'),
      item('Indian GDP growth slows in latest quarter', { publishedAt: now - 2 * 86_400_000 }),
    ]
    const recap = rankMarketBriefing(rows, { ...period, ranking: 'google' })
    expect(recap.map((story) => story.title)).toEqual([rows[2].title, rows[3].title])
  })

  it('groups duplicate events across publishers without counting duplicate feeds as traction', () => {
    const result = rankMarketBriefing([
      item('RBI raises repo rate to 6 percent - Reuters'),
      item('RBI hikes repo rate to 6 percent', { source: 'Financial Times', sourceUrl: 'https://ft.test/rbi' }),
      item('RBI raises repo rate to 6 percent', { source: 'Reuters', sourceUrl: 'https://reuters.test/rbi' }),
    ], period)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ title: 'RBI raises repo rate to 6 percent', coverage: 2, topic: 'policy', region: 'India' })
  })

  it('does not combine opposite rate decisions or the same event weeks apart', () => {
    const result = rankMarketBriefing([
      item('RBI raises repo rate to 6 percent'),
      item('RBI cuts repo rate to 6 percent', { sourceUrl: 'https://other.test/cut' }),
      item('RBI raises repo rate to 6 percent', { sourceUrl: 'https://other.test/older', publishedAt: Date.parse('2026-10-10T10:00:00Z') }),
    ], { from: '2026-10-01', through: '2026-11-06' })
    expect(result).toHaveLength(3)
  })

  it('keeps different issuers and different policy figures separate instead of inflating coverage', () => {
    const result = rankMarketBriefing([
      item('TCS quarterly profit rises 12% on strong demand'),
      item('Infosys quarterly profit rises 12% on strong demand', { source: 'Financial Times', sourceUrl: 'https://ft.test/infosys' }),
      item('RBI raises repo rate to 6 percent'),
      item('RBI raises repo rate to 7 percent', { sourceUrl: 'https://other.test/rbi' }),
    ], period)
    expect(result).toHaveLength(4)
    expect(result.every((story) => story.coverage === 1)).toBe(true)
  })

  it('includes global and China events and lets story count grow beyond five without padding', () => {
    const titles = [
      'RBI raises repo rate as inflation accelerates', 'China stocks slump as technology index drops',
      'Wall Street stocks rise after Federal Reserve decision', 'Crude oil surges on supply disruptions',
      'Indian GDP growth slows in latest quarter', 'Nifty reaches record as banking stocks rally',
      'TCS quarterly earnings exceed analyst expectations', 'European stocks retreat after tariff announcement',
    ]
    const result = rankMarketBriefing(titles.map((title, i) => item(title, { sourceUrl: `https://news.test/${i}` })), period)
    expect(result.length).toBeGreaterThan(5)
    expect(result.length).toBeLessThanOrEqual(titles.length)
    expect(result.some((story) => story.topic === 'china')).toBe(true)
    expect(result.some((story) => story.region === 'Global')).toBe(true)
    expect(rankMarketBriefing([item(titles[0])], period)).toHaveLength(1)
    expect(rankMarketBriefing([], period)).toEqual([])
  })

  it('uses the strength of coverage to omit lower-attention stories while preserving global context', () => {
    const major = Array.from({ length: 10 }, (_, index) => item('RBI raises repo rate after inflation shock', { source: `Publisher ${index}`, sourceUrl: `https://publisher${index}.test/rbi` }))
    const result = rankMarketBriefing([...major,
      item('Canadian stocks trade flat as investors await economic data'),
      item('Australian stocks trade sideways as mining shares settle'),
      item('Swiss stocks trade flat as banks hold steady'),
    ], period)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ topic: 'policy', coverage: 10 })
    expect(result[1].region).toBe('Global')
  })

  it('filters tips, unknown dates, future publications, unsafe links and unrelated headlines', () => {
    const rows = [
      item('Ten best stocks to buy before Diwali'), item('RBI raises interest rates', { publishedAt: undefined }),
      item('China stocks rise on stimulus', { publishedAt: now + 1 }), item('Oil prices fall sharply', { sourceUrl: 'javascript:alert(1)' }),
      item('Gold prices rise on economic fears', { sourceUrl: 'https://name:secret@news.test/story' }),
      item('Regional festival begins with music performances'), item('Nifty rises on earnings', { publishedAt: now - 20 * 86_400_000 }),
    ]
    expect(rankMarketBriefing(rows, period)).toEqual([])
  })

  it('respects complete month and India-midnight boundaries instead of a rolling fourteen-day cutoff', () => {
    const start = Date.parse('2026-10-01T00:00:00+05:30')
    const end = Date.parse('2026-11-01T00:00:00+05:30')
    const result = rankMarketBriefing([
      item('Indian stocks rise on strong earnings', { publishedAt: start }),
      item('China stocks fall amid economic slowdown', { publishedAt: end - 1, sourceUrl: 'https://news.test/china' }),
      item('RBI repo rate decision lifts markets', { publishedAt: start - 1, sourceUrl: 'https://news.test/early' }),
      item('Oil price jump unsettles stock markets', { publishedAt: end, sourceUrl: 'https://news.test/late' }),
    ], { from: '2026-10-01', through: '2026-10-31' })
    expect(result).toHaveLength(2)
    expect(result.map((story) => story.publishedAt).sort()).toEqual([start, end - 1].sort())
  })

  it('rejects invalid calendar dates and retains financial materiality when ranking coverage', () => {
    expect(rankMarketBriefing([item('RBI repo rate decision moves markets')], { from: '2026-02-30', through: '2026-03-04' })).toEqual([])
    const result = rankMarketBriefing([
      item('Indian markets trade sideways as banks hold steady'),
      item('RBI raises repo rate as inflation accelerates', { sourceUrl: 'https://rbi.test/one' }),
      item('RBI raises repo rate as inflation accelerates', { source: 'Bloomberg', sourceUrl: 'https://bloomberg.test/one' }),
    ], period)
    expect(result[0]).toMatchObject({ topic: 'policy', coverage: 2 })
  })
})

describe('market briefing loading', () => {
  it('queries each monthly week, enforces exact bucket dates, and preserves cache and bounded concurrency', async () => {
    let active = 0
    let maximum = 0
    const fetcher = vi.fn(async (url: string) => {
      maximum = Math.max(maximum, ++active)
      const from = new URL(url, 'https://finverse.test').searchParams.get('from')!
      await Promise.resolve()
      active--
      return `<rss><channel><item><title>Global stocks rally after economic release</title><link>https://publisher.test/${from}</link><source>Publisher</source><pubDate>${new Date(`${from}T08:00:00Z`).toUTCString()}</pubDate></item><item><title>Nasdaq rises outside the queried week</title><link>https://publisher.test/outside</link><source>Publisher</source><pubDate>Fri, 06 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>`
    })
    const load = createMarketBriefingLoader(fetcher)
    const options = { from: '2026-10-01', through: '2026-10-31', ranking: 'recap' as const, cadence: 'monthly' as const }
    const result = await load(options)
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(maximum).toBeLessThanOrEqual(2)
    expect(fetcher.mock.calls.map(([url]) => {
      const params = new URL(url, 'https://finverse.test').searchParams
      return [params.get('from'), params.get('through')]
    })).toEqual([['2026-10-01', '2026-10-07'], ['2026-10-08', '2026-10-14'], ['2026-10-15', '2026-10-21'], ['2026-10-22', '2026-10-28'], ['2026-10-29', '2026-10-31']])
    expect(result.items).toHaveLength(5)
    expect(result.items.every((story) => story.publishedAt < Date.parse('2026-11-01T00:00:00+05:30'))).toBe(true)
    expect(await load(options)).toEqual(result)
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it('queries weekly days and identifies a failed window without dropping other days', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const from = new URL(url, 'https://finverse.test').searchParams.get('from')!
      if (from === '2026-11-04') throw new Error('Offline')
      return `<rss><channel><item><title>Global stocks rally after economic release ${from}</title><link>https://publisher.test/${from}</link><source>Publisher</source><pubDate>${new Date(`${from}T08:00:00Z`).toUTCString()}</pubDate></item></channel></rss>`
    })
    const result = await createMarketBriefingLoader(fetcher)({ from: '2026-11-02', through: '2026-11-06', ranking: 'recap', cadence: 'weekly' })
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(result.issues).toEqual(['2026-11-04 news is unavailable.'])
    expect(selectRecapNews(result.items, { from: '2026-11-02', through: '2026-11-06', cadence: 'weekly' })).toHaveLength(3)
  })

  it('fetches one Google-ordered recap feed and keeps its cache separate from News ranking', async () => {
    const fetcher = vi.fn(async (_url: string) => feed())
    const load = createMarketBriefingLoader(fetcher)
    const recap = await load({ ...period, ranking: 'google' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(new URL(fetcher.mock.calls[0][0], 'https://finverse.test').searchParams.get('topic')).toBe('recap')
    expect(recap.items[0].score).toBe(0)
    const news = await load(period)
    expect(fetcher).toHaveBeenCalledTimes(6)
    expect(news.items[0].score).toBeGreaterThan(0)
    expect(await load({ ...period, ranking: 'google' })).toEqual(recap)
    await load(period)
    expect(fetcher).toHaveBeenCalledTimes(6)
  })

  it('loads fixed topics with bounded concurrency and caches raw news independently of personal matches', async () => {
    let active = 0
    let maximum = 0
    const fetcher = vi.fn(async (_url: string, _signal?: AbortSignal) => {
      maximum = Math.max(maximum, ++active)
      await Promise.resolve()
      active--
      return feed('TCS quarterly earnings exceed analyst expectations')
    })
    const load = createMarketBriefingLoader(fetcher)
    const personal = await load({ ...period, positions: [holding] })
    expect(personal.items[0].matches).toEqual(['TCS'])
    const masked = await load(period)
    expect(masked.items[0].matches).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(maximum).toBeLessThanOrEqual(2)
    expect(fetcher.mock.calls.every(([url]) => !url.includes('TCS') && !url.includes('Tata'))).toBe(true)
    await load({ ...period, forceRefresh: true })
    expect(fetcher).toHaveBeenCalledTimes(10)
  })

  it('reports partial source failures while retaining available stories', async () => {
    const load = createMarketBriefingLoader(async (url) => {
      if (url.includes('topic=china')) throw new Error('Offline')
      return feed()
    })
    const result = await load(period)
    expect(result.items).toHaveLength(1)
    expect(result.issues).toEqual(['China news is unavailable.'])
  })

  it('keeps complete failures retryable and never invents fallback headlines', async () => {
    const fetcher = vi.fn(async () => { throw new Error('Offline') })
    const load = createMarketBriefingLoader(fetcher)
    expect((await load(period)).items).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect((await load(period)).issues).toHaveLength(5)
    expect(fetcher).toHaveBeenCalledTimes(10)
  })

  it('does not cache aborted partial loads', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async () => { controller.abort(); return feed() })
    const load = createMarketBriefingLoader(fetcher)
    await expect(load({ ...period, signal: controller.signal })).rejects.toThrow()
    const firstCalls = fetcher.mock.calls.length
    fetcher.mockImplementation(async () => feed())
    expect((await load(period)).items).toHaveLength(1)
    expect(fetcher.mock.calls.length).toBe(firstCalls + 5)
  })
})
