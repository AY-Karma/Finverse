import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequestBudget, readBoundedText } from '../api/_requestBudget'

afterEach(() => vi.useRealTimers())

describe('public API budgets', () => {
  it('chooses the successful cache lifetime after the provider result is loaded', async () => {
    let now = 0, ttl = 300_000, partial = true
    const budget = createRequestBudget(() => now)
    const lifetime = vi.fn(() => ttl)
    const load = vi.fn(async () => {
      ttl = partial ? 15_000 : 300_000
      return Response.json({ partial })
    })
    expect(await (await budget('events', lifetime, load)).json()).toEqual({ partial: true })
    now = 14_999
    await budget('events', lifetime, load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(lifetime).toHaveBeenCalledTimes(1)
    now = 15_000; partial = false
    expect(await (await budget('events', lifetime, load)).json()).toEqual({ partial: false })
    now += 20_000
    await budget('events', lifetime, load)
    expect(load).toHaveBeenCalledTimes(2)
    expect(lifetime).toHaveBeenCalledTimes(2)
  })

  it('shrinks the edge lifetime of a replayed response to what is left of the local cache', async () => {
    let at = 1_000_000
    const budget = createRequestBudget(() => at)
    const load = vi.fn(async () => new Response('ok', { headers: { 'Vercel-CDN-Cache-Control': 'public, s-maxage=1800, must-revalidate', 'Cache-Control': 'no-store' } }))
    const first = await budget('trend', 3_600_000, load)
    expect(first.headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=1800, must-revalidate')
    at += 2_700_000 // 45 minutes later: the edge copy has expired but the local cache still has 15 minutes
    const replay = await budget('trend', 3_600_000, load)
    expect(load).toHaveBeenCalledOnce()
    expect(replay.headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=900, must-revalidate')
    expect(replay.headers.get('cache-control')).toBe('no-store')
    at += 899_000
    expect((await budget('trend', 3_600_000, load)).headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=1, must-revalidate')
  })

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

  it('serves cached and in-flight responses without spending the provider budget', async () => {
    const budget = createRequestBudget(() => 0)
    const load = vi.fn(async () => Response.json({ ok: true }))
    const statuses = await Promise.all(Array.from({ length: 700 }, () => budget('shared', 1000, load).then((response) => response.status)))
    for (let i = 0; i < 700; i++) statuses.push((await budget('shared', 1000, load)).status)
    expect(statuses.every((status) => status === 200)).toBe(true)
    expect(load).toHaveBeenCalledOnce()
  })

  it('limits provider calls per window and admits them again after reset', async () => {
    let now = 0
    const budget = createRequestBudget(() => now)
    const load = vi.fn(async () => Response.json({ ok: true }))
    for (let i = 0; i < 600; i++) expect((await budget(`key-${i}`, 1, load)).status).toBe(200)
    expect((await budget('key-600', 1, load)).status).toBe(429)
    expect(load).toHaveBeenCalledTimes(600)
    now = 60_000
    expect((await budget('key-600', 1, load)).status).toBe(200)
  })
})
