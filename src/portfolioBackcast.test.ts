import { describe, expect, it, vi } from 'vitest'
import type { Position } from './types'
import { applyPortfolioQuoteOverlay, buildPortfolioBackcast } from './portfolioBackcast'
import { calculatePortfolioRisk } from './portfolioRisk'
import { quoteKey } from './valuation'

const holding = (i: number): Position => ({ id: String(i), ticker: `BACK${i}`, name: '', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: i === 0 ? 120 : null })

describe('backcast coverage and cancellation', () => {
  it('retains the historical close when only an imported fallback is available', async () => {
    const source = { history: vi.fn(async () => [{ date: '2026-09-28', close: 200 }, { date: '2026-09-29', close: 220 }]) }
    const positions = [{ ...holding(0), lastPrice: 100 }]
    const history = await buildPortfolioBackcast(positions, source)
    const result = applyPortfolioQuoteOverlay(history, positions, {})
    expect(calculatePortfolioRisk(result.points).worst).toBe(0)
    expect(result.points.map((point) => point.value)).toEqual([200, 220])
    expect(result.points.at(-1)?.at).toBe(Date.parse('2026-09-29T00:00:00+05:30'))
    const currentPositions = [{ ...positions[0], lastPrice: 300 }, { ...holding(1), lastPrice: 100 }]
    expect(applyPortfolioQuoteOverlay(history, currentPositions, {}).coveragePct).toBe(75)
  })

  it('excludes USD and unsupported native currencies from INR history values and cost', async () => {
    const inr = { ...holding(0), currency: 'INR' as const }
    const usd = { ...holding(1), ticker: 'AAPL', exchange: 'NASDAQ' as const, currency: 'USD' as const, lastPrice: 200, invested: 200 }
    const unknown = { ...holding(2), reportedCurrency: 'EUR', lastPrice: 300, invested: 300 }
    const source = { history: vi.fn(async (_position: Position) => [{ date: '2026-09-28', close: 100 }, { date: '2026-09-29', close: 120 }]) }
    const result = await buildPortfolioBackcast([inr, usd, unknown], source)
    expect(source.history).toHaveBeenCalledTimes(1)
    expect(source.history.mock.calls[0]?.[0]).toEqual(inr)
    expect(result).toMatchObject({ holdingsIncluded: 1, holdingsTotal: 3 })
    expect(result.points.map((point) => point.value)).toEqual([100, 120])
    expect(result.points.every((point) => point.invested === 100)).toBe(true)
  })

  it('retains a one-day 50% trough in long histories for risk calculations', async () => {
    const points = Array.from({ length: 1000 }, (_, index) => ({
      date: new Date(Date.UTC(2023, 0, 1 + index)).toISOString().slice(0, 10),
      close: index === 2 ? 50 : 100,
    }))
    const result = await buildPortfolioBackcast([{ ...holding(0), lastPrice: null }], { history: vi.fn(async () => points) }, 1098)
    expect(result.points).toHaveLength(1000)
    expect(Math.min(...result.points.map((point) => point.value))).toBe(50)
    expect(calculatePortfolioRisk(result.points).worst).toBe(-50)
  })

  it('does not append an artificial loss when an included holding has no current price', async () => {
    const source = { history: vi.fn(async () => [{ date: '2026-09-28', close: 100 }, { date: '2026-09-29', close: 120 }]) }
    const result = await buildPortfolioBackcast([holding(0), holding(1)], source)
    expect(result.holdingsIncluded).toBe(2)
    expect(result.points[result.points.length - 1].value).toBe(240)
    expect(result.points).toHaveLength(2)
  })

  it('stops active history requests and the queued holdings on cancellation', async () => {
    const controller = new AbortController()
    const signals: AbortSignal[] = []
    const source = { history: vi.fn((_position, _from, _to, signal?: AbortSignal) => {
      signals.push(signal!)
      return new Promise<never>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }))
    }) }
    const pending = buildPortfolioBackcast(Array.from({ length: 20 }, (_, i) => holding(i)), source, 366, controller.signal)
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(source.history).toHaveBeenCalledTimes(6)
    controller.abort()
    await failure
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(source.history).toHaveBeenCalledTimes(6)
  })

  it('uses only shared historical dates and a fully covered provider date for the overlay', async () => {
    const positions = [holding(0), holding(1)]
    const source = { history: vi.fn(async (position: Position) => position.id === '0'
      ? [{ date: '2026-09-28', close: 200 }, { date: '2026-09-29', close: 220 }, { date: '2026-09-30', close: 240 }]
      : [{ date: '2026-09-28', close: 100 }, { date: '2026-09-29', close: 110 }]) }
    const history = await buildPortfolioBackcast(positions, source)
    expect(history.points.map((point) => point.value)).toEqual([300, 330])
    const at = Date.parse('2026-09-30T15:30:00+05:30')
    const quotes = { [quoteKey(positions[0])]: { price: 240, at, source: 'yahoo' as const } }
    expect(applyPortfolioQuoteOverlay(history, positions, quotes).points).toBe(history.points)
    const mixedDates = { ...quotes, [quoteKey(positions[1])]: { price: 100, at: at - 24 * 3600000, source: 'yahoo' as const } }
    expect(applyPortfolioQuoteOverlay(history, positions, mixedDates).points).toBe(history.points)
    const aligned = applyPortfolioQuoteOverlay(history, positions, { ...mixedDates, [quoteKey(positions[1])]: { price: 120, at: at - 3600000, source: 'nse-close' } })
    expect(aligned.points.at(-1)).toEqual({ at, value: 360, invested: 200, isCurrent: true })
    expect(aligned.currentObservation).toEqual({ from: at - 3600000, to: at })
    expect(history.points).toHaveLength(2)
    expect(source.history).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid, stale, future and incompatible provider observations', async () => {
    const positions = [holding(0)]
    const history = await buildPortfolioBackcast(positions, { history: vi.fn(async () => [{ date: '2026-09-28', close: 200 }, { date: '2026-09-29', close: 220 }]) })
    for (const quote of [
      { price: 100, at: Number.NaN, source: 'yahoo' as const },
      { price: 100, at: Date.now() + 24 * 3600000, source: 'yahoo' as const },
      { price: 100, at: Date.parse('2026-09-28T15:30:00+05:30'), source: 'yahoo' as const },
      { price: 100, at: Date.parse('2026-09-29T09:30:00+05:30'), source: 'yahoo' as const },
      { price: Number.NaN, at: Date.parse('2026-09-30T15:30:00+05:30'), source: 'yahoo' as const },
      { price: 100, at: Date.parse('2026-09-30T00:00:00+05:30'), source: 'nav' as const },
    ]) expect(applyPortfolioQuoteOverlay(history, positions, { [quoteKey(positions[0])]: quote }).points).toBe(history.points)
  })

  it('preserves daily volatility when a NAV quote matches the latest historical close', async () => {
    const positions = [{ ...holding(0), type: 'mutual-fund' as const, name: 'Audit Fund Direct Growth' }]
    const history = await buildPortfolioBackcast(positions, { history: vi.fn(async () => [
      { date: '2026-09-28', close: 100 }, { date: '2026-09-29', close: 110 }, { date: '2026-09-30', close: 99 },
    ]) })
    const originalRisk = calculatePortfolioRisk(history.points)
    expect(originalRisk.volatility).not.toBeNull()
    const result = applyPortfolioQuoteOverlay(history, positions, { [quoteKey(positions[0])]: {
      price: 99, at: Date.parse('2026-09-30T00:00:00+05:30'), source: 'nav',
    } })
    expect(calculatePortfolioRisk(result.points)).toEqual(originalRisk)
  })

  it('uses an intraday quote without treating an unfinished equity bar as a closing peak', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-30T12:00:00+05:30'))
      const positions = [holding(0)]
      const history = await buildPortfolioBackcast(positions, { history: vi.fn(async () => [
        { date: '2026-09-28', close: 200 }, { date: '2026-09-29', close: 220 }, { date: '2026-09-30', close: 300 },
      ]) })
      expect(history.points.map((point) => point.value)).toEqual([200, 220])
      const result = applyPortfolioQuoteOverlay(history, positions, { [quoteKey(positions[0])]: {
        price: 210, at: Date.parse('2026-09-30T11:30:00+05:30'), source: 'yahoo',
      } })
      expect(result.points.map((point) => point.value)).toEqual([200, 220, 210])
      expect(calculatePortfolioRisk(result.points).worst).toBeCloseTo(-4.54545)
    } finally {
      vi.useRealTimers()
    }
  })
})
