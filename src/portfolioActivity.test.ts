import { describe, expect, it } from 'vitest'
import { buildPortfolioActivity } from './portfolioActivity'
import type { LiveQuote, Position } from './types'
import { quoteKey } from './valuation'

const NOW = Date.parse('2026-10-08T11:00:00Z')
const DAY = 86_400_000

function position(ticker: string, overrides: Partial<Position> = {}): Position {
  return { id: ticker, ticker, name: ticker, type: 'stock', quantity: 10, buyPrice: 100, lastPrice: null, invested: 1000, currency: 'INR', exchange: 'NSE', ...overrides }
}

function quote(overrides: Partial<LiveQuote> = {}): LiveQuote {
  return { price: 110, at: NOW - 60_000, source: 'yahoo', change: 10, changePct: 10, ...overrides }
}

function build(positions: Position[], observations: LiveQuote[], options: Partial<Parameters<typeof buildPortfolioActivity>[0]> = {}) {
  return buildPortfolioActivity({ positions, quotes: Object.fromEntries(positions.map((row, index) => [quoteKey(row), observations[index]])), now: NOW, ...options })
}

describe('portfolio activity', () => {
  it('uses INR prices to estimate impact and whole-book weights', () => {
    const positions = [position('LOCAL'), position('LOSS', { quantity: 5 })]
    const result = build(positions, [quote(), quote({ price: 320, change: -40, changePct: -100 / 9 })])
    expect(result.movers.map((row) => row.ticker)).toEqual(['LOSS', 'LOCAL'])
    expect(result.holdings[1]).toMatchObject({ price: 320, dayContribution: -200 })
    expect(result.holdings[0].weightPct).toBeCloseTo(1100 / 2700 * 100)
    expect(result.holdings[1].weightPct).toBeCloseTo(1600 / 2700 * 100)
    expect(result.counts).toMatchObject({ total: 2, impact: 2, gainers: 1, decliners: 1 })
  })

  it('withholds unsupported-currency prices and impact and leaves whole-book weights unavailable', () => {
    const positions = [position('LOCAL'), position('FOREIGN', { exchange: 'OTHER', currency: undefined, reportedCurrency: 'GBP', lastPrice: 25 })]
    const result = build(positions, [quote(), quote({ price: 30, changePct: 40 })])
    expect(result.holdings.find((row) => row.ticker === 'FOREIGN')).toMatchObject({ price: null, changePct: 40, dayContribution: null, weightPct: null })
    expect(result.holdings.find((row) => row.ticker === 'LOCAL')).toMatchObject({ price: 110, dayContribution: 100, weightPct: null })
    expect(result.counts).toMatchObject({ movement: 2, impact: 1 })
    const imported = buildPortfolioActivity({ positions, quotes: {}, now: NOW })
    expect(imported.holdings.find((row) => row.ticker === 'FOREIGN')).toMatchObject({ price: null, dayContribution: null, weightPct: null, freshness: 'unavailable' })
  })

  it('keeps stale quote evidence and distinguishes imported prices from unavailable prices', () => {
    const positions = [position('STALE'), position('IMPORTED', { lastPrice: 50 }), position('UNKNOWN')]
    const result = build(positions, [quote({ at: NOW - 2 * DAY, fetchedAt: NOW }), quote({ price: Number.NaN }), quote({ at: NOW + DAY })])
    expect(result.holdings.find((row) => row.ticker === 'STALE')).toMatchObject({ price: 110, observedAt: NOW - 2 * DAY, freshness: 'stale', changePct: null, dayContribution: null })
    expect(result.holdings.find((row) => row.ticker === 'IMPORTED')).toMatchObject({ price: 50, source: 'Imported price', observedAt: null, freshness: 'imported' })
    expect(result.counts).toMatchObject({ quoted: 1, stale: 1, imported: 1, unavailable: 1, movement: 0 })
    expect(result.movers).toEqual([])
  })

  it('shows a recent published fund NAV without inventing a day move', () => {
    const fund = position('FUND', { type: 'mutual-fund', name: 'Index fund', quantity: 5 })
    const result = build([fund], [quote({ source: 'nav', price: 25, at: NOW - 3 * DAY, change: null, changePct: null })])
    expect(result.holdings[0]).toMatchObject({ ticker: 'Index fund', source: 'Published NAV', freshness: 'recent', movementLabel: 'NAV move', price: 25, changePct: null, dayContribution: null })
    expect(result.counts).toMatchObject({ fresh: 1, movement: 0 })
    expect(build([fund], [quote({ source: 'nav', at: NOW - 5 * DAY })]).holdings[0].freshness).toBe('stale')
  })

  it('preserves provider timestamps and uses the Indian market timezone', () => {
    const positions = [position('LOCAL'), position('SECOND', { exchange: 'BSE' })]
    const previousSession = Date.parse('2026-10-08T01:00:00Z')
    const result = build(positions, [quote(), quote({ at: previousSession, fetchedAt: NOW })])
    expect(result.holdings[0]).toMatchObject({ observedAt: NOW - 60_000, marketTimeZone: 'Asia/Kolkata' })
    expect(result.holdings[1]).toMatchObject({ observedAt: previousSession, marketTimeZone: 'Asia/Kolkata' })
    expect(result.counts.impact).toBe(2)
  })

  it('orders available absolute impact first, then percentage for ties and missing impact', () => {
    const positions = [position('SMALL'), position('LOSS'), position('PCT'), position('PCT2')]
    const result = build(positions, [quote({ change: 1, changePct: 1 }), quote({ change: -20, changePct: -10 }), quote({ change: null, changePct: 30 }), quote({ change: null, changePct: -40 })])
    expect(result.movers.map((row) => row.ticker)).toEqual(['LOSS', 'SMALL', 'PCT2', 'PCT'])
    const tie = build([position('A'), position('B')], [quote({ changePct: 5 }), quote({ changePct: -15 })])
    expect(tie.movers.map((row) => row.ticker)).toEqual(['B', 'A'])
  })

  it('summarizes the largest recent INR impact without promoting percentages, stale prices or NAV', () => {
    const positions = [
      position('SMALL'), position('LOSS', { type: 'etf' }), position('PCT'), position('STALE'),
      position('FUND', { type: 'mutual-fund' }), position('UNSUPPORTED', { currency: undefined, reportedCurrency: 'GBP' }),
    ]
    const result = build(positions, [
      quote({ change: 1, changePct: 1 }), quote({ change: -20, changePct: -10 }),
      quote({ change: null, changePct: 80 }), quote({ change: 100, at: NOW - 2 * DAY }),
      quote({ source: 'nav', change: 90, changePct: 40 }), quote({ change: 100, changePct: 60 }),
    ])
    expect(result.summary.largestImpact).toBe(result.holdings.find((row) => row.ticker === 'LOSS'))
    expect(result.summary.largestImpact?.dayContribution).toBe(-200)
    expect(result.summary).toMatchObject({ impactCount: 2, impactEligibleCount: 5 })
  })

  it('leaves the impact leader empty when no recent nonzero contribution is known', () => {
    const positions = [position('PCT'), position('FLAT'), position('FUND', { type: 'mutual-fund' })]
    const result = build(positions, [quote({ change: null, changePct: 80 }), quote({ change: 0, changePct: 0 }), quote({ source: 'nav' })])
    expect(result.summary.largestImpact).toBeNull()
    expect(buildPortfolioActivity({ positions: [], quotes: {}, now: NOW }).summary).toEqual({
      largestImpact: null, latestObservedAt: null, quoteCount: 0, navCount: 0, impactCount: 0, impactEligibleCount: 0,
    })
  })

  it('keeps quote impact coverage separate from reported NAV contributions', () => {
    const positions = [position('STOCK'), position('FUND', { type: 'mutual-fund' })]
    const observations = [quote({ change: null, changePct: 10 }), quote({ source: 'nav', change: 10 })]
    for (const hideValues of [false, true]) {
      const result = build(positions, observations, { hideValues })
      expect(result.counts.impact).toBe(1)
      expect(result.summary).toMatchObject({ largestImpact: null, impactCount: 0, impactEligibleCount: 1 })
    }
  })

  it('separates recent market quotes from NAV and uses provider observation times', () => {
    const positions = [
      position('LOCAL'), position('FUND', { type: 'mutual-fund' }), position('STALE'),
      position('OLDNAV', { type: 'mutual-fund' }), position('IMPORTED', { lastPrice: 50 }),
    ]
    const result = build(positions, [
      quote({ at: NOW - 2 * 60_000, fetchedAt: NOW }),
      quote({ source: 'nav', at: NOW - 60_000, fetchedAt: NOW }),
      quote({ at: NOW - 2 * DAY, fetchedAt: NOW }),
      quote({ source: 'nav', at: NOW - 5 * DAY, fetchedAt: NOW }),
      quote({ price: Number.NaN, at: NOW }),
    ])
    expect(result.summary).toMatchObject({ quoteCount: 1, navCount: 1, latestObservedAt: NOW - 60_000 })
    const stale = build([position('STALE')], [quote({ at: NOW - 2 * DAY, fetchedAt: NOW })])
    expect(stale.summary).toMatchObject({ quoteCount: 0, navCount: 0, latestObservedAt: null })
  })

  it('keeps reported zero changes in coverage while excluding them from movers', () => {
    const positions = [position('FLAT'), position('LOSS'), position('PCTFLAT')]
    const result = build(positions, [quote({ change: 0, changePct: 0 }), quote({ change: -10, changePct: -5 }), quote({ change: null, changePct: 0 })])
    expect(result.movers.map((row) => row.ticker)).toEqual(['LOSS'])
    expect(result.holdings.find((row) => row.ticker === 'FLAT')).toMatchObject({ changePct: 0, dayContribution: 0, trend: 'neutral' })
    expect(result.counts).toMatchObject({ movement: 3, impact: 2, gainers: 0, decliners: 1, flat: 2 })
    expect(result.summary).toMatchObject({ impactCount: 2, impactEligibleCount: 3 })
  })

  it('redacts values, directions, breadth and contribution ranking when values are hidden', () => {
    const positions = [position('AAA'), position('ZZZ')]
    const visible = build(positions, [quote({ change: 1, changePct: 1 }), quote({ change: -20, changePct: -10 })])
    expect(visible.movers.map((row) => row.ticker)).toEqual(['ZZZ', 'AAA'])
    const hidden = build(positions, [quote({ change: 1, changePct: 1 }), quote({ change: -20, changePct: -10 })], { hideValues: true })
    expect(hidden.movers.map((row) => row.ticker)).toEqual(['AAA', 'ZZZ'])
    for (const row of [...hidden.holdings, ...hidden.movers]) {
      expect(row).toMatchObject({ price: null, changePct: null, dayContribution: null, weightPct: null, trend: 'neutral' })
    }
    expect(hidden.counts).toMatchObject({ gainers: null, decliners: null, flat: null, movement: 2 })
    expect(hidden.summary).toMatchObject({ largestImpact: null, quoteCount: 2, navCount: 0, latestObservedAt: NOW - 60_000, impactCount: 2, impactEligibleCount: 2 })
  })

  it('ignores ambiguous legacy quotes while using separate quotes for distinct listing identities', () => {
    const first = position('SAME', { lastPrice: 50, providerSymbol: 'SAME.NS' })
    const second = { ...first, id: 'second', exchange: 'BSE' as const, providerSymbol: 'SAME.BO', lastPrice: 20 }
    expect(quoteKey(first)).not.toBe(quoteKey(second))
    const result = buildPortfolioActivity({ positions: [first, second], quotes: { 'EQ:SAME': quote() }, now: NOW })
    expect(result.counts).toMatchObject({ total: 2, quoted: 0, imported: 2, movement: 0 })
    expect(result.holdings.map((row) => row.price)).toEqual([50, 20])
    const separate = build([first, second], [quote({ price: 60 }), quote({ price: 30 })])
    expect(separate.counts).toMatchObject({ total: 2, quoted: 2, imported: 0, movement: 2 })
    expect(separate.holdings.map((row) => row.price)).toEqual([60, 30])
  })

  it('combines compatible holding rows before estimating contribution', () => {
    const first = position('SAME')
    const second = { ...first, id: 'second', quantity: 5, invested: 500 }
    const result = build([first, second], [quote(), quote()])
    expect(result.counts.total).toBe(1)
    expect(result.holdings[0].dayContribution).toBe(150)
    expect(result.summary).toMatchObject({ impactCount: 1, impactEligibleCount: 1 })
  })
})
