import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequestBudget, readBoundedText } from '../api/requestBudget'

afterEach(() => vi.useRealTimers())

describe('public API budgets', () => {
  it('returns a bounded deadline response even if a provider ignores cancellation', async () => {
    vi.useFakeTimers()
    const budget = createRequestBudget()
    let signal!: AbortSignal
    const response = budget('test', 1000, (requestSignal) => { signal = requestSignal; return new Promise<Response>(() => {}) })
    await vi.advanceTimersByTimeAsync(9000)
    expect(signal.aborted).toBe(true)
    expect((await response).status).toBe(502)
  })

  it('caps streaming bodies without trusting Content-Length', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)) },
      cancel() { cancelled = true },
    })
    await expect(readBoundedText(new Response(body), 10, new AbortController().signal)).rejects.toThrow('too large')
    expect(cancelled).toBe(true)
  })

  it('limits the rolling request count and admits work after reset', async () => {
    let now = 0
    const budget = createRequestBudget(() => now)
    const load = vi.fn(async () => Response.json({ ok: true }))
    for (let i = 0; i < 600; i++) expect((await budget('cached', 120_000, load)).status).toBe(200)
    expect((await budget('cached', 120_000, load)).status).toBe(429)
    expect(load).toHaveBeenCalledTimes(1)
    now = 60_000
    expect((await budget('cached', 120_000, load)).status).toBe(200)
  })
})
