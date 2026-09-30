import { describe, expect, it, vi } from 'vitest'
import { createSharedRequest } from './sharedRequest'

describe('shared market requests', () => {
  it('shares work without one subscriber cancelling another', async () => {
    const request = createSharedRequest<number>()
    const first = new AbortController()
    let underlying!: AbortSignal
    let complete!: (value: number) => void
    const load = vi.fn((signal: AbortSignal) => {
      underlying = signal
      return new Promise<number>((resolve) => { complete = resolve })
    })
    const one = request('quote', load, first.signal)
    const failure = expect(one).rejects.toMatchObject({ name: 'AbortError' })
    const two = request('quote', load)
    await Promise.resolve()
    first.abort()
    await failure
    expect(load).toHaveBeenCalledTimes(1)
    expect(underlying.aborted).toBe(false)
    complete(123)
    await expect(two).resolves.toBe(123)
  })

  it('aborts upstream work once every subscriber leaves and allows a fresh request', async () => {
    const request = createSharedRequest<number>()
    const controller = new AbortController()
    let underlying!: AbortSignal
    const load = vi.fn((signal: AbortSignal) => { underlying = signal; return new Promise<number>(() => {}) })
    const pending = request('quote', load, controller.signal)
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    controller.abort()
    await failure
    expect(underlying.aborted).toBe(true)
    await expect(request('quote', async () => 456)).resolves.toBe(456)
  })
})
