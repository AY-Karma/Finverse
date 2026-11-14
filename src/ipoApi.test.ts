import { describe, expect, it, vi } from 'vitest'
import { createIpoHandler, enrichIpoGmp, parseGmpBoard, parseIpoDirectory } from '../api/ipos'
import { isIpoFeed, isIpoSourceUrl, type IpoFeed } from './ipoProtocol'

const NOW = Date.parse('2026-11-07T14:00:00Z')
const sourceRow = (overrides = {}) => ({ slug: 'antala-industries-ipo', name: 'Antala Industries Limited', board: 'SME', status: 'CLOSED',
  openDate: '2026-10-29T00:00:00Z', closeDate: '2026-11-05T00:00:00Z', listingDate: '2026-11-11T00:00:00Z',
  priceMin: 62, priceMax: 66, lotSize: 2000, lastGmp: null, ...overrides })
const directory = (rows = [sourceRow()]) => ({ ok: true, ipos: rows })
const gmpHtml = (amount = '0', extra = '') => `<meta name="gmp-built" content="2026-11-07T17:46:00+05:30">
  <a class="row" href="/ipo/antala-industries/" data-group="sme" data-slug="antala-industries" data-med="${amount}" data-name="Antala Industries" data-est="0">
  <span class="c-range num">₹0–5.36</span><span class="c-conf">medium<small>6 sources</small></span></a>${extra}`
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

  it('parses the public board with source-build time distinct from quote time', () => {
    const board = parseGmpBoard(gmpHtml(), NOW)
    expect(board.rows[0].gmp).toMatchObject({ amount: 0, percent: 0, sources: 6, rangeLow: 0, rangeHigh: 5.36,
      sourceUpdatedAt: Date.parse('2026-11-07T17:46:00+05:30'), observedAt: null })
    expect(board.rows[0].gmp.sourceUrl).toBe('https://gmptoday.in/ipo/antala-industries/')
  })

  it('fails closed on missing update times, changed structure and invalid numbers', () => {
    expect(() => parseGmpBoard(gmpHtml().replace('name="gmp-built"', 'name="new"'), NOW)).toThrow()
    expect(() => parseGmpBoard(gmpHtml('--'), NOW)).toThrow()
    expect(() => parseGmpBoard(gmpHtml().replace('data-group="sme"', 'data-group="unknown"'), NOW)).toThrow()
    expect(() => parseIpoDirectory({ ok: true, ipos: [{ name: 'Unrecognized format' }] }, NOW)).toThrow()
  })

  it('joins legal-name equivalents with the same board, but refuses ambiguous issues', () => {
    const board = parseGmpBoard(gmpHtml(), NOW)
    const issues = parseIpoDirectory(directory(), NOW)
    expect(enrichIpoGmp(issues, board, NOW)[0].gmp?.amount).toBe(0)
    expect(enrichIpoGmp([{ ...issues[0], board: 'MAINBOARD' }], board, NOW)[0].gmp).toBeNull()
    expect(enrichIpoGmp([issues[0], { ...issues[0], id: 'other-offer' }], board, NOW).every((issue) => issue.gmp === null)).toBe(true)
    const duplicate = { ...board, rows: [...board.rows, { ...board.rows[0], slug: 'another' }] }
    expect(enrichIpoGmp(issues, duplicate, NOW)[0].gmp).toBeNull()
  })

  it('does not attach a current board quote to an older issue with the same name', () => {
    const issues = parseIpoDirectory(directory([sourceRow({ closeDate: '2026-01-01' })]), NOW)
    expect(enrichIpoGmp(issues, parseGmpBoard(gmpHtml(), NOW), NOW)[0].gmp).toBeNull()
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
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('xflot.com') ? Response.json(directory()) : new Response(gmpHtml()))
    const handler = createIpoHandler({ fetcher, now: () => NOW })
    const responses = await Promise.all([handler(request()), handler(request()), handler(request())])
    expect(fetcher).toHaveBeenCalledTimes(2)
    const body = await responses[0].json()
    expect(isIpoFeed(body)).toBe(true)
    expect(body.issues[0].gmp.amount).toBe(0)
    expect((await handler(request())).ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('retains a successful snapshot through later source failures without freshening it', async () => {
    let at = NOW, failed = false
    const fetcher = vi.fn<typeof fetch>(async (input) => failed ? new Response('', { status: 503 })
      : String(input).includes('xflot.com') ? Response.json({ ...directory(), disclaimer: 'Aggregated public information. GMP is unofficial.' }) : new Response(gmpHtml()))
    const handler = createIpoHandler({ fetcher, now: () => at })
    await handler(request())
    failed = true
    at += 3_600_001
    const response = await handler(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.issues).toHaveLength(1)
    expect(body.fetchedAt).toBe(NOW)
    expect(body.stale).toBe(true)
    expect(body.warnings).toHaveLength(2)
    expect(body.disclaimer).toBe('Aggregated public information. GMP is unofficial.')
  })

  it('serves healthy issues and a warning when upstream duplicates conflict', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('xflot.com') ? Response.json({
      ...directory([sourceRow(), sourceRow({ slug: 'duplicate', priceMax: 90 }), sourceRow({ slug: 'duplicate', priceMax: 91 })]),
      disclaimer: 'Source disclaimer retained.',
    }) : new Response(gmpHtml()))
    const response = await createIpoHandler({ fetcher, now: () => NOW })(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(isIpoFeed(body)).toBe(true)
    expect(body.issues).toHaveLength(1)
    expect(body.warnings).toContain('Omitted 1 issue with conflicting source records.')
    expect(body.disclaimer).toBe('Source disclaimer retained.')
  })

  it('keeps core details when GMP is unavailable and only retries the failed source', async () => {
    let at = NOW
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('xflot.com') ? Response.json(directory()) : new Response('', { status: 503 }))
    const handler = createIpoHandler({ fetcher, now: () => at })
    const body = await (await handler(request())).json()
    expect(body.issues).toHaveLength(1)
    expect(body.issues[0].gmp).toBeNull()
    expect(body.stale).toBe(true)
    at += 60_001
    const next = await (await handler(request())).json()
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(next.fetchedAt).toBe(NOW)
  })

  it('does not replace an existing directory with an unexpected empty refresh', async () => {
    let at = NOW
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('xflot.com') ? Response.json(directory(at === NOW ? [sourceRow()] : [])) : new Response(gmpHtml()))
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
