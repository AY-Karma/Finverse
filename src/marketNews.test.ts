import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMarketNewsAdapter,
  dedupeItems,
  eligibleHoldings,
  loadMarketFeed,
  matchedTickers,
  rssItems,
  significantNameWords,
  type MarketNewsAdapter,
  type NewsItem,
} from './marketNews'
import type { Position } from './types'

const NOW = Date.parse('2026-08-24T10:00:00Z')
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toUTCString()

const ET_FEED = `<rss version="2.0"><channel><title>Economic Times</title>
<item><title>Markets rally as IT stocks surge 3%</title><link>https://economictimes.test/markets-rally</link><pubDate>${hoursAgo(1)}</pubDate></item>
<item><title><![CDATA[Reliance Industries Q1 profit up 12%]]></title><link>https://economictimes.test/ril-q1</link><pubDate>${hoursAgo(2)}</pubDate></item>
</channel></rss>`

const BS_FEED = `<rss version="2.0"><channel><title>Share Market Today</title>
<item><title>Nifty ends flat in volatile trade</title><link>https://bs.test/nifty-flat</link><pubDate>${hoursAgo(3)}</pubDate></item>
</channel></rss>`

const BING_FEED = `<rss version="2.0"><channel><title>Results</title>
<item><title>Kotak turns cautious on Indian IT, downgrades Infosys &amp; TCS</title><link>https://bing.test/kotak-it</link><pubDate>${hoursAgo(5)}</pubDate><source>TechCircle</source></item>
<item><title>Reliance share price: Morgan Stanley reiterates positive view</title><link>https://bing.test/ms-ril</link><pubDate>${hoursAgo(6)}</pubDate><source><![CDATA[Market Desk]]></source></item>
</channel></rss>`

const positions: Position[] = [
  { id: 'ril', ticker: 'RELIANCE', name: 'Reliance Industries', type: 'stock', quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100, exchange: 'NSE' },
  { id: 'tcs', ticker: 'TCS', name: 'Tata Consultancy Services', type: 'stock', quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100, exchange: 'NSE' },
  { id: 'fund', ticker: 'FUND123', name: 'Bluechip Growth Fund', type: 'mutual-fund', quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100 },
]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('rssItems', () => {
  it('parses titles, links, dates and falls back to the feed publisher', () => {
    const items = rssItems(ET_FEED, 'Economic Times')

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ title: 'Markets rally as IT stocks surge 3%', link: 'https://economictimes.test/markets-rally', publisher: 'Economic Times' })
    expect(items[0].publishedAt).toBe(Date.parse(hoursAgo(1)))
  })

  it('extracts the story publisher from Bing-style source tags and decodes entities', () => {
    const items = rssItems(BING_FEED, 'Bing News')

    expect(items[0].publisher).toBe('TechCircle')
    expect(items[0].title).toContain('Infosys & TCS')
    expect(items[1].publisher).toBe('Market Desk')
  })

  it('skips entries without an http link or title', () => {
    const payload = `<rss><channel>
      <item><title>No link here</title></item>
      <item><title>Local link</title><link>/relative/path</link></item>
      <item><title>Valid</title><link>https://ok.test/story</link></item>
    </channel></rss>`

    expect(rssItems(payload, 'Feed').map((item) => item.title)).toEqual(['Valid'])
  })
})

describe('significantNameWords', () => {
  it('strips legal suffixes and punctuation, capping at three words', () => {
    expect(significantNameWords('HDFC Bank Ltd.')).toEqual(['HDFC', 'BANK'])
    expect(significantNameWords('State Bank of India')).toEqual(['STATE', 'BANK'])
    expect(significantNameWords('Tata Consultancy Services Limited')).toEqual(['TATA', 'CONSULTANCY', 'SERVICES'])
  })
})

describe('matchedTickers', () => {
  const holdings = positions.filter((position) => position.type !== 'mutual-fund').map(({ ticker, name }) => ({ ticker, name }))

  it('matches a standalone ticker word but not a substring of another word', () => {
    expect(matchedTickers('TCS share price rises after results', holdings)).toEqual(['TCS'])
    expect(matchedTickers('ATCS Logistics ships quarterly volumes', holdings)).toEqual([])
  })

  it('requires every significant company-name word when the ticker word alone is ambiguous', () => {
    const steelHoldings = [{ ticker: 'TATASTEEL', name: 'Tata Steel Ltd' }]
    expect(matchedTickers('Tata Steel board approves buyback', steelHoldings)).toEqual(['TATASTEEL'])
    expect(matchedTickers('Tata Motors launches an electric SUV line', steelHoldings)).toEqual([])
    expect(matchedTickers('Reliance Industries announces bonus issue', [{ ticker: 'RELIANCE', name: 'Reliance Industries' }])).toEqual(['RELIANCE'])
  })

  it('matches collapsed short forms like "HCL Tech" against the HCLTECH ticker', () => {
    expect(matchedTickers('HCL Tech Q1 profit rises 9%', [{ ticker: 'HCLTECH', name: 'HCL Technologies' }])).toEqual(['HCLTECH'])
    expect(matchedTickers('Salt exports dip in Q3', [{ ticker: 'ITC', name: 'ITC' }])).toEqual([])
  })

  it('can match several holdings from one headline', () => {
    expect(matchedTickers('Brokerages split on TCS versus Infosys after guidance cut', [
      { ticker: 'TCS', name: 'Tata Consultancy Services' },
      { ticker: 'INFY', name: 'Infosys' },
    ])).toEqual(['TCS', 'INFY'])
  })
})

describe('dedupeItems', () => {
  it('removes repeats by title and url regardless of letter case', () => {
    const base: Omit<NewsItem, 'id'> = { title: 'Same Story', summary: undefined, source: 'Feed', sourceUrl: 'https://x.test/1', publishedAt: NOW, matches: [], origin: 'wire' }
    const items: NewsItem[] = [
      { ...base, id: 'a' },
      { ...base, id: 'b', title: 'same story' },
      { ...base, id: 'c', sourceUrl: 'https://x.test/2' },
    ]

    expect(dedupeItems(items).map((item) => item.id)).toEqual(['a', 'c'])
  })
})

describe('eligibleHoldings', () => {
  it('covers equities and ETFs plus legacy rows with provider symbols, never mutual funds', () => {
    const legacyOther: Position = { id: 'krn', ticker: 'KRN', name: 'KRN Heat Exchanger', type: 'other', quantity: 1, buyPrice: 1, lastPrice: 1, invested: 1, exchange: 'NSE', providerSymbol: 'KRN.NS' }
    const bareOther: Position = { id: 'unk', ticker: 'UNK', name: 'Unknown Asset', type: 'other', quantity: 1, buyPrice: 1, lastPrice: 1, invested: 1 }
    const etf: Position = { id: 'nifty', ticker: 'NIFTYBEES', name: 'Nippon India ETF Nifty 50 BeES', type: 'etf', quantity: 1, buyPrice: 1, lastPrice: 1, invested: 1 }

    const tickers = eligibleHoldings([...positions, legacyOther, bareOther, etf]).map((holding) => holding.ticker)

    expect(tickers).toEqual(['RELIANCE', 'TCS', 'KRN', 'NIFTYBEES'])
  })
})

describe('market news adapter · wire', () => {
  it('merges every reachable feed, dedupes them, and caches the wire between refreshes', async () => {
    let calls = 0
    const adapter = createMarketNewsAdapter(async (url) => {
      calls += 1
      return decodeURIComponent(url).includes('economictimes') ? ET_FEED : BS_FEED
    })

    const first = await adapter.fetchWire({})
    const second = await adapter.fetchWire({})

    expect(calls).toBe(2)
    expect(first.items.map((item) => item.title)).toEqual(['Markets rally as IT stocks surge 3%', 'Reliance Industries Q1 profit up 12%', 'Nifty ends flat in volatile trade'])
    expect(first.issues).toEqual([])
    expect(second.items).toEqual(first.items)
    expect(calls).toBe(2)
  })

  it('surfaces a named issue when one wire feed dies but still shows the other', async () => {
    const adapter = createMarketNewsAdapter(async (url) => {
      if (decodeURIComponent(url).includes('economictimes')) throw new Error('HTTP 403')
      return BS_FEED
    })

    // The adapter retries the failed feed after a 700ms timer; advance past it under fake timers.
    const pending = adapter.fetchWire({})
    await vi.advanceTimersByTimeAsync(1500)
    const result = await pending

    expect(result.items.map((item) => item.sourceUrl)).toEqual(['https://bs.test/nifty-flat'])
    expect(result.issues).toEqual([expect.objectContaining({ source: 'Economic Times Markets', message: expect.stringContaining('unreachable') })])
  })

  it('backs off with a rate-limit notice only when every feed fails', async () => {
    let calls = 0
    const adapter = createMarketNewsAdapter(async () => {
      calls += 1
      throw new Error('HTTP 429')
    })

    const pending = adapter.fetchWire({})
    await vi.advanceTimersByTimeAsync(700)
    const failure = await pending
    vi.advanceTimersByTime(60_000)
    const retried = await adapter.fetchWire({})

    expect(failure.items).toEqual([])
    expect(failure.issues[0].message).toContain('rate-limiting')
    expect(retried).toEqual(failure)
    expect(calls).toBe(4)
  })

  it('drops stories older than the freshness window', async () => {
    const staleFeed = ET_FEED.replace('<pubDate>' + hoursAgo(1) + '</pubDate>', `<pubDate>${hoursAgo(24 * 20)}</pubDate>`)
    const adapter = createMarketNewsAdapter(async (url) => decodeURIComponent(url).includes('economictimes') ? staleFeed : BS_FEED)

    const result = await adapter.fetchWire({})

    expect(result.items.map((item) => item.title)).not.toContain('Markets rally as IT stocks surge 3%')
  })
})

describe('market news adapter · company search', () => {
  it('queries Bing News RSS through the CORS relay and keeps each query cached separately', async () => {
    const urls: string[] = []
    const adapter = createMarketNewsAdapter(async (url) => {
      urls.push(decodeURIComponent(url))
      return BING_FEED
    })

    const first = await adapter.fetchCompanyNews('"Reliance Industries"', {})
    await adapter.fetchCompanyNews('"Reliance Industries"', {})
    const otherQuery = await adapter.fetchCompanyNews('TCS', {})

    expect(urls[0]).toContain('corsproxy.io')
    expect(urls[0]).toContain('https://www.bing.com/news/search?q=%22Reliance%20Industries%22&format=RSS')
    expect(urls).toHaveLength(2)
    expect(first.items.map((item) => item.source)).toEqual(['TechCircle', 'Market Desk'])
    // Same stories resolve under both queries but ids stay distinct per origin.
    expect(otherQuery.items.map((item) => item.sourceUrl)).toEqual(first.items.map((item) => item.sourceUrl))
    expect(otherQuery.items.every((item, index) => item.id !== first.items[index].id)).toBe(true)
  })

  it('reports failed searches as issues and retries after the failure cache expires', async () => {
    let calls = 0
    const adapter = createMarketNewsAdapter(async () => {
      calls += 1
      throw new Error('HTTP 500')
    })

    const pending = adapter.fetchCompanyNews('TCS', {})
    await vi.advanceTimersByTimeAsync(700)
    const failure = await pending
    vi.advanceTimersByTime(6 * 60_000)
    const retried = adapter.fetchCompanyNews('TCS', {})
    await vi.advanceTimersByTimeAsync(700)
    await retried

    expect(failure.items).toEqual([])
    expect(failure.issues).toEqual([expect.objectContaining({ source: 'Search · TCS' })])
    expect(calls).toBe(4)
  })

  it('retries a transiently rejected search once before giving up', async () => {
    let calls = 0
    const adapter = createMarketNewsAdapter(async () => {
      calls += 1
      if (calls === 1) throw new Error('HTTP 403')
      return BING_FEED
    })

    const pending = adapter.fetchCompanyNews('TCS', {})
    await vi.advanceTimersByTimeAsync(700)
    const result = await pending

    expect(calls).toBe(2)
    expect(result.items).toHaveLength(2)
    expect(result.issues).toEqual([])
    expect(result.items.every((item) => item.origin === 'search')).toBe(true)
  })

  it('ignores blank queries without touching the network', async () => {
    let calls = 0
    const adapter = createMarketNewsAdapter(async () => {
      calls += 1
      return BING_FEED
    })

    expect((await adapter.fetchCompanyNews('   ', {})).items).toEqual([])
    expect(calls).toBe(0)
  })
})

describe('loadMarketFeed', () => {
  const makeStub = () => ({
    fetchWire: vi.fn(async (_options: { signal?: AbortSignal }) => ({
      items: [{ id: 'wire:1', title: 'Reliance Industries Q1 profit up 12%', source: 'Economic Times Markets', sourceUrl: 'https://economictimes.test/ril-q1', publishedAt: NOW, matches: [], origin: 'wire' as const }],
      issues: [],
    })),
    fetchCompanyNews: vi.fn(async () => ({
      items: [
        { id: 'search:1', title: 'Morgan Stanley reiterates positive stance on Reliance Industries', source: 'Market Desk', sourceUrl: 'https://bing.test/ms-ril', publishedAt: NOW, matches: [], origin: 'search' as const },
      ],
      issues: [] as never[],
    })),
  })

  it('layers the active search over the wire, tags owned stories and origins, dedupes wire originals first', async () => {
    const adapter = makeStub()
    adapter.fetchCompanyNews.mockResolvedValueOnce({
      items: [
        { id: 'search:1', title: 'Morgan Stanley reiterates positive stance on Reliance Industries', source: 'Market Desk', sourceUrl: 'https://bing.test/ms-ril', publishedAt: NOW, matches: [], origin: 'search' as const },
        { id: 'dup:1', title: 'Reliance Industries Q1 profit up 12%', source: 'Economic Times Markets', sourceUrl: 'https://economictimes.test/ril-q1', publishedAt: NOW, matches: [], origin: 'search' as const },
      ],
      issues: [],
    })
    const feed = await loadMarketFeed(positions, { query: '"Reliance Industries"' }, adapter)

    expect(adapter.fetchCompanyNews).toHaveBeenCalledWith('"Reliance Industries"', expect.objectContaining({ query: '"Reliance Industries"' }))
    expect(feed.items.map((item) => item.id)).toEqual(['wire:1', 'search:1'])
    expect(feed.items.find((item) => item.id === 'wire:1')?.origin).toBe('wire')
    expect(feed.items.find((item) => item.id === 'search:1')?.origin).toBe('search')
    expect(feed.items.every((item) => item.matches.includes('RELIANCE'))).toBe(true)
    expect(feed.fetchedAt).toBe(NOW)
  })

  it('skips the search network entirely when no query is active', async () => {
    const adapter = makeStub()
    const feed = await loadMarketFeed(positions, {}, adapter)

    expect(adapter.fetchCompanyNews).not.toHaveBeenCalled()
    expect(feed.items.map((item) => item.id)).toEqual(['wire:1'])
  })

  it('never attributes stories to mutual-fund holdings', async () => {
    const fundStory: NewsItem = { id: 'w', title: 'Bluechip Growth Fund beats benchmark', source: 'ET', sourceUrl: 'https://x.test/fund', matches: [], origin: 'wire' }
    const adapter: MarketNewsAdapter = {
      fetchWire: async () => ({ items: [fundStory], issues: [] }),
      fetchCompanyNews: async () => ({ items: [], issues: [] }),
    }

    const feed = await loadMarketFeed(positions, {}, adapter)

    expect(feed.items[0].matches).toEqual([])
  })
})
