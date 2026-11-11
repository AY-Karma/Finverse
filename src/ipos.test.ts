// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpoFeed } from './ipoProtocol'

const NOW = Date.parse('2026-11-07T15:00:00Z')
function feed(): IpoFeed {
  return { issues: [{ id: 'one', name: 'Example', board: 'MAINBOARD', status: 'OPEN', openDate: null, closeDate: null, listingDate: null, allotmentDate: null, priceMin: 100, priceMax: 100, lotSize: 100, sourceUrl: 'https://www.xflot.com/ipo/example', gmp: null }], fetchedAt: NOW, stale: false, warnings: [], sources: [] }
}

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(NOW); sessionStorage.clear() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('IPO client cache', () => {
  it('shares an in-flight request and serves the validated snapshot on revisit', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(feed()))
    vi.stubGlobal('fetch', fetcher)
    const { loadIpos } = await import('./ipos')
    const [one, two] = await Promise.all([loadIpos(), loadIpos()])
    expect(one).toEqual(two)
    expect(await loadIpos()).toEqual(one)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('retains dated rows through a failed refresh and expires old disk snapshots', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(feed())).mockRejectedValue(new Error('Offline'))
    vi.stubGlobal('fetch', fetcher)
    const { loadIpos, cachedIpos } = await import('./ipos')
    await loadIpos()
    vi.setSystemTime(NOW + 61 * 60_000)
    const saved = await loadIpos()
    expect(saved.stale).toBe(true)
    expect(saved.fetchedAt).toBe(NOW)
    expect(saved.issues).toHaveLength(1)
    vi.setSystemTime(NOW + 25 * 60 * 60_000)
    expect(cachedIpos()).toBeNull()
  })

  it('rejects an untrusted source URL instead of caching it', async () => {
    const unsafe = feed()
    unsafe.issues[0].sourceUrl = 'javascript:alert(1)'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(unsafe)))
    const { loadIpos, cachedIpos } = await import('./ipos')
    await expect(loadIpos()).rejects.toThrow('IPOs could not be loaded')
    expect(cachedIpos()).toBeNull()
  })

  it('rejects an expired network feed instead of presenting old subscription dates as current', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...feed(), fetchedAt: NOW - 25 * 60 * 60_000 })))
    const { loadIpos, cachedIpos } = await import('./ipos')
    await expect(loadIpos()).rejects.toThrow('IPOs could not be loaded')
    expect(cachedIpos()).toBeNull()
  })

  it('marks an aged network feed stale even when its provider flag says fresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...feed(), fetchedAt: NOW - 2 * 60 * 60_000 })))
    const { loadIpos } = await import('./ipos')
    expect((await loadIpos()).stale).toBe(true)
  })
})
