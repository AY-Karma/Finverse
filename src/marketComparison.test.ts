import { describe, expect, it } from 'vitest'
import { COMPARISON_PERIODS, describeComparison, describeMovement, historyForPeriod, periodAvailable } from './marketComparison'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 10, 20)
const history = [400, 200, 100, 20, 0].map((daysAgo) => ({ at: now - daysAgo * DAY }))

describe('comparison periods', () => {
  it('keeps only the points inside the window, and everything for all', () => {
    expect(historyForPeriod(history, '1m', now)).toHaveLength(2)
    expect(historyForPeriod(history, '6m', now)).toHaveLength(3)
    expect(historyForPeriod(history, 'all', now)).toBe(history)
  })

  it('offers a window only when the history reaches back to its start', () => {
    expect(COMPARISON_PERIODS.map((period) => periodAvailable(history, period.id, now))).toEqual([true, true, true, true, true])
    expect(periodAvailable(history.slice(2), '1y', now)).toBe(false)
    expect(periodAvailable(history.slice(2), '6m', now)).toBe(false)
    expect(periodAvailable(history.slice(2), 'all', now)).toBe(true)
  })
})

describe('describeMovement', () => {
  it('uses a word and an unsigned amount', () => {
    expect(describeMovement(-8.04)).toEqual({ verb: 'fell', amount: '8.0%', tone: 'down' })
    expect(describeMovement(3.26)).toEqual({ verb: 'rose', amount: '3.3%', tone: 'up' })
    expect(describeMovement(0.04)).toEqual({ verb: 'was flat', amount: '0.0%', tone: '' })
  })
})

describe('describeComparison', () => {
  it.each([
    [-8, -1, 'You fell more than NIFTY 50', '7.0 points', 'down'],
    [-1, -8, 'You fell less than NIFTY 50', '7.0 points', 'up'],
    [12, 5, 'You gained more than NIFTY 50', '7.0 points', 'up'],
    [5, 12, 'NIFTY 50 gained more than you', '7.0 points', 'down'],
    [4, -3, 'You rose while NIFTY 50 fell', '7.0 points', 'up'],
    [-4, 3, 'You fell while NIFTY 50 rose', '7.0 points', 'down'],
    [0, -3, 'You were flat while NIFTY 50 fell', '3.0 points', 'up'],
    [0, 3, 'You were flat while NIFTY 50 rose', '3.0 points', 'down'],
    [10, 10, 'In line with NIFTY 50', null, ''],
    [10.02, 10, 'In line with NIFTY 50', null, ''],
  ])('%s vs %s', (mine, theirs, text, points, tone) => {
    expect(describeComparison(mine, theirs, 'NIFTY 50')).toEqual({ text, points, tone })
  })
})

it('measures the gap on unrounded returns so it matches the chart difference', () => {
  expect(describeComparison(5.74, 6.6, 'NIFTY 50')).toEqual({ text: 'NIFTY 50 gained more than you', points: '0.9 points', tone: 'down' })
})
