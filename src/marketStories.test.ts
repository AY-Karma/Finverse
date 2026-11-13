import { describe, expect, it } from 'vitest'
import { buildMarketStories } from './marketStories'
import { investmentWorkspace } from './investmentWorkspace'
import type { LiveQuote, Position } from './types'
import type { HoldingPriceHistories } from './holdingMarketMoves'
import { formatCurrency, formatPercent, quoteKey } from './valuation'

const today = '2026-11-06'
const holding = (ticker: string, patch: Partial<Position> = {}): Position => ({
  id: ticker, ticker, name: ticker, type: 'stock', quantity: 1, buyPrice: 100,
  invested: 100, lastPrice: 100, currency: 'INR', exchange: 'NSE', sector: 'Technology', ...patch,
})
const prices = (opening: number, closing: number) => [{ date: '2026-10-30', close: opening }, { date: today, close: closing }]
const snapshot = (positions: Position[], quotes: Record<string, LiveQuote> = {}) => investmentWorkspace.readSnapshot({
  folios: [{ id: 'folio', name: 'Portfolio', importedAt: 1, positions }], quotes,
})
const histories = (positions: Position[], values: [number, number][]): HoldingPriceHistories => Object.fromEntries(
  positions.map((position, index) => [quoteKey(position), prices(...values[index])]),
)

describe('portfolio stories', () => {
  it('has no personal stories without holdings', () => {
    expect(buildMarketStories(snapshot([]), {}, today)).toEqual([])
  })

  it.each([
    { kind: 'bridge', closes: [111, 121, 89] },
    { kind: 'driver', closes: [120, 102, 101, 101] },
  ])('avoids repeating the net contributor page when a $kind insight already explains it', ({ kind, closes }) => {
    const positions = closes.map((_, index) => holding(`HOLDING${index}`))
    const stories = buildMarketStories(snapshot(positions), histories(positions, closes.map((close): [number, number] => [100, close])), today)
    expect(stories.map((story) => story.kind)).toEqual([kind, 'sectors'])
    expect(stories[0].insight?.kind).toBe(kind)
    expect(stories.some((story) => story.kind === 'month')).toBe(false)
  })

  it('does not repeat current valuation or imply period moves without historical prices', () => {
    const position = holding('AAA', { quantity: 2, invested: 180, lastPrice: 110 })
    const stories = buildMarketStories(snapshot([position]), {}, today)
    expect(stories).toEqual([])
  })

  it('preserves partial valuation coverage and does not invent a zero value when no prices exist', () => {
    const positions = [holding('AAA'), holding('BBB', { lastPrice: null })]
    const stories = buildMarketStories(snapshot(positions), {}, today)
    expect(stories).toEqual([])
    const unpriced = buildMarketStories(snapshot([positions[1]]), {}, today)
    expect(unpriced).toEqual([])
  })

  it('calculates signed monthly movement at current quantities with observed dates and partial coverage', () => {
    const positions = [holding('AAA', { quantity: 2 }), holding('BBB')]
    const stories = buildMarketStories(snapshot(positions), { [quoteKey(positions[0])]: prices(100, 90) }, today)
    const month = stories.find((story) => story.kind === 'month')!
    expect(month).toMatchObject({ metric: formatCurrency(-20), tone: 'negative', from: '2026-10-30', through: today })
    expect(month.rows[0]).toMatchObject({ label: 'AAA', amount: -20, value: formatCurrency(-20), tone: 'negative' })
    expect(month.note).toContain('1 of 2 holdings covered')
    expect(month.note).toContain("not your investment return")
  })

  it('retains a flat monthly result while hiding zero optional contribution and sector rows', () => {
    const positions = [holding('AAA')]
    const stories = buildMarketStories(snapshot(positions), histories(positions, [[100, 100]]), today)
    expect(stories.find((story) => story.kind === 'month')).toMatchObject({ metric: formatCurrency(0), tone: 'neutral', rows: [] })
    expect(stories.some((story) => story.kind === 'sectors')).toBe(false)
    expect(stories.some((story) => story.insight)).toBe(false)
  })

  it('waits for a current-month observation before showing monthly holding moves', () => {
    const positions = [holding('AAA')]
    const stories = buildMarketStories(snapshot(positions), { [quoteKey(positions[0])]: [{ date: '2026-10-30', close: 100 }] }, '2026-11-01')
    expect(stories).toEqual([])
  })

  it('weights sector moves by opening stock value and excludes funds, ETFs and unknown classifications', () => {
    const positions = [
      holding('AAA', { quantity: 2 }), holding('BBB'),
      holding('CCC', { sector: 'Unknown' }), holding('DDD', { sector: undefined, category: 'Equity' }),
      holding('EEE', { type: 'etf' }), holding('FFF', { type: 'mutual-fund' }),
    ]
    const stories = buildMarketStories(snapshot(positions), histories(positions, [[100, 110], [300, 240], [100, 150], [100, 150], [100, 150], [100, 150]]), today)
    const sector = stories.find((story) => story.kind === 'sectors')!
    expect(sector.title).toBe('Your stocks by sector.')
    expect(sector).toMatchObject({ metricLabel: 'Technology', metric: formatPercent(-8), tone: 'negative', rows: [] })
    expect(sector.note).toContain('2 of 4 stocks covered')
    expect(sector.note).toContain('not sector indices')
  })

  it('keeps tiny nonzero sector moves even when the displayed percentage rounds to zero', () => {
    const positions = [holding('AAA')]
    const stories = buildMarketStories(snapshot(positions), histories(positions, [[100, 100.00001]]), today)
    expect(stories.find((story) => story.kind === 'sectors')).toMatchObject({ metricLabel: 'Technology', metric: formatPercent(0.00001), tone: 'positive', rows: [] })
  })

  it('shows the lead sector once and keeps other sectors as comparisons', () => {
    const positions = [holding('AAA'), holding('BBB', { sector: 'Healthcare' })]
    const sector = buildMarketStories(snapshot(positions), histories(positions, [[100, 120], [100, 90]]), today).find((story) => story.kind === 'sectors')!
    expect(sector).toMatchObject({ metricLabel: 'Technology', metric: '+20.00%' })
    expect(sector.rows).toEqual([{ label: 'Healthcare', value: formatPercent(-10), amount: -10, tone: 'negative' }])
  })

  it('keeps allocation weights out of the story sequence', () => {
    const positions = [holding('AAA', { lastPrice: 300 }), holding('BBB', { lastPrice: 100 }), holding('ZERO', { lastPrice: 0 }), holding('MISSING', { lastPrice: null })]
    const stories = buildMarketStories(snapshot(positions), {}, today)
    expect(stories).toEqual([])
  })

  it('builds broad market context only from bounded openings and current-month observations', () => {
    const stories = buildMarketStories(snapshot([holding('AAA')]), {}, today, [
      { label: 'NIFTY 50', points: prices(20_000, 21_000) },
      { label: 'S&P BSE Sensex', points: [{ date: '2026-10-20', close: 70_000 }, { date: today, close: 71_000 }] },
    ])
    const market = stories.find((story) => story.kind === 'market')!
    expect(market).toMatchObject({ metric: '+5.00%', metricLabel: 'NIFTY 50', from: '2026-10-30', through: today, target: 'insights' })
    expect(market.rows).toEqual([])
    expect(market.note).toContain('1 of 2 indices covered')
    expect(buildMarketStories(snapshot([holding('AAA')]), {}, today, [{ label: 'NIFTY 50', points: [{ date: '2026-10-30', close: 20_000 }] }]).some((story) => story.kind === 'market')).toBe(false)
  })

  it('shows the featured index once and retains the other index comparison', () => {
    const market = buildMarketStories(snapshot([holding('AAA')]), {}, today, [
      { label: 'NIFTY 50', points: prices(20_000, 21_000) },
      { label: 'S&P BSE Sensex', points: prices(70_000, 71_400) },
    ]).find((story) => story.kind === 'market')!
    expect(market).toMatchObject({ metricLabel: 'NIFTY 50', metric: '+5.00%' })
    expect(market.rows).toEqual([expect.objectContaining({ label: 'S&P BSE Sensex', value: '+2.00%', tone: 'positive' })])
    expect(market.rows[0].amount).toBeCloseTo(2)
  })

  it('uses the same monthly opening and closing observations for the chart and headline', () => {
    const points = [
      { date: '2026-09-30', close: 100 }, { date: '2026-10-23', close: 120 },
      { date: '2026-10-26', close: 119 }, { date: '2026-10-27', close: NaN },
      { date: '2026-10-28', close: 112 }, { date: '2026-10-30', close: 110 },
      { date: '2026-11-02', close: 130 },
    ]
    const market = buildMarketStories(snapshot([holding('AAA')]), {}, '2026-10-30', [{ label: 'NIFTY 50', points }]).find((story) => story.kind === 'market')!
    expect(market.metric).toBe('+10.00%')
    expect(market.marketChart).toEqual([points[0], points[1], points[2], points[4], points[5]])
  })

  it.each([
    { market: 'rising', closes: [109.19, 109.66, 111.6, 108.24, 108.36], order: [1, 0, 4, 3] },
    { market: 'falling', closes: [90, 96, 98, 85, 95], order: [1, 4, 0, 3] },
  ])('ranks all five indices by return and charts the best performer in a $market market', ({ closes, order }) => {
    const labels = ['NIFTY 50', 'S&P BSE Sensex', 'NIFTY Bank', 'NIFTY Next 50', 'NIFTY Midcap 50']
    const market = buildMarketStories(snapshot([holding('AAA')]), {}, today, labels.map((label, index) => ({ label, points: prices(100, closes[index]) }))).find((story) => story.kind === 'market')!
    expect(market.metricLabel).toBe('NIFTY Bank')
    expect(market.metric).toBe(formatPercent(closes[2] - 100))
    expect(market.rows.map((row) => row.label)).toEqual(order.map((index) => labels[index]))
    expect(market.marketChart).toEqual(prices(100, closes[2]))
    expect(market.tone).toBe(closes[2] > 100 ? 'positive' : 'negative')
  })

  it('matches the chart to a weekly edition and excludes observations outside its measured window', () => {
    const points = [{ date: '2026-09-30', close: 90 }, ...prices(100, 102), { date: '2026-11-09', close: 110 }]
    const market = buildMarketStories(snapshot([]), {}, '2026-11-07', [{ label: 'NIFTY 50', points }], { from: '2026-11-02', through: '2026-11-06', label: 'Weekly' }).find((story) => story.kind === 'market')!
    expect(market.metric).toBe('+2.00%')
    expect(market.marketChart).toEqual(prices(100, 102))
  })

  it('uses the completed weekly window and omits current valuation and concentration', () => {
    const position = holding('AAA', { quantity: 2, lastPrice: 999 })
    const points = [
      { date: '2026-09-30', close: 90 }, { date: '2026-10-30', close: 100 },
      { date: '2026-11-02', close: 110 }, { date: '2026-11-06', close: 120 },
      { date: '2026-11-09', close: 999 },
    ]
    const stories = buildMarketStories(snapshot([position]), { [quoteKey(position)]: points }, '2026-11-07', [], { from: '2026-11-02', through: '2026-11-06', label: 'Weekly' })
    expect(stories.map((story) => story.kind)).toEqual(['month', 'sectors'])
    expect(stories[0]).toMatchObject({ id: 'month:2026-11-02:2026-11-06', eyebrow: 'Weekly recap', metric: `+${formatCurrency(40)}`, metricLabel: 'Weekly market move', from: '2026-10-30', through: '2026-11-06' })
    expect(stories[0].note).toContain("today's quantities")
  })

  it('keeps the previous month separate from weekly moves and excludes current quotes', () => {
    const position = holding('AAA', { quantity: 2 })
    const currentQuotes = { [quoteKey(position)]: { price: 999, at: Date.parse('2026-10-30T10:00:00Z'), source: 'yahoo' as const } }
    const points = [{ date: '2026-09-30', close: 90 }, { date: '2026-10-30', close: 100 }, { date: '2026-11-01', close: 999 }]
    const stories = buildMarketStories(snapshot([position], currentQuotes), { [quoteKey(position)]: points }, '2026-11-01', [], { from: '2026-10-01', through: '2026-10-31', label: 'Monthly' })
    expect(stories[0]).toMatchObject({ id: 'month:2026-10-01:2026-10-31', eyebrow: 'October recap', metric: `+${formatCurrency(20)}`, metricLabel: 'October market move', through: '2026-10-30' })
    expect(stories.map((story) => story.kind)).not.toContain('portfolio')
    expect(stories.map((story) => story.kind)).not.toContain('concentration')
    const withoutHistory = buildMarketStories(snapshot([position], currentQuotes), {}, '2026-11-01', [], { from: '2026-10-01', through: '2026-10-31', label: 'Monthly' })
    expect(withoutHistory).toEqual([])
  })

  it('builds completed index recaps without requiring an imported portfolio', () => {
    const stories = buildMarketStories(snapshot([]), {}, '2026-11-01', [{ label: 'NIFTY 50', points: [{ date: '2026-09-30', close: 20_000 }, { date: '2026-10-30', close: 21_000 }, { date: '2026-11-01', close: 30_000 }] }], { from: '2026-10-01', through: '2026-10-31', label: 'Monthly' })
    expect(stories).toHaveLength(1)
    expect(stories[0]).toMatchObject({ kind: 'market', eyebrow: 'October recap · Indian markets', title: 'The market in October.', metric: '+5.00%', through: '2026-10-30' })
  })

  it('does not turn invalid or unfinished periods into completed recaps', () => {
    const current = snapshot([holding('AAA')])
    expect(buildMarketStories(current, {}, today, [], { from: '2026-10-20', through: '2026-10-01', label: 'Weekly' })).toEqual([])
    expect(buildMarketStories(current, {}, today, [], { from: '2026-11-02', through: '2026-11-09', label: 'Weekly' })).toEqual([])
  })
})
