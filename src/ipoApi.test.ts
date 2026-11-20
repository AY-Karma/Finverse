import { describe, expect, it, vi } from 'vitest'
import { createIpoHandler, parseIpoDirectory } from '../api/ipos'
import { isIpoFeed, isIpoSourceUrl, type IpoFeed } from './ipoProtocol'

const NOW = Date.parse('2026-11-07T14:00:00Z')
const sourceRow = (overrides = {}) => ({ slug: 'antala-industries-ipo', name: 'Antala Industries Limited', board: 'SME', status: 'CLOSED',
  openDate: '2026-10-29T00:00:00Z', closeDate: '2026-11-05T00:00:00Z', listingDate: '2026-11-11T00:00:00Z',
  priceMin: 62, priceMax: 66, lotSize: 2000, lastGmp: null, ...overrides })
const directory = (rows = [sourceRow()]) => ({ ok: true, ipos: rows })
const request = () => new Request('http://localhost/api/ipos')

describe('IPO directory and reported GMP', () => {
  it('keeps genuine zero separate from missing and rejects disputed fallback quotes', () => {
    const rows = parseIpoDirectory(directory([
      sourceRow({ slug: 'zero', name: 'Zero issuer', lastGmp: 0 }), sourceRow({ slug: 'missing', name: 'Missing issuer', lastGmp: '' }),
      sourceRow({ slug: 'disputed', name: 'Disputed issuer', lastGmp: 30, gmpDisputed: true }),
    ]), NOW)
    expect(rows.map((row) => row.gmp?.amount ?? null)).toEqual([0, null, null])
    expect(rows[0].gmp?.observedAt).toBeNull()
  })

  it('uses explicit listing and bidding dates rather than stale lifecycle labels', () => {
    const issues = parseIpoDirectory(directory([
      sourceRow({ slug: 'listed', name: 'Listed issuer', listingDate: '2026-11-06', status: 'OPEN' }),
      sourceRow({ slug: 'next', name: 'Next issuer', openDate: '2026-11-09', closeDate: '2026-11-11', listingDate: null, status: 'CLOSED' }),
      sourceRow({ slug: 'closed', name: 'Closed issuer', listingDate: null, status: 'OPEN' }),
    ]), NOW)
    expect(issues.map((issue) => issue.status)).toEqual(['LISTED', 'UPCOMING', 'CLOSED'])
  })

  it('fails closed when the directory format changes', () => {
    expect(() => parseIpoDirectory({ ok: true, ipos: [{ name: 'Unrecognized format' }] }, NOW)).toThrow()
    expect(() => parseIpoDirectory({ ok: false, ipos: [] }, NOW)).toThrow()
  })

  it('collapses identical records and omits only conflicting duplicate identities', () => {
    const warnings: string[] = []
    const issues = parseIpoDirectory(directory([
      sourceRow(), sourceRow(),
      sourceRow({ slug: 'conflict', closeDate: '2026-11-03' }),
      sourceRow({ slug: 'conflict', closeDate: '2026-11-04' }),
      sourceRow({ slug: 'healthy', name: 'Another Issuer' }),
    ]), NOW, warnings)
    expect(issues.map((issue) => issue.id)).toEqual(['xflot:antala-industries-ipo', 'xflot:healthy'])
    expect(warnings).toEqual(['Omitted 1 issue with conflicting source records.'])
  })

  it('consolidates legal-name duplicates for the same priced offer and keeps its listed record', () => {
    const issues = parseIpoDirectory(directory([
      sourceRow({ slug: 'tonbo-old', name: 'Tonbo Imaging India Limited', board: 'MAINBOARD', openDate: '2026-10-15', closeDate: '2026-10-19', listingDate: null, priceMin: 665, priceMax: 700, lotSize: null }),
      sourceRow({ slug: 'tonbo-listed', name: 'Tonbo Imaging India', board: 'MAINBOARD', openDate: '2026-10-15', closeDate: '2026-10-19', listingDate: '2026-10-23', priceMin: 665, priceMax: 700, lotSize: 21 }),
      sourceRow({ slug: 'different-offer', name: 'Tonbo Imaging India', board: 'MAINBOARD', openDate: '2025-10-15', closeDate: '2025-10-19', listingDate: '2025-10-23', priceMin: 665, priceMax: 700 }),
    ]), NOW)
    expect(issues).toHaveLength(2)
    expect(issues.find((issue) => issue.closeDate === '2026-10-19')).toMatchObject({
      id: 'xflot:tonbo-listed', status: 'LISTED', listingDate: '2026-10-23', lotSize: 21,
    })
  })

  it('does not combine same-name offers with conflicting prices or listing facts', () => {
    const warnings: string[] = []
    const issues = parseIpoDirectory(directory([
      sourceRow({ slug: 'same-name-a', name: 'Example Limited', priceMax: 100 }),
      sourceRow({ slug: 'same-name-b', name: 'Example', priceMax: 101 }),
      sourceRow({ slug: 'different', name: 'Healthy issuer' }),
    ]), NOW, warnings)
    expect(issues.map((issue) => issue.name)).toEqual(['Healthy issuer'])
    expect(warnings).toContain('Omitted 1 offer with conflicting issue details.')
  })

  it('validates dates, response bounds and safe provider URLs', () => {
    expect(isIpoSourceUrl('https://gmptoday.in/ipo/antala/')).toBe(true)
    expect(isIpoSourceUrl('https://gmptoday.in.evil.test/')).toBe(false)
    expect(isIpoSourceUrl('javascript:alert(1)')).toBe(false)
    const payload: IpoFeed = { issues: parseIpoDirectory(directory(), NOW), fetchedAt: NOW, sources: [], warnings: [], stale: false }
    expect(isIpoFeed(payload)).toBe(true)
    expect(isIpoFeed({ ...payload, issues: [{ ...payload.issues[0], listingDate: '2026-02-31' }] })).toBe(false)
    expect(isIpoFeed({ ...payload, issues: [payload.issues[0], payload.issues[0]] })).toBe(false)
    expect(isIpoFeed({ ...payload, disclaimer: 'Provider disclaimer.' })).toBe(true)
    expect(isIpoFeed({ ...payload, disclaimer: 'x'.repeat(2001) })).toBe(false)
  })
})

describe('GET /api/ipos', () => {
  it('deduplicates concurrent requests and caches a shared public snapshot', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(directory()))
    const handler = createIpoHandler({ fetcher, now: () => NOW })
    const responses = await Promise.all([handler(request()), handler(request()), handler(request())])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(responses[0].headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=3600, must-revalidate')
    const body = await responses[0].json()
    expect(isIpoFeed(body)).toBe(true)
    expect(body.issues).toHaveLength(1)
    expect((await handler(request())).ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('retains a successful snapshot through later source failures without freshening it', async () => {
    let at = NOW, failed = false
    const fetcher = vi.fn<typeof fetch>(async () => failed ? new Response('', { status: 503 })
      : Response.json({ ...directory(), disclaimer: 'Aggregated public information. GMP is unofficial.' }))
    const handler = createIpoHandler({ fetcher, now: () => at })
    await handler(request())
    failed = true
    at += 3_600_001
    const response = await handler(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=60, must-revalidate')
    expect(body.issues).toHaveLength(1)
    expect(body.fetchedAt).toBe(NOW)
    expect(body.stale).toBe(true)
    expect(body.warnings).toEqual(['IPO details could not be refreshed. Showing the last available data when possible.'])
    expect(body.disclaimer).toBe('Aggregated public information. GMP is unofficial.')
  })

  it('serves healthy issues and a warning when upstream duplicates conflict', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      ...directory([sourceRow(), sourceRow({ slug: 'duplicate', priceMax: 90 }), sourceRow({ slug: 'duplicate', priceMax: 91 })]),
      disclaimer: 'Source disclaimer retained.',
    }))
    const response = await createIpoHandler({ fetcher, now: () => NOW })(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(isIpoFeed(body)).toBe(true)
    expect(body.issues).toHaveLength(1)
    expect(body.warnings).toContain('Omitted 1 issue with conflicting source records.')
    expect(body.disclaimer).toBe('Source disclaimer retained.')
  })

  it('takes GMP and its source count from Xflot alone, without contacting GMP Today', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(directory([sourceRow({ lastGmp: 12, lastGmpPct: 18.2, gmpSources: 3 })])))
    const body = await (await createIpoHandler({ fetcher, now: () => NOW })(request())).json()
    expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).hostname)).toEqual(['www.xflot.com'])
    expect(body.issues[0].gmp).toMatchObject({ amount: 12, percent: 18.2, source: 'Xflot', sources: 3 })
    expect(body.sources.map((source: { name: string }) => source.name)).toEqual(['Xflot'])
    expect(body).toMatchObject({ warnings: [], stale: false })
  })

  it('does not replace an existing directory with an unexpected empty refresh', async () => {
    let at = NOW
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(directory(at === NOW ? [sourceRow()] : [])))
    const handler = createIpoHandler({ fetcher, now: () => at })
    await handler(request())
    at += 3_600_001
    const body = await (await handler(request())).json()
    expect(body.issues).toHaveLength(1)
    expect(body.fetchedAt).toBe(NOW)
    expect(body.stale).toBe(true)
  })

  it('rejects unsupported requests before any provider access and reports a cold core outage', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }))
    const handler = createIpoHandler({ fetcher, now: () => NOW })
    expect((await handler(new Request('http://localhost/api/ipos', { method: 'POST' }))).status).toBe(405)
    expect((await handler(new Request('http://localhost/api/ipos?holdings=TCS'))).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
    expect((await handler(request())).status).toBe(502)
  })
})
