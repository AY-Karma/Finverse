import { describe, expect, it, vi } from 'vitest'
import type { Position } from './types'
import { buildPortfolioBackcast } from './portfolioBackcast'

const holding = (i: number): Position => ({ id: String(i), ticker: `BACK${i}`, name: '', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: i === 0 ? 120 : null })

describe('backcast coverage and cancellation', () => {
  it('does not append an artificial loss when an included holding has no current price', async () => {
    const source = { history: vi.fn(async () => [{ date: '2026-09-28', close: 100 }, { date: '2026-09-29', close: 120 }]) }
    const result = await buildPortfolioBackcast([holding(0), holding(1)], {}, source)
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
    const pending = buildPortfolioBackcast(Array.from({ length: 20 }, (_, i) => holding(i)), {}, source, 366, controller.signal)
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(source.history).toHaveBeenCalledTimes(4)
    controller.abort()
    await failure
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(source.history).toHaveBeenCalledTimes(4)
  })
})
