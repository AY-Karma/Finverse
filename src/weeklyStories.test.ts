import { describe, expect, it } from 'vitest'
import { investmentWorkspace } from './investmentWorkspace'
import type { MarketEvent } from './marketEvents'
import { holdingIdentity } from './monitor'
import type { StoryEdition } from './recapSchedule'
import type { Position } from './types'
import { quoteKey } from './valuation'
import { buildWeeklyStories } from './weeklyStories'

const edition: StoryEdition = { id: 'weekly', key: 'weekly:2026-11-02', label: 'Weekly', from: '2026-11-02', through: '2026-11-06' }
const now = Date.parse('2026-11-07T10:00:00Z')
const holding = (ticker: string, sector: string, quantity = 1): Position => ({ id: ticker, ticker, name: `${ticker} Limited`, type: 'stock', exchange: 'NSE', currency: 'INR', quantity, buyPrice: 100, invested: quantity * 100, lastPrice: 999, sector })
const positions = [holding('AAA', 'Technology', 2), holding('BBB', 'Technology'), holding('CCC', 'Healthcare')]
const snapshot = (holdings = positions) => investmentWorkspace.readSnapshot({ folios: [{ id: 'a', name: 'Account', importedAt: 1, positions: holdings }], quotes: {} })
const histories = () => Object.fromEntries(positions.map((position, index) => [quoteKey(position), [{ date: '2026-10-30', close: 100 }, { date: '2026-11-06', close: [110, 90, 80][index] }]]))
const event = (id: string, date: string, patch: Partial<MarketEvent> = {}): MarketEvent => ({
  id, symbol: 'AAA', title: 'Financial results meeting', kind: 'results', date, dateLabel: 'Meeting date',
  source: 'NSE', sourceUrl: 'https://www.nseindia.com/companies-listing/corporate-filings-actions',
  holdingId: positions[0].id, holdingName: positions[0].name, instrumentIdentity: holdingIdentity(positions[0]), ...patch,
})

describe('weekly-exclusive stories', () => {
  it('ranks sector INR impact at current quantities on matching dates, rather than index returns or allocation', () => {
    const stories = buildWeeklyStories(snapshot(), histories(), edition, [], now)
    expect(stories).toHaveLength(1)
    expect(stories[0]).toMatchObject({ kind: 'weekly-sectors', title: 'Healthcare weighed on the week.', weekly: {
      kind: 'sectors', net: -10, covered: 3, total: 3, from: '2026-10-30', through: '2026-11-06',
      sectors: [{ label: 'Healthcare', change: -20, changePct: -20 }, { label: 'Technology', change: 10 }],
    } })
    const content = stories[0].weekly!
    expect(content.kind === 'sectors' && content.sectors[1].changePct).toBeCloseTo(10 / 300 * 100)
    expect(stories[0].note).toContain('not sector indices')
  })

  it('labels incomplete stock coverage and excludes funds and unknown classifications', () => {
    const extra = [holding('UNKNOWN', 'Unclassified'), { ...holding('FUND', 'Technology'), type: 'mutual-fund' as const }]
    const stories = buildWeeklyStories(snapshot([...positions, ...extra]), histories(), edition, [], now)
    expect(stories[0].weekly).toMatchObject({ kind: 'sectors', covered: 3, total: 4, net: -10 })
  })

  it('omits flat, unmatched or insufficient sector observations', () => {
    expect(buildWeeklyStories(snapshot(), {}, edition, [], now)).toEqual([])
    const unmatched = histories()
    unmatched[quoteKey(positions[1])][1].date = '2026-11-05'
    expect(buildWeeklyStories(snapshot(), unmatched, edition, [], now)).toEqual([])
    const flat = Object.fromEntries(positions.map((position) => [quoteKey(position), [{ date: '2026-10-30', close: 100 }, { date: '2026-11-06', close: 100 }]]))
    expect(buildWeeklyStories(snapshot(), flat, edition, [], now)).toEqual([])
    expect(buildWeeklyStories(snapshot(positions.map((position) => ({ ...position, sector: 'Technology' }))), histories(), edition, [], now)).toEqual([])
  })

  it('limits next-week watch to still-future official events for held instruments and keeps date meanings', () => {
    const events = [
      event('late', '2026-11-13'),
      event('first', '2026-11-09'),
      event('first-copy', '2026-11-09'),
      event('dividend', '2026-11-11', { kind: 'dividend', title: 'Interim dividend', dateLabel: 'Ex-date' }),
      event('outside', '2026-11-16'),
      event('past', '2026-11-06'),
      event('filing', '2026-11-10', { kind: 'filing', dateLabel: 'Published' }),
      event('not-held', '2026-11-12', { instrumentIdentity: holdingIdentity(holding('OTHER', 'Technology')) }),
      event('unsafe', '2026-11-12', { sourceUrl: 'https://untrusted.test/event' }),
      event('wrong-date-kind', '2026-11-12', { kind: 'dividend' }),
    ]
    const stories = buildWeeklyStories(snapshot(), {}, edition, events, now)
    expect(stories).toHaveLength(1)
    expect(stories[0]).toMatchObject({ kind: 'weekly-events', title: 'Next week, on your radar.', from: '2026-11-09', through: '2026-11-13' })
    const content = stories[0].weekly!
    expect(content.kind === 'events' && content.events.map((event) => [event.id, event.dateLabel])).toEqual([['first', 'Meeting date'], ['dividend', 'Ex-date'], ['late', 'Meeting date']])
    expect(stories[0].note).toContain('Ex-dates are not dividend payment dates')
  })

  it('does not replay expired dates in a historical local preview or fabricate an empty calendar', () => {
    const historical: StoryEdition = { ...edition, key: 'weekly:2026-10-26', from: '2026-10-26', through: '2026-10-30' }
    expect(buildWeeklyStories(snapshot(), {}, historical, [event('old', '2026-11-03')], now)).toEqual([])
    expect(buildWeeklyStories(snapshot(), {}, edition, [], now)).toEqual([])
    const expired = buildWeeklyStories(snapshot(), {}, edition, [event('old', '2026-11-09'), event('next', '2026-11-13')], Date.parse('2026-11-12T10:00:00Z'))
    expect(expired[0].weekly?.kind === 'events' && expired[0].weekly.events.map((event) => event.id)).toEqual(['next'])
  })

  it('never adds these templates to Monthly', () => {
    expect(buildWeeklyStories(snapshot(), histories(), { ...edition, id: 'monthly', label: 'Monthly' }, [event('future', '2026-11-09')], now)).toEqual([])
  })
})
