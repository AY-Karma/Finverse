import { describe, expect, it } from 'vitest'
import { investmentWorkspace } from './investmentWorkspace'
import { buildRecapStories, recapClosingStory } from './recapStories'
import type { StoryEdition } from './recapSchedule'
import type { Folio, Position } from './types'
import { quoteKey } from './valuation'

const monthly: StoryEdition = { id: 'monthly', key: 'monthly:2026-10', label: 'Monthly', from: '2026-10-01', through: '2026-10-31' }
const weekly: StoryEdition = { id: 'weekly', key: 'weekly:2026-11-02', label: 'Weekly', from: '2026-11-02', through: '2026-11-06' }
const position = (ticker: string, quantity = 1): Position => ({ id: ticker, ticker, name: ticker, type: 'stock', exchange: 'NSE', currency: 'INR', quantity, buyPrice: 100, invested: 100 * quantity, lastPrice: 110 })
const folio = (positions: Position[], patch: Partial<Folio> = {}): Folio => ({ id: 'folio', name: 'Main account', importedAt: 1, positions, ...patch })
const snapshot = (folios: Folio[]) => investmentWorkspace.readSnapshot({ folios, quotes: {} })

describe('recap story sequence', () => {
  it('keeps Monthly contribution insight distinct from Weekly sessions and prioritizes a recorded monthly update', () => {
    const positions = [position('AAA'), position('BBB'), position('CCC')]
    const dates = ['2026-09-30', ...[1, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 21, 22, 23, 26, 27, 28, 29, 30].map((day) => `2026-10-${String(day).padStart(2, '0')}`)]
    const closes = dates.map((_, index) => index < dates.length - 3 ? [100, 100, 100] : index === dates.length - 3 ? [110, 120, 90] : index === dates.length - 2 ? [110, 120, 89] : [111, 121, 89])
    const histories = Object.fromEntries(positions.map((holding, index) => [quoteKey(holding), dates.map((date, day) => ({ date, close: closes[day][index] }))]))
    const current = snapshot([folio(positions)])
    expect(buildRecapStories(current, histories, monthly, '2026-11-07').map((story) => story.kind)).toEqual(['bridge', 'winners', 'laggards', 'covered'])
    const changed = snapshot([folio(positions, {
      statement: { id: 'current', fileName: 'current.csv', statementDate: '2026-10-31', completeness: 'complete' },
      previousRevision: { importedAt: 1, statement: { id: 'previous', fileName: 'previous.csv', statementDate: '2026-09-30', completeness: 'complete' }, positions: [{ ...positions[0], quantity: .5, invested: 50 }, ...positions.slice(1)] },
    })])
    const stories = buildRecapStories(changed, histories, monthly, '2026-11-07')
    expect(stories.map((story) => story.kind)).toEqual(['bridge', 'updates', 'winners', 'laggards', 'covered'])
    expect(stories[0].insight).toMatchObject({ kind: 'bridge', gains: 32, losses: -11, net: 21, covered: 3, total: 3 })
    expect(stories[1].rows[0]).toMatchObject({ label: 'AAA', value: 'Quantity updated', detail: '0.5 → 1 units' })
  })

  it('retains honest Monthly performer placeholders without inventing unsupported insights', () => {
    const stories = buildRecapStories(snapshot([folio([position('AAA')])]), {}, monthly, '2026-11-07')
    expect(stories.map((story) => story.kind)).toEqual(['winners', 'laggards', 'covered'])
    expect(stories[0]).toMatchObject({ metric: '', metricLabel: 'Period prices are unavailable.', chart: [] })
    expect(stories[1]).toMatchObject({ metric: '', chart: [], metricLabel: 'Period prices are unavailable.' })
    expect(stories[2].title).toBe("You're covered.")
  })

  it('distinguishes saved additions and removals with their corresponding tones', () => {
    const current = snapshot([folio([position('ADDED', 2)], {
      statement: { id: 'current', fileName: 'current.csv', statementDate: '2026-10-31', completeness: 'complete' },
      previousRevision: { importedAt: 1, statement: { id: 'previous', fileName: 'previous.csv', statementDate: '2026-09-30', completeness: 'complete' }, positions: [position('REMOVED', 3)] },
    })])
    const updates = buildRecapStories(current, {}, monthly, '2026-11-07').find((story) => story.kind === 'updates')!
    expect(updates.rows).toEqual([
      expect.objectContaining({ label: 'REMOVED', value: 'Removed', detail: '3 → 0 units', tone: 'negative' }),
      expect.objectContaining({ label: 'ADDED', value: 'Added', detail: '0 → 2 units', tone: 'positive' }),
    ])
  })

  it('does not fill a sparse Weekly recap with Monthly performers or contribution insights', () => {
    const stories = buildRecapStories(snapshot([folio([position('AAA')])]), {}, weekly, '2026-11-07')
    expect(stories.map((story) => story.kind)).toEqual(['covered'])
    expect(stories[0].metric).toContain('2–6 Nov 2026')
  })

  it('uses Weekly session pulse and sector drivers in place of Monthly contribution and performer pages', () => {
    const positions = [position('AAA'), position('BBB'), { ...position('CCC'), sector: 'Consumer goods' }].map((holding, index) => ({ ...holding, sector: index < 2 ? 'Technology' : holding.sector }))
    const dates = ['2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
    const closes = [[100, 100, 100], [100, 100, 100], [100, 100, 100], [110, 120, 90], [110, 120, 89], [111, 121, 89]]
    const histories = Object.fromEntries(positions.map((holding, index) => [quoteKey(holding), dates.map((date, day) => ({ date, close: closes[day][index] }))]))
    const stories = buildRecapStories(snapshot([folio(positions)]), histories, weekly, '2026-11-07')
    expect(stories.map((story) => story.kind)).toEqual(['session', 'weekly-sectors', 'covered'])
    expect(stories[0].insight).toMatchObject({ kind: 'session', date: '2026-11-04', change: 20, covered: 3, total: 3 })
    expect(stories[1].weekly).toMatchObject({ kind: 'sectors', net: 21, sectors: [{ label: 'Technology', change: 32 }, { label: 'Consumer goods', change: -11 }] })
  })

  it('ranks period price percentages rather than money or current profit and charts actual period closes', () => {
    const positions = [position('LARGE', 100), position('FAST'), position('DOWN')]
    const histories = Object.fromEntries(positions.map((holding, index) => [quoteKey(holding), [
      { date: '2026-09-30', close: 100 }, { date: '2026-10-30', close: [105, 120, 90][index] }, { date: '2026-11-06', close: 900 },
    ]]))
    const stories = buildRecapStories(snapshot([folio(positions)]), histories, monthly, '2026-11-07')
    expect(stories.find((story) => story.kind === 'winners')).toMatchObject({ metricLabel: 'FAST', metric: '+20.00%', chart: [100, 120], rows: [{ label: 'LARGE', value: '+5.00%' }] })
    expect(stories.find((story) => story.kind === 'laggards')).toMatchObject({ metricLabel: 'DOWN', metric: '-10.00%', chart: [100, 90] })
  })

  it('keeps recorded folio changes exclusive to Monthly', () => {
    const account = folio([position('AAA', 2)], {
      statement: { id: 'current', fileName: 'current.csv', statementDate: '2026-10-31', completeness: 'complete' },
      previousRevision: { importedAt: 1, statement: { id: 'previous', fileName: 'previous.csv', statementDate: '2026-09-30', completeness: 'complete' }, positions: [position('AAA')] },
    })
    const current = snapshot([account])
    expect(buildRecapStories(current, {}, monthly, '2026-11-07').find((story) => story.kind === 'updates')).toMatchObject({ metric: '1', rows: [{ label: 'AAA', value: 'Quantity updated', detail: '1 → 2 units' }] })
    expect(buildRecapStories(current, {}, weekly, '2026-11-07').some((story) => story.kind === 'updates')).toBe(false)
    const unchanged = snapshot([{ ...account, positions: [position('AAA')], previousRevision: { ...account.previousRevision!, positions: [{ ...position('AAA'), lastPrice: 100 }] } }])
    expect(buildRecapStories(unchanged, {}, monthly, '2026-11-07').some((story) => story.kind === 'updates')).toBe(false)
  })

  it('does not reuse old revisions or interpret a newly imported folio as a purchase', () => {
    const account = folio([position('AAA')], { lastOperation: 'added', operationAt: Date.parse('2026-10-10T10:00:00Z') })
    expect(buildRecapStories(snapshot([account]), {}, monthly, '2026-11-07').find((story) => story.kind === 'updates')).toMatchObject({ rows: [{ label: 'Main account', value: 'Folio added' }] })
    expect(buildRecapStories(snapshot([{ ...account, operationAt: Date.parse('2026-09-10T10:00:00Z') }]), {}, monthly, '2026-11-07').some((story) => story.kind === 'updates')).toBe(false)
  })

  it('does not label a flat or entirely positive period as a loss', () => {
    const holding = position('AAA')
    const histories = { [quoteKey(holding)]: [{ date: '2026-09-30', close: 100 }, { date: '2026-10-30', close: 110 }] }
    const stories = buildRecapStories(snapshot([folio([holding])]), histories, monthly, '2026-11-07')
    expect(stories.find((story) => story.kind === 'laggards')).toMatchObject({ metric: '', chart: [], tone: 'neutral', metricLabel: 'No negative price moves this period.' })
  })

  it('retains only a public closing page under privacy and handles month and year boundaries', () => {
    const stories = buildRecapStories(snapshot([folio([position('PRIVATE')])]), {}, monthly, '2026-11-07', true)
    expect(stories.map((story) => story.kind)).toEqual(['covered'])
    expect(JSON.stringify(stories)).not.toContain('PRIVATE')
    expect(stories[0].metric).toBe('October')
    expect(stories[0].metricLabel).toBe('')
    const closing = recapClosingStory({ ...weekly, from: '2026-12-28', through: '2027-01-01' })
    expect(closing.metric).toContain('2026')
    expect(closing.metric).toContain('2027')
  })

  it('does not construct unfinished or invalid recaps', () => {
    const current = snapshot([folio([position('AAA')])])
    expect(buildRecapStories(current, {}, weekly, '2026-11-03')).toEqual([])
    expect(buildRecapStories(current, {}, { ...monthly, from: '2026-02-30' }, '2026-11-07')).toEqual([])
  })
})
