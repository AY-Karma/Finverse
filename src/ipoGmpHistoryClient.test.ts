// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const NOW = Date.parse('2026-11-08T06:00:00Z')
const reply = (overrides = {}) => ({ slug: 'example-ipo', checkedAt: NOW, gmp: {
  source: 'GMP Today', sourceUrl: 'https://gmptoday.in/ipo/example/', amount: 0, percent: 0,
  observedAt: null, sourceUpdatedAt: null, asOfDate: '2026-10-22', sources: 2, rangeLow: 0, rangeHigh: 0,
}, ...overrides })

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(NOW); sessionStorage.clear() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('shares historical requests and restores daily observations from the browser cache', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(reply()))
  vi.stubGlobal('fetch', fetcher)
  let client = await import('./ipoGmpHistory')
  const values = await Promise.all([client.loadIpoGmpHistory('example-ipo'), client.loadIpoGmpHistory('example-ipo')])
  expect(values[0].gmp?.amount).toBe(0)
  expect(values[0].gmp?.asOfDate).toBe('2026-10-22')
  expect(fetcher).toHaveBeenCalledOnce()
  vi.resetModules()
  client = await import('./ipoGmpHistory')
  expect(await client.loadIpoGmpHistory('example-ipo')).toEqual(values[0])
  expect(fetcher).toHaveBeenCalledOnce()
})

it('rejects wrong identities and failed requests without poisoning retries', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(reply({ slug: 'another-ipo' })))
    .mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(Response.json(reply()))
  vi.stubGlobal('fetch', fetcher)
  const client = await import('./ipoGmpHistory')
  await expect(client.loadIpoGmpHistory('example-ipo')).rejects.toThrow()
  expect(client.cachedIpoGmpHistory('example-ipo')).toBeNull()
  await expect(client.loadIpoGmpHistory('example-ipo')).rejects.toThrow()
  expect((await client.loadIpoGmpHistory('example-ipo')).gmp?.amount).toBe(0)
  await expect(client.loadIpoGmpHistory('../secret')).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('expires old snapshots without altering the historical observation date', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(reply({ checkedAt: Date.now() })))
  vi.stubGlobal('fetch', fetcher)
  const client = await import('./ipoGmpHistory')
  await client.loadIpoGmpHistory('example-ipo')
  vi.setSystemTime(NOW + 59 * 60_000)
  expect(client.cachedIpoGmpHistory('example-ipo')).not.toBeNull()
  vi.setSystemTime(NOW + 60 * 60_000)
  expect(client.cachedIpoGmpHistory('example-ipo')).toBeNull()
  expect((await client.loadIpoGmpHistory('example-ipo')).gmp?.asOfDate).toBe('2026-10-22')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('restores a real daily series including zero and losses without adding the current quote', async () => {
  const points = [{ date: '2026-10-20', amount: -5 }, { date: '2026-10-21', amount: 0 }, { date: '2026-10-22', amount: 0 }]
  const value = reply({ points, sourceUrl: 'https://gmptoday.in/ipo/example/', sourceUpdatedAt: null })
  const fetcher = vi.fn().mockResolvedValue(Response.json(value))
  vi.stubGlobal('fetch', fetcher)
  let client = await import('./ipoGmpHistory')
  expect((await client.loadIpoGmpHistory('example-ipo')).points).toEqual(points)
  vi.resetModules()
  client = await import('./ipoGmpHistory')
  expect(client.cachedIpoGmpHistory('example-ipo')?.points).toEqual(points)
  expect(fetcher).toHaveBeenCalledOnce()
})

it('does not let the retired quote-only cache block the new trend request', async () => {
  sessionStorage.setItem('finverse:ipo-gmp-history:v1', JSON.stringify([reply()]))
  sessionStorage.setItem('finverse:ipo-gmp-history:v2', JSON.stringify([reply({ gmp: null, points: [] })]))
  sessionStorage.setItem('finverse:ipo-gmp-history:v3', JSON.stringify([reply({ gmp: null, points: [] })]))
  const fetcher = vi.fn().mockResolvedValue(Response.json(reply({ points: [] })))
  vi.stubGlobal('fetch', fetcher)
  const client = await import('./ipoGmpHistory')
  expect(client.cachedIpoGmpHistory('example-ipo')).toBeNull()
  await client.loadIpoGmpHistory('example-ipo')
  expect(fetcher).toHaveBeenCalledOnce()
})
