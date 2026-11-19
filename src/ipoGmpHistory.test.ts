import { describe, expect, it, vi } from 'vitest'
import ipoApi, { createIpoGmpHistoryHandler, parseIpoGmpTrend } from '../api/ipos'
import { isIpoGmpHistoryResponse } from './ipoGmpHistoryProtocol'
import type { IpoIssue } from './ipoProtocol'

const NOW = Date.parse('2026-11-08T10:00:00Z')
const SLUG = 'bonfigliolitransmissions-ipo'
const SOURCE = `https://www.xflot.com/ipo/${SLUG}`
const report = (observedAt: string, gmp: number, source = 'investorgain') => ({ observedAt: `${observedAt}T00:00:00.000Z`, gmp, gmpPct: null, source, unofficial: true })
const coreRow = (overrides = {}) => ({ slug: SLUG, name: 'Bonfiglioli Transmissions', board: 'MAINBOARD', status: 'LISTED',
  openDate: '2026-10-15', closeDate: '2026-10-19', listingDate: '2026-10-23',
  priceMin: 558, priceMax: 586, lotSize: 25, lastGmp: null,
  gmp: [report('2026-10-23', 140), report('2026-10-22', 80), report('2026-10-22', 90, 'ipowatch'), report('2026-10-20', 60), report('2026-10-13', 30)], ...overrides })
const issue = (overrides: Partial<IpoIssue> = {}): IpoIssue => ({ id: `xflot:${SLUG}`, name: 'Bonfiglioli Transmissions', board: 'MAINBOARD', status: 'LISTED',
  openDate: '2026-10-15', closeDate: '2026-10-19', listingDate: '2026-10-23', allotmentDate: null, priceMin: 558, priceMax: 586, lotSize: 25,
  sourceUrl: SOURCE, gmp: null, ...overrides })
const request = (slug = SLUG) => new Request(`http://localhost/api/ipoGmpHistory?slug=${slug}`)
const fetcher = (row: Record<string, unknown> = coreRow()) => vi.fn<typeof fetch>(async () => Response.json({ ok: true, ipo: row }))

describe('dated historical GMP from Xflot', () => {
  it('returns one median per reported day before listing, sorted, without inventing missing days', () => {
    const trend = parseIpoGmpTrend(coreRow().gmp, issue(), SLUG, NOW)
    expect(trend?.points).toEqual([{ date: '2026-10-13', amount: 30 }, { date: '2026-10-20', amount: 60 }, { date: '2026-10-22', amount: 85 }])
    expect(trend?.sourceUrl).toBe(SOURCE)
    expect(trend?.sourceUpdatedAt).toBeNull()
  })

  it('gives a listed issue its final pre-listing GMP with the reporting sources and their range', () => {
    expect(parseIpoGmpTrend(coreRow().gmp, issue(), SLUG, NOW)?.gmp).toEqual({ amount: 85, percent: 85 / 586 * 100, source: 'Xflot', sourceUrl: SOURCE,
      asOfDate: '2026-10-22', observedAt: null, sourceUpdatedAt: null, sources: 2, rangeLow: 80, rangeHigh: 90 })
    expect(parseIpoGmpTrend(coreRow().gmp, issue({ status: 'CLOSED', listingDate: null }), SLUG, NOW)?.gmp).toBeNull()
  })

  it('excludes future days and unusable reports, and keeps genuine zero and negative premiums', () => {
    const trend = parseIpoGmpTrend([report('2026-11-09', 50), report('2026-11-07', 0), report('2026-11-06', -5), { observedAt: 'soon', gmp: 9 }, { observedAt: '2026-11-05T00:00:00Z', gmp: '7' }],
      issue({ status: 'CLOSED', openDate: '2026-11-03', closeDate: '2026-11-05', listingDate: null }), SLUG, NOW)
    expect(trend?.points).toEqual([{ date: '2026-11-06', amount: -5 }, { date: '2026-11-07', amount: 0 }])
  })

  it('returns nothing without usable offer facts or reports, and rejects an oversized history', () => {
    expect(parseIpoGmpTrend(coreRow().gmp, issue({ openDate: null }), SLUG, NOW)).toBeNull()
    expect(parseIpoGmpTrend(coreRow().gmp, issue({ priceMax: null }), SLUG, NOW)).toBeNull()
    expect(parseIpoGmpTrend([report('2026-10-23', 1)], issue(), SLUG, NOW)).toBeNull()
    expect(() => parseIpoGmpTrend(Array.from({ length: 3661 }, () => report('2026-10-20', 1)), issue(), SLUG, NOW)).toThrow()
  })
})

describe('GET /api/ipoGmpHistory', () => {
  it('serves a validated trend from one Xflot request, deduplicated and edge-cached', async () => {
    const source = fetcher()
    const handler = createIpoGmpHistoryHandler({ fetcher: source, now: () => NOW })
    const [first, second] = await Promise.all([handler(request()), handler(request())])
    expect(source).toHaveBeenCalledTimes(1)
    expect(String(source.mock.calls[0][0])).toBe(`https://www.xflot.com/api/public/market/ipos/${SLUG}`)
    expect(first.headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=1800, must-revalidate')
    const body = await first.json()
    expect(isIpoGmpHistoryResponse(body)).toBe(true)
    expect(body.points).toHaveLength(3)
    expect(body.gmp).toMatchObject({ amount: 85, source: 'Xflot' })
    expect((await second.json()).points).toHaveLength(3)
  })

  it('returns a trend without overwriting a quote the directory already has', async () => {
    const body = await (await createIpoGmpHistoryHandler({ fetcher: fetcher(coreRow({ lastGmp: 70 })), now: () => NOW })(request())).json()
    expect(body.points).toHaveLength(3)
    expect(body.gmp).toBeNull()
  })

  it('answers missing history plainly and fails closed on a changed identity', async () => {
    const empty = await (await createIpoGmpHistoryHandler({ fetcher: fetcher(coreRow({ gmp: [] })), now: () => NOW })(request())).json()
    expect(empty).toEqual({ slug: SLUG, gmp: null, points: [], checkedAt: NOW })
    expect((await createIpoGmpHistoryHandler({ fetcher: fetcher(coreRow({ slug: 'another-ipo' })), now: () => NOW })(request())).status).toBe(502)
  })

  it('answers with no history, not an error, when the issue row cannot be used', async () => {
    const body = await (await createIpoGmpHistoryHandler({ fetcher: fetcher(coreRow({ board: 'UNKNOWN' })), now: () => NOW })(request())).json()
    expect(body).toEqual({ slug: SLUG, gmp: null, points: [], checkedAt: NOW })
  })

  it('rejects unsupported requests before any provider access', async () => {
    const source = fetcher()
    const handler = createIpoGmpHistoryHandler({ fetcher: source, now: () => NOW })
    expect((await handler(new Request('http://localhost/api/ipoGmpHistory', { method: 'POST' }))).status).toBe(405)
    expect((await handler(new Request('http://localhost/api/ipoGmpHistory?slug=a&slug=b'))).status).toBe(400)
    expect((await handler(request('Bad Slug'))).status).toBe(400)
    expect(source).not.toHaveBeenCalled()
  })
})

describe('single IPO function', () => {
  it('routes the list and one issue trend through the same entry point, before any provider access', async () => {
    const error = async (url: string) => (await (await ipoApi.fetch(new Request(url))).json()).error
    expect(await error('http://localhost/api/ipos?holdings=TCS')).toBe('IPO discovery does not accept portfolio data or query parameters.')
    expect(await error('http://localhost/api/ipos?slug=Bad%20Slug')).toBe('Choose one valid IPO issue.')
    expect(await error(`http://localhost/api/ipos?slug=${SLUG}&holdings=TCS`)).toBe('Choose one valid IPO issue.')
  })
})

describe('historical response boundary', () => {
  const valid = { slug: SLUG, gmp: null, checkedAt: NOW, points: [{ date: '2026-10-20', amount: 60 }, { date: '2026-10-22', amount: 85 }], sourceUrl: SOURCE, sourceUpdatedAt: null }

  it('accepts sorted Xflot series and rejects foreign sources, unsorted or future days', () => {
    expect(isIpoGmpHistoryResponse(valid)).toBe(true)
    expect(isIpoGmpHistoryResponse({ ...valid, sourceUrl: 'https://gmptoday.in/ipo/bonfiglioli-transmissions/' })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...valid, points: [...valid.points].reverse() })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...valid, points: [{ date: '2026-11-09', amount: 1 }] })).toBe(false)
  })

  it('accepts only a dated Xflot quote without a fabricated clock time', () => {
    const gmp = { amount: 85, percent: 14.5, source: 'Xflot', sourceUrl: SOURCE, asOfDate: '2026-10-22', observedAt: null, sourceUpdatedAt: null, sources: 2, rangeLow: 80, rangeHigh: 90 }
    expect(isIpoGmpHistoryResponse({ ...valid, gmp })).toBe(true)
    expect(isIpoGmpHistoryResponse({ ...valid, gmp: { ...gmp, source: 'GMP Today' } })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...valid, gmp: { ...gmp, observedAt: NOW } })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...valid, gmp: { ...gmp, asOfDate: undefined } })).toBe(false)
  })
})
