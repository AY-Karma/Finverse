import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPeriodInsights } from './periodStoryInsights'
import { investmentWorkspace } from './investmentWorkspace'
import type { Position } from './types'
import { quoteKey } from './valuation'

const monthly = { from: '2026-10-01', through: '2026-10-31', label: 'Monthly' }
const weekly = { from: '2026-11-02', through: '2026-11-06', label: 'Weekly' }
const position = (ticker: string): Position => ({ id: ticker, ticker, name: ticker, type: 'stock', exchange: 'NSE', currency: 'INR', quantity: 1, buyPrice: 20, invested: 20, lastPrice: 999 })
const positions = ['AAA', 'BBB', 'CCC', 'DDD'].map(position)
const snapshot = (holdings = positions) => investmentWorkspace.readSnapshot({ folios: [{ id: 'a', name: 'Account', importedAt: 1, positions: holdings }], quotes: {} })
const endpoints = (closing: number[]) => Object.fromEntries(positions.map((holding, index) => [quoteKey(holding), [{ date: '2026-09-30', close: 100 }, { date: '2026-10-30', close: closing[index] }]]))
const daily = (dates: string[], closes: number[]) => Object.fromEntries(positions.map((holding) => [quoteKey(holding), dates.map((date, index) => ({ date, close: closes[index] }))]))

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T10:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe('research-backed personal stories', () => {
  it('explains gain/loss cancellation using matching historical endpoints rather than current P&L', () => {
    const stories = buildPeriodInsights(snapshot(), endpoints([120, 110, 80, 100]), monthly)
    expect(stories).toHaveLength(1)
    expect(stories[0]).toMatchObject({ kind: 'bridge', title: 'Losses absorbed 67% of the lift.', insight: { kind: 'bridge', gains: 30, losses: -20, net: 10, leader: 'CCC', leaderChange: -20, covered: 4, total: 4 } })
    expect(stories[0].note).toContain("today's quantities")
  })

  it('handles drag crossing zero and preserves meaningful zero net cancellation', () => {
    const negative = buildPeriodInsights(snapshot(), endpoints([110, 105, 75, 100]), monthly)[0]
    expect(negative).toMatchObject({ title: 'Losses outweighed the lift.', insight: { gains: 15, losses: -25, net: -10 } })
    const flat = buildPeriodInsights(snapshot(), endpoints([120, 110, 70, 100]), monthly)[0]
    expect(flat).toMatchObject({ tone: 'neutral', insight: { gains: 30, losses: -30, net: 0 } })
  })

  it('uses a concentrated source of gains as a sparse-history fallback and never divides by net change', () => {
    const stories = buildPeriodInsights(snapshot(), endpoints([120, 102, 101, 101]), monthly)
    expect(stories).toHaveLength(1)
    expect(stories[0]).toMatchObject({ kind: 'driver', insight: { symbol: 'AAA', change: 20, gains: 24, losses: 0 } })
    expect(stories[0].insight?.kind === 'driver' && stories[0].insight.share).toBeCloseTo(20 / 24 * 100)
  })

  it('does not manufacture a personal page from weak, missing or flat observations', () => {
    expect(buildPeriodInsights(snapshot(), {}, monthly)).toEqual([])
    expect(buildPeriodInsights(snapshot(), endpoints([100, 100, 100, 100]), monthly)).toEqual([])
    expect(buildPeriodInsights(snapshot(), endpoints([100.01, 100.01, 99.99, 100]), monthly)).toEqual([])
  })

  it('exposes partial endpoint coverage and refuses to align unmatched dates', () => {
    const partial = buildPeriodInsights(snapshot([...positions, position('MISSING')]), endpoints([120, 110, 80, 100]), monthly)
    expect(partial[0].insight).toMatchObject({ covered: 4, total: 5 })
    const unmatched = endpoints([120, 110, 80, 100])
    unmatched[quoteKey(positions[1])][1].date = '2026-10-29'
    expect(buildPeriodInsights(snapshot(), unmatched, monthly)).toEqual([])
  })

  it('finds the consequential regular session from a complete same-cohort daily series', () => {
    const histories = daily(['2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'], [100, 101, 100, 110, 109, 110])
    const stories = buildPeriodInsights(snapshot(), histories, weekly)
    expect(stories).toHaveLength(1)
    expect(stories[0]).toMatchObject({ kind: 'session', title: 'Wednesday made the biggest move.', insight: { kind: 'session', date: '2026-11-04', change: 40, changePct: 10, covered: 4, total: 4 } })
    expect(stories[0].insight?.kind === 'session' && stories[0].insight.days).toHaveLength(5)
  })

  it('does not mislabel a multi-session gap as a one-day move', () => {
    const histories = daily(['2026-10-30', '2026-11-02', '2026-11-04', '2026-11-05', '2026-11-06'], [100, 101, 110, 109, 110])
    expect(buildPeriodInsights(snapshot(), histories, weekly)).toEqual([])
  })

  it('excludes mutual funds from Weekly stock-session coverage and eligibility', () => {
    const fund: Position = { ...position('FUND'), type: 'mutual-fund' }
    const histories = daily(['2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'], [100, 101, 100, 110, 109, 110])
    const stories = buildPeriodInsights(snapshot([...positions, fund]), histories, weekly)
    expect(stories[0]).toMatchObject({ kind: 'session', insight: { covered: 4, total: 4 } })
  })

  it('does not call an unfinished current trading session the period standout', () => {
    vi.setSystemTime(new Date('2026-11-06T06:00:00Z'))
    const histories = daily(['2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'], [100, 101, 100, 110, 109, 110])
    expect(buildPeriodInsights(snapshot(), histories, weekly)).toEqual([])
  })

  it('leaves an actual exchange holiday out of the session map rather than inventing a flat day', () => {
    const period = { from: '2026-09-28', through: '2026-10-02', label: 'Weekly' }
    const histories = daily(['2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'], [100, 101, 100, 110, 111])
    const selected = buildPeriodInsights(snapshot(), histories, period).find((story) => story.kind === 'session')!
    expect(selected.insight?.kind === 'session' && selected.insight.days.map((day) => day.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'])
  })

  it('omits an ambiguous abrupt price discontinuity without claiming a market cause', () => {
    const histories = daily(['2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'], [100, 101, 100, 150, 149, 150])
    expect(buildPeriodInsights(snapshot(), histories, weekly)).toEqual([])
  })
})
