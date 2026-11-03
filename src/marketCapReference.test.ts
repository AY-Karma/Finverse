// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MARKET_CAP_REFERENCE_TTL } from './marketCapProtocol'

const sourceUrl = 'https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx'
const reference = {
  asOf: '2026-06-30', sourceUrl,
  records: Array.from({ length: 250 }, (_, index) => ({
    asOf: '2026-06-30', isin: `IN${String(index).padStart(9, '0')}0`, name: `Company ${index}`,
    band: 'large', weight: 100, parentIsin: '', source: sourceUrl,
  })),
}
const fetcher = vi.fn()

beforeEach(() => {
  vi.resetModules()
  sessionStorage.clear()
  fetcher.mockReset().mockImplementation(async () => new Response(JSON.stringify(reference)))
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear() })

it('restores a fresh public reference synchronously after a page reload without fetching again', async () => {
  const first = await import('./marketCapReference')
  await first.loadMarketCapReference()
  vi.resetModules()
  const reloaded = await import('./marketCapReference')
  expect(reloaded.getCachedMarketCapReference()).toEqual(reference)
  await expect(reloaded.loadMarketCapReference()).resolves.toEqual(reference)
  expect(fetcher).toHaveBeenCalledOnce()
})

it('replaces expired references instead of extending their lifetime on reload', async () => {
  const first = await import('./marketCapReference')
  await first.loadMarketCapReference()
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + MARKET_CAP_REFERENCE_TTL + 1)
  vi.resetModules()
  const reloaded = await import('./marketCapReference')
  expect(reloaded.getCachedMarketCapReference()).toBeNull()
  await reloaded.loadMarketCapReference()
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('still loads classifications when browser storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full') })
  const module = await import('./marketCapReference')
  await expect(module.loadMarketCapReference()).resolves.toEqual(reference)
  expect(module.getCachedMarketCapReference()).toEqual(reference)
})

it('rejects an altered session reference and fetches a verified replacement', async () => {
  const first = await import('./marketCapReference')
  await first.loadMarketCapReference()
  const key = sessionStorage.key(0)!
  const stored = JSON.parse(sessionStorage.getItem(key)!)
  stored.reference.records[0].source = 'https://unverified.example/classifications.xlsx'
  sessionStorage.setItem(key, JSON.stringify(stored))
  vi.resetModules()
  const reloaded = await import('./marketCapReference')
  expect(reloaded.getCachedMarketCapReference()).toBeNull()
  await expect(reloaded.loadMarketCapReference()).resolves.toEqual(reference)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
