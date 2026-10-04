import { describe, expect, it } from 'vitest'
import { calculatePortfolioRisk } from './portfolioRisk'

const point = (date: string, value: number) => ({ at: Date.parse(`${date}T00:00:00+05:30`), value })

describe('portfolio risk from observed closes', () => {
  it('keeps the dates and size of a recovered drawdown', () => {
    const history = [point('2026-09-21', 100), point('2026-09-22', 50), point('2026-09-23', 100)]
    expect(calculatePortfolioRisk(history)).toMatchObject({ worst: -50, current: 0, worstAt: history[1].at, worstPeakAt: history[0].at })
  })

  it('annualizes consecutive closes across a weekend and a known NSE holiday', () => {
    const history = [point('2026-09-30', 100), point('2026-10-01', 110), point('2026-10-05', 99)]
    // Daily returns of +10% and -10%, with sample standard deviation sqrt(0.02).
    expect(calculatePortfolioRisk(history).volatility).toBeCloseTo(Math.sqrt(0.02 * 252) * 100)
  })

  it('excludes multi-session gaps and the latest app valuation from daily volatility', () => {
    const closes = [point('2026-09-21', 100), point('2026-09-22', 110), point('2026-09-23', 99)]
    const expected = calculatePortfolioRisk(closes).volatility
    expect(calculatePortfolioRisk([...closes, point('2026-09-29', 500)]).volatility).toBe(expected)
    expect(calculatePortfolioRisk([...closes, { ...point('2026-09-24', 500), isCurrent: true }]).volatility).toBe(expected)
  })

  it('leaves volatility unavailable with sparse closes or too few daily returns', () => {
    expect(calculatePortfolioRisk([point('2026-01-01', 100), point('2026-02-01', 80), point('2026-03-01', 110)]).volatility).toBeNull()
    expect(calculatePortfolioRisk([point('2026-09-21', 100), point('2026-09-22', 110)]).volatility).toBeNull()
  })
})
