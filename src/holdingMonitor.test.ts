import { describe, expect, it } from 'vitest'
import { buildHoldingBriefing, createHoldingMonitorAdapter, loadHoldingBriefing, type HoldingMonitorEvent } from './holdingMonitor'
import type { Position } from './types'

const positions: Position[] = [
  { id: 'reliance', ticker: 'RELIANCE', name: 'Reliance Industries', type: 'stock', quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100, exchange: 'NSE' },
  { id: 'fund', ticker: 'FUND', name: 'Example Fund', type: 'mutual-fund', quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100 },
]

const at = (value: string) => Date.parse(value)

describe('buildHoldingBriefing', () => {
  it('prioritises material official events, dates upcoming events, and reports coverage', () => {
    const events: HoldingMonitorEvent[] = [
      { id: 'rights', ticker: 'RELIANCE', kind: 'corporate-action', title: 'Rights issue announced', source: 'NSE India', sourceUrl: 'https://example.test/rights', publishedAt: at('2026-08-19T08:00:00Z'), eventAt: at('2026-08-22T00:00:00Z'), official: true },
      { id: 'results', ticker: 'RELIANCE', kind: 'results', title: 'Board meeting for financial results', source: 'NSE India', sourceUrl: 'https://example.test/results', publishedAt: at('2026-08-19T09:00:00Z'), eventAt: at('2026-08-25T00:00:00Z'), official: true },
      { id: 'news', ticker: 'RELIANCE', kind: 'news', title: 'Company news', source: 'Example News', sourceUrl: 'https://example.test/news', publishedAt: at('2026-08-19T10:00:00Z'), official: false },
    ]

    const briefing = buildHoldingBriefing(positions, events, at('2026-08-19T12:00:00Z'))

    expect(briefing.attention.map((event) => event.id)).toEqual(['rights'])
    expect(briefing.upcoming.map((event) => event.id)).toEqual(['results'])
    expect(briefing.updates.map((event) => event.id)).toEqual(['news'])
    expect(briefing.coverage).toEqual({ eligibleHoldings: 1, matchedHoldings: 1, unsupportedHoldings: 1 })
  })

  it('deduplicates repeated source events and excludes events for holdings not owned', () => {
    const event: HoldingMonitorEvent = { id: 'first', ticker: 'RELIANCE', kind: 'announcement', title: 'Investor presentation', source: 'NSE India', sourceUrl: 'https://example.test/filing', publishedAt: at('2026-08-19T08:00:00Z'), official: true }
    const briefing = buildHoldingBriefing(positions, [event, { ...event, id: 'duplicate' }, { ...event, id: 'other', ticker: 'TCS' }], at('2026-08-19T12:00:00Z'))

    expect(briefing.updates.map((item) => item.id)).toEqual(['first'])
  })

  it('sends only holding identities across the external seam', async () => {
    let received: unknown
    const adapter = {
      async fetchEvents(holdings: unknown) {
        received = holdings
        return { events: [], issues: [] }
      },
    }

    await loadHoldingBriefing(positions, {}, adapter)

    expect(received).toEqual([{ ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', isin: undefined }])
  })

  it('includes legacy equity imports whose type was not supplied by the spreadsheet', async () => {
    let received: unknown
    const adapter = {
      async fetchEvents(holdings: unknown) {
        received = holdings
        return { events: [], issues: [] }
      },
    }
    const legacyEquity: Position = {
      id: 'krn', ticker: 'KRN', name: 'KRN Heat Exchanger and Refrigeration', type: 'other',
      quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100, exchange: 'NSE', providerSymbol: 'KRN.NS',
    }

    await loadHoldingBriefing([legacyEquity], {}, adapter)

    expect(received).toEqual([{
      ticker: 'KRN', name: 'KRN Heat Exchanger and Refrigeration', exchange: 'NSE', isin: undefined, providerSymbol: 'KRN.NS',
    }])
  })

  it('does not invent a source publication timestamp', () => {
    const briefing = buildHoldingBriefing(positions, [{ id: 'untimed', ticker: 'RELIANCE', kind: 'announcement', title: 'Untimed filing', source: 'NSE India', sourceUrl: 'https://example.test/untimed', official: true }], at('2026-08-19T12:00:00Z'))

    expect(briefing.updates[0].publishedAt).toBeUndefined()
  })

  it('does not cache failed news requests', async () => {
    let calls = 0
    const adapter = createHoldingMonitorAdapter(async () => {
      calls += 1
      throw new Error('offline')
    })

    await adapter.fetchEvents([{ ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE' }], {})
    await adapter.fetchEvents([{ ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE' }], {})

    expect(calls).toBe(2)
  })

  it('requests company-specific Google News for an NSE series ticker', async () => {
    let requestedUrl = ''
    const adapter = createHoldingMonitorAdapter(async (url) => {
      requestedUrl = url
      return '<rss><channel><item><title>KRN investor meeting announced</title><link>https://example.test/krn</link><pubDate>Wed, 19 Aug 2026 10:00:00 GMT</pubDate><source>Sahi</source></item></channel></rss>'
    })

    const result = await adapter.fetchEvents([{
      ticker: 'KRN',
      name: 'KRN Heat Exchanger and Refrigeration',
      exchange: 'NSE',
      providerSymbol: 'KRN.NS',
    }], {})

    expect(requestedUrl).toContain('/api/google-news/rss/search')
    expect(decodeURIComponent(requestedUrl)).toContain('"KRN Heat Exchanger and Refrigeration" stock')
    expect(result.events).toEqual([expect.objectContaining({ ticker: 'KRN', title: 'KRN investor meeting announced' })])
  })
})
