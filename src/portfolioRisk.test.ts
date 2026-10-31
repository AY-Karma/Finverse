import { describe, expect, it } from 'vitest'
import { calculatePortfolioRisk } from './portfolioRisk'

const point = (date: string, value: number) => ({ at: Date.parse(`${date}T00:00:00+05:30`), value })

describe('portfolio risk from observed closes', () => {
  it('keeps the dates and size of a recovered drawdown', () => {
    const history = [point('2026-09-21', 100), point('2026-09-22', 50), point('2026-09-23', 100)]
    expect(calculatePortfolioRisk(history)).toMatchObject({ worst: -50, current: 0, peakValue: 100, peakAt: history[2].at, currentValue: 100, daysBelowPeak: 0, worstAt: history[1].at, worstPeakAt: history[0].at })
  })

  it('keeps the exact peak and latest value behind the current drop', () => {
    const risk = calculatePortfolioRisk([point('2026-09-21', 12000.75), point('2026-09-22', 15000.5), point('2026-09-23', 13400.25)])
    expect(risk.peakValue).toBe(15000.5)
    expect(risk.currentValue).toBe(13400.25)
    expect(risk.current).toBeCloseTo((13400.25 - 15000.5) / 15000.5 * 100)
  })

  it('uses the most recent equal peak for time below peak', () => {
    const history = [point('2026-09-21', 100), point('2026-09-22', 80), point('2026-09-23', 100), point('2026-09-24', 90)]
    expect(calculatePortfolioRisk(history)).toMatchObject({ peakAt: history[2].at, daysBelowPeak: 1 })
  })

  it('counts IST calendar days below peak, including weekends', () => {
    const history = [
      { at: Date.parse('2026-09-25T23:50:00+05:30'), value: 100 },
      { at: Date.parse('2026-09-28T00:10:00+05:30'), value: 90 },
    ]
    expect(calculatePortfolioRisk(history)).toMatchObject({ daysBelowPeak: 3, historyDays: 3 })
  })

  it('leaves history-based readings unavailable without a positive peak or observed sessions', () => {
    expect(calculatePortfolioRisk([])).toMatchObject({ peakAt: null, daysBelowPeak: null, downSessions: 0, observedSessions: 0, downSessionPct: null })
    expect(calculatePortfolioRisk([point('2026-09-21', 0)])).toMatchObject({ daysBelowPeak: null, downSessionPct: null })
  })

  it('counts down, flat and up sessions with flat sessions in the denominator', () => {
    const history = [100, 90, 90, 99].map((value, index) => point(`2026-09-${21 + index}`, value))
    expect(calculatePortfolioRisk(history)).toMatchObject({ downSessions: 1, observedSessions: 3 })
    expect(calculatePortfolioRisk(history).downSessionPct).toBeCloseTo(100 / 3)
  })

  it('annualizes consecutive closes across a weekend and a known NSE holiday', () => {
    const history = [point('2026-09-30', 100), point('2026-10-01', 110), point('2026-10-05', 99)]
    // Daily returns of +10% and -10%, with sample standard deviation sqrt(0.02).
    expect(calculatePortfolioRisk(history).volatility).toBeCloseTo(Math.sqrt(0.02 * 252) * 100)
    expect(calculatePortfolioRisk(history)).toMatchObject({ downSessions: 1, observedSessions: 2, downSessionPct: 50 })
  })

  it('excludes multi-session gaps and the latest app valuation from daily volatility', () => {
    const closes = [point('2026-09-21', 100), point('2026-09-22', 110), point('2026-09-23', 99)]
    const expected = calculatePortfolioRisk(closes).volatility
    expect(calculatePortfolioRisk([...closes, point('2026-09-29', 500)]).volatility).toBe(expected)
    expect(calculatePortfolioRisk([...closes, { ...point('2026-09-24', 500), isCurrent: true }]).volatility).toBe(expected)
    expect(calculatePortfolioRisk([...closes, point('2026-09-29', 500), { ...point('2026-09-30', 250), isCurrent: true }, point('2026-10-01', 100)])).toMatchObject({ downSessions: 1, observedSessions: 2, downSessionPct: 50 })
  })

  it('leaves volatility unavailable with sparse closes or too few daily returns', () => {
    expect(calculatePortfolioRisk([point('2026-01-01', 100), point('2026-02-01', 80), point('2026-03-01', 110)]).volatility).toBeNull()
    expect(calculatePortfolioRisk([point('2026-09-21', 100), point('2026-09-22', 110)]).volatility).toBeNull()
  })
})
