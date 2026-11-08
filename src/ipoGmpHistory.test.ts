import { describe, expect, it, vi } from 'vitest'
import { createIpoGmpHistoryHandler, parseArchivedIpoGmp, parseIpoGmpTrend } from '../api/ipoGmpHistory'
import { isIpoGmpHistoryResponse } from './ipoGmpHistoryProtocol'
import type { IpoIssue } from './ipoProtocol'

const NOW = Date.parse('2026-11-08T10:00:00Z')
const SLUG = 'bonfigliolitransmissions-ipo'
const PAGE = 'bonfiglioli-transmissions'
const coreRow = (overrides = {}) => ({ slug: SLUG, name: 'Bonfiglioli Transmissions', board: 'MAINBOARD', status: 'LISTED',
  openDate: '2026-10-15', closeDate: '2026-10-19', listingDate: '2026-10-23',
  priceMin: 558, priceMax: 586, lotSize: 25, lastGmp: null, ...overrides })
const issue = (overrides: Partial<IpoIssue> = {}): IpoIssue => ({ id: `xflot:${SLUG}`, ...coreRow(), allotmentDate: null,
  sourceUrl: `https://www.xflot.com/ipo/${SLUG}`, gmp: null, ...overrides } as IpoIssue)
const point = (overrides = {}) => ({ d: '2026-10-22', m: 80, lo: 65, hi: 137, n: 9, bf: false, ...overrides })
const html = (points = [point()], options: { name?: string; price?: number; date?: string; board?: string; slug?: string; singleQuotes?: boolean } = {}) => {
  const body = `<meta name="gmp-built" content="2026-11-08T08:15:33+05:30"><link rel="canonical" href="https://gmptoday.in/ipo/${options.slug ?? PAGE}/">
    <h1>${options.name ?? 'Bonfiglioli Transmissions'} IPO — GMP vs Actual Listing</h1>
    <div class="fact"><span class="fact-l">Issue price</span><span class="fact-v">₹${options.price ?? 586}</span></div>
    <div class="fact"><span class="fact-l">Final GMP</span><span class="fact-v">₹126.99</span></div>
    <div class="fact"><span class="fact-l">Listed on</span><span class="fact-v">${options.date ?? '23 Oct 2026'}</span></div>
    <div class="fact"><span class="fact-l">Segment</span><span class="fact-v"><a href="/mainboard/">${options.board ?? 'Mainboard'}</a></span></div>
    <div class="chart-wrap" data-points="${JSON.stringify(points).replace(/"/g, '&#34;')}"></div>`
  return options.singleQuotes ? body.replace(/="([^"]*)"/g, "='$1'") : body
}
const activeIssue = (): IpoIssue => issue({ id: 'xflot:vedantpolyfabs-ipo', name: 'Vedant Poly Fabs Limited', board: 'SME', status: 'CLOSED', openDate: '2026-11-02', closeDate: '2026-11-04', listingDate: null, priceMin: 88, priceMax: 94 })
const activeHtml = (points = [point({ d: '2026-11-08', m: 1, lo: 0, hi: 15, n: 10 })], missing: string[] = []) => html(points, { name: 'Vedant Poly Fabs', price: 94, board: 'SME', slug: 'vedant-poly-fabs', date: '2–4 Nov' })
  .replace('Issue price', 'Price band (upper)').replace('Listed on', 'Bidding dates')
  + `<table>${points.map((entry) => `<tr><td data-l="Date">${entry.d}</td><td data-l="GMP (median)">${missing.includes(entry.d) ? '—' : `₹${entry.m}`}</td></tr>`).join('')}</table>`
const sitemap = (...slugs: string[]) => `<urlset>${slugs.map((slug) => `<url><loc>https://gmptoday.in/ipo/${slug}/</loc></url>`).join('')}</urlset>`
const request = (slug = SLUG) => new Request(`http://localhost/api/ipoGmpHistory?slug=${slug}`)
const fetcher = (row = coreRow(), page = html()) => vi.fn<typeof fetch>(async (input) => {
  const url = String(input)
  return url.includes('xflot.com') ? Response.json({ ok: true, ipo: row })
    : url.endsWith('/sitemap.xml') ? new Response(sitemap(PAGE)) : new Response(page)
})

describe('dated historical GMP parsing', () => {
  it.each([
    { dates: '28 Oct – 2 Nov', listing: '05 Nov 2026', knownListing: null },
    { dates: '29 Oct – 2 Nov', listing: '01 Nov 2026', knownListing: null },
    { dates: '29 Oct – 2 Nov', listing: '05 Nov 2025', knownListing: null },
    { dates: '29 Oct – 2 Nov', listing: '05 Nov 2026', knownListing: '2026-11-06' },
  ])('rejects an uncorroborated lagged-directory archive %j', ({ dates, listing, knownListing }) => {
    const matched = issue({ id: 'xflot:bombaycoatedandspecialsteels-ipo', name: 'Bombay Coated and Special Steels', status: 'CLOSED',
      openDate: '2026-10-29', closeDate: '2026-11-02', listingDate: knownListing, priceMin: 78, priceMax: 82 })
    const page = html([point({ d: '2026-11-04', m: 8, lo: 7, hi: 9 })], { name: matched.name, slug: 'bombay-coated-special-steels', price: 82, date: listing })
      + `<div class="fact"><span class="fact-l">Issue dates</span><span class="fact-v">${dates}</span></div>`
    expect(parseIpoGmpTrend(page, matched, 'bombay-coated-special-steels', NOW)).toBeNull()
  })

  it('returns the full sorted genuine series including pre-bidding observations without changing the last-quote contract', () => {
    const page = html([point(), point({ d: '2026-10-11', m: 150, lo: 137, hi: 163 }), point({ d: '2026-10-21', m: 132, lo: 130 })])
    const trend = parseIpoGmpTrend(page, issue(), PAGE, NOW)!
    expect(trend.points).toEqual([{ date: '2026-10-11', amount: 150 }, { date: '2026-10-21', amount: 132 }, { date: '2026-10-22', amount: 80 }])
    expect(trend.gmp?.amount).toBe(80)
    expect(trend.sourceUrl).toBe(`https://gmptoday.in/ipo/${PAGE}/`)
  })

  it('reads active daily medians while excluding chart placeholders, synthetic backfills and future observations', () => {
    const points = [
      point({ d: '2026-10-30', m: 0, lo: 0, hi: 0 }),
      point({ d: '2026-10-31', m: 0, lo: 0, hi: 0 }),
      point({ d: '2026-11-02', m: 15, lo: 15, hi: 15 }),
      point({ d: '2026-11-07', m: 5, lo: 5, hi: 5, bf: true }),
      point({ d: '2026-11-08', m: 1, lo: 0, hi: 15 }),
      point({ d: '2026-11-09', m: 1, lo: 0, hi: 15 }),
    ]
    const trend = parseIpoGmpTrend(activeHtml(points, ['2026-10-30']), activeIssue(), 'vedant-poly-fabs', NOW)!
    expect(trend.points).toEqual([{ date: '2026-10-31', amount: 0 }, { date: '2026-11-02', amount: 15 }, { date: '2026-11-08', amount: 1 }])
    expect(trend.gmp).toBeNull()
  })

  it.each([
    ['issuer', 'Vedant Poly Fabs IPO', 'Another Company IPO'],
    ['offer price', '₹94', '₹95'],
    ['board', '>SME<', '>Mainboard<'],
    ['bidding dates', '2–4 Nov', '3–5 Nov'],
    ['daily published value', '>₹1<', '>₹2<'],
  ])('fails closed when active %s does not match', (_reason, before, after) => {
    expect(parseIpoGmpTrend(activeHtml().replace(before, after), activeIssue(), 'vedant-poly-fabs', NOW)).toBeNull()
  })

  it('uses the latest genuine daily observation before listing rather than the accuracy-score number', () => {
    const gmp = parseArchivedIpoGmp(html([
      point({ d: '2026-10-14', m: 180, lo: 175, hi: 182 }),
      point({ d: '2026-10-21', m: 132, lo: 130 }), point(),
      point({ d: '2026-10-23', m: 66, lo: 65, hi: 100 }),
      point({ d: '2026-10-24', m: 66, lo: 66, hi: 66 }),
    ]), issue(), PAGE, NOW)!
    expect(gmp).toMatchObject({ amount: 80, asOfDate: '2026-10-22', observedAt: null,
      source: 'GMP Today', sourceUrl: `https://gmptoday.in/ipo/${PAGE}/`, sources: 9, rangeLow: 65, rangeHigh: 137 })
    expect(gmp.percent).toBeCloseTo(80 / 586 * 100)
    expect(gmp.sourceUpdatedAt).toBe(Date.parse('2026-11-08T08:15:33+05:30'))
    expect(gmp.amount).not.toBe(126.99)
  })

  it.each([
    ['Sahajanand Medical Technologies', 'sahajanand-medical', 344, 17],
    ['Tonbo Imaging India', 'tonbo-imaging', 700, 441],
  ])('accepts the recorded %s archive only against its matching offer facts', (name, slug, price, amount) => {
    const page = html([point({ m: amount, lo: amount - 2, hi: amount + 3 })], { name, slug, price, singleQuotes: true })
    const gmp = parseArchivedIpoGmp(page, issue({ name: `${name} Limited`, priceMax: price }), slug, NOW)!
    expect(gmp.amount).toBe(amount)
    expect(gmp.asOfDate).toBe('2026-10-22')
  })

  it.each([0, -5])('preserves a genuine %s premium', (amount) => {
    expect(parseArchivedIpoGmp(html([point({ m: amount, lo: amount, hi: amount })]), issue(), PAGE, NOW)?.amount).toBe(amount)
  })

  it('excludes backfills, future days, missing observations and invalid date/range data', () => {
    const points = [point({ bf: true }), point({ d: '2026-11-09' }), point({ d: '2026-02-31' }),
      point({ m: null }), point({ lo: 90 }), point({ n: 0 })]
    expect(parseArchivedIpoGmp(html(points), issue(), PAGE, NOW)).toBeNull()
    expect(parseArchivedIpoGmp(html([]), issue(), PAGE, NOW)).toBeNull()
    expect(parseArchivedIpoGmp(html([point(), point({ m: 90 })]), issue(), PAGE, NOW)).toBeNull()
  })

  it.each([{ name: 'Another Issuer' }, { price: 585 }, { date: '24 Oct 2026' }, { board: 'SME' }, { slug: 'another-issuer' }])('fails closed on different issuer or offer facts %j', (options) => {
    expect(parseArchivedIpoGmp(html([point()], options), issue(), PAGE, NOW)).toBeNull()
  })

  it('rejects changed chart structure and never invents a page or quote timestamp', () => {
    expect(() => parseArchivedIpoGmp(html().replace('data-points=', 'unknown='), issue(), PAGE, NOW)).toThrow()
    const noUpdate = html().replace('name="gmp-built"', 'name="unknown"')
    expect(parseArchivedIpoGmp(noUpdate, issue(), PAGE, NOW)).toMatchObject({ observedAt: null, sourceUpdatedAt: null })
  })
})

describe('GET /api/ipoGmpHistory', () => {
  it.each([
    { slug: 'zetwerkmanufacturingbusinesses-ipo', name: 'Zetwerk Manufacturing Businesses', heading: 'Zetwerk', pageSlug: 'zetwerk-manufacturing', board: 'MAINBOARD', price: 151, open: '2026-10-15', close: '2026-10-19', listing: '2026-10-23', listedLabel: '23 Oct 2026', day: '2026-10-22', amount: 3.5, extra: [] },
    { slug: 'rkfashionaccessories-ipo', name: 'R.K.Fashion Accessories Limited', heading: 'R.K.Fashion Accessories', pageSlug: 'r-k-fashion-accessories', board: 'SME', price: 82, open: '2026-10-05', close: '2026-10-07', listing: '2026-10-12', listedLabel: '12 Oct 2026', day: '2026-10-11', amount: 1.5, extra: ['rk-fashion-accessories'] },
  ])('uses the verified $heading archive when the directory slug or an allotment page obscures it', async (example) => {
    const row = coreRow({ slug: example.slug, name: example.name, board: example.board, status: 'LISTED', openDate: example.open,
      closeDate: example.close, listingDate: example.listing, priceMin: example.price, priceMax: example.price })
    const page = html([point({ d: example.day, m: example.amount, lo: 1, hi: 5 })],
      { name: example.heading, slug: example.pageSlug, price: example.price, board: example.board === 'SME' ? 'SME' : 'Mainboard', date: example.listedLabel })
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => String(input).includes('xflot.com') ? Response.json({ ok: true, ipo: row })
      : String(input).endsWith('/sitemap.xml') ? new Response(sitemap(...example.extra, example.pageSlug)) : new Response(page))
    const body = await (await createIpoGmpHistoryHandler({ fetcher: fetch, now: () => NOW })(request(example.slug))).json()
    expect(body).toMatchObject({ points: [{ date: example.day, amount: example.amount }], sourceUrl: `https://gmptoday.in/ipo/${example.pageSlug}/` })
    expect(fetch).toHaveBeenCalledWith(`https://gmptoday.in/ipo/${example.pageSlug}/`, expect.anything())
  })

  it('uses the matching dated archive when the directory status lags listing, excluding post-listing readings', async () => {
    const slug = 'bombaycoatedandspecialsteels-ipo', pageSlug = 'bombay-coated-special-steels'
    const row = coreRow({ slug, name: 'Bombay Coated and Special Steels', board: 'MAINBOARD', status: 'CLOSED',
      openDate: '2026-10-29', closeDate: '2026-11-02', listingDate: null, priceMin: 78, priceMax: 82, lastGmp: 7.5 })
    const page = html([point({ d: '2026-11-04', m: 8, lo: 7, hi: 9 }), point({ d: '2026-11-05', m: 10, lo: 7, hi: 12 })],
      { name: row.name, slug: pageSlug, price: 82, date: '05 Nov 2026' })
      + '<div class="fact"><span class="fact-l">Issue dates</span><span class="fact-v">29 Oct – 2 Nov</span></div>'
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => String(input).includes('xflot.com') ? Response.json({ ok: true, ipo: row })
      : String(input).endsWith('/sitemap.xml') ? new Response(sitemap('bombay-coated', pageSlug)) : new Response(page))
    const body = await (await createIpoGmpHistoryHandler({ fetcher: fetch, now: () => NOW })(request(slug))).json()
    expect(body).toMatchObject({ points: [{ date: '2026-11-04', amount: 8 }], sourceUrl: `https://gmptoday.in/ipo/${pageSlug}/`, gmp: null })
    expect(fetch).toHaveBeenCalledWith(`https://gmptoday.in/ipo/${pageSlug}/`, expect.anything())
  })

  it.each([
    { slug: 'maxwellengineeringsolutions-ipo', name: 'Maxwell Engineering Solutions Limited', heading: 'Maxwell Engineering', pageSlug: 'maxwell-engineering-solutions', board: 'SME', price: 158, open: '2026-10-30', close: '2026-11-03', dates: '30 Oct–3 Nov' },
    { slug: 'bombaycoatedandspecialsteels-ipo', name: 'Bombay Coated and Special Steels', heading: 'Bombay Coated', pageSlug: 'bombay-coated', board: 'MAINBOARD', price: 82, open: '2026-10-29', close: '2026-11-02', dates: '29 Oct–2 Nov' },
  ])('resolves the verified abbreviated $heading source without losing its genuine series', async (example) => {
    const row = coreRow({ slug: example.slug, name: example.name, board: example.board, status: 'CLOSED', listingDate: null,
      openDate: example.open, closeDate: example.close, priceMin: example.price, priceMax: example.price, lastGmp: 1 })
    const page = activeHtml().replace(/Vedant Poly Fabs/g, example.heading).replace(/vedant-poly-fabs/g, example.pageSlug)
      .replace('₹94', `₹${example.price}`).replace('2–4 Nov', example.dates).replace('>SME<', `>${example.board === 'SME' ? 'SME' : 'Mainboard'}<`)
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => String(input).includes('xflot.com') ? Response.json({ ok: true, ipo: row })
      : String(input).endsWith('/sitemap.xml') ? new Response(sitemap(example.pageSlug)) : new Response(page))
    const body = await (await createIpoGmpHistoryHandler({ fetcher: fetch, now: () => NOW })(request(example.slug))).json()
    expect(body).toMatchObject({ points: [{ date: '2026-11-08', amount: 1 }], sourceUrl: `https://gmptoday.in/ipo/${example.pageSlug}/` })
  })

  it('validates one slug before any source access', async () => {
    const fetch = fetcher(), handle = createIpoGmpHistoryHandler({ fetcher: fetch, now: () => NOW })
    expect((await handle(new Request('http://localhost/api/ipoGmpHistory', { method: 'POST' }))).status).toBe(405)
    for (const query of ['', '?slug=../bad', '?slug=a&slug=b', '?slug=a&holding=TCS', '?other=a']) {
      expect((await handle(new Request(`http://localhost/api/ipoGmpHistory${query}`))).status).toBe(400)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('deduplicates requests and caches a bounded historical response', async () => {
    const fetch = fetcher(), handle = createIpoGmpHistoryHandler({ fetcher: fetch, now: () => NOW })
    const responses = await Promise.all([handle(request()), handle(request()), handle(request())])
    const body = await responses[0].json()
    expect(isIpoGmpHistoryResponse(body)).toBe(true)
    expect(body).toMatchObject({ slug: SLUG, checkedAt: NOW, gmp: { amount: 80, asOfDate: '2026-10-22' } })
    await handle(request())
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('returns a trend without overwriting an already available quote', async () => {
    const fetch = fetcher(coreRow({ lastGmp: 30 })), handle = createIpoGmpHistoryHandler({ fetcher: fetch, now: () => NOW })
    expect(await (await handle(request())).json()).toMatchObject({ gmp: null, points: [{ date: '2026-10-22', amount: 80 }] })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('serves active and closed issue series from a reconciled public page', async () => {
    const slug = 'vedantpolyfabs-ipo'
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input)
      return url.includes('xflot.com') ? Response.json({ ok: true, ipo: { ...activeIssue(), slug, lastGmp: 1 } })
        : url.endsWith('/sitemap.xml') ? new Response(sitemap('vedant-poly-fabs')) : new Response(activeHtml())
    })
    const body = await (await createIpoGmpHistoryHandler({ fetcher: fetch, now: () => NOW })(request(slug))).json()
    expect(body).toMatchObject({ slug, gmp: null, points: [{ date: '2026-11-08', amount: 1 }], sourceUrl: 'https://gmptoday.in/ipo/vedant-poly-fabs/' })
    expect(isIpoGmpHistoryResponse(body)).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('rejects changed core identity and preserves an error on upstream outages', async () => {
    const changed = createIpoGmpHistoryHandler({ fetcher: fetcher(coreRow({ slug: 'other-ipo' })), now: () => NOW })
    expect((await changed(request())).status).toBe(502)
    const failed = createIpoGmpHistoryHandler({ fetcher: vi.fn().mockRejectedValue(new Error('Offline')), now: () => NOW })
    expect((await failed(request())).status).toBe(502)
  })

  it('returns unavailable instead of attaching a different issuer archive', async () => {
    const fetch = fetcher(coreRow(), html([point()], { name: 'A Different Company' }))
    const body = await (await createIpoGmpHistoryHandler({ fetcher: fetch, now: () => NOW })(request())).json()
    expect(body).toEqual({ slug: SLUG, gmp: null, points: [], checkedAt: NOW })
  })

  it('rejects oversized source payloads', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('x', { headers: { 'content-length': String(3 * 1024 * 1024) } }))
    expect((await createIpoGmpHistoryHandler({ fetcher: fetch, now: () => NOW })(request())).status).toBe(502)
  })
})

describe('historical response boundary', () => {
  it('validates independent sorted series, source attribution and observation days without inventing missing days', () => {
    const response = { slug: SLUG, gmp: null, checkedAt: NOW, sourceUrl: `https://gmptoday.in/ipo/${PAGE}/`, sourceUpdatedAt: null,
      points: [{ date: '2026-10-20', amount: -5 }, { date: '2026-10-22', amount: 0 }] }
    expect(isIpoGmpHistoryResponse(response)).toBe(true)
    expect(isIpoGmpHistoryResponse({ ...response, points: [...response.points].reverse() })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...response, points: [response.points[0], response.points[0]] })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...response, points: [{ date: '2026-11-09', amount: 5 }] })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...response, points: [{ date: '2026-11-08', amount: NaN }] })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...response, sourceUrl: undefined })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...response, sourceUpdatedAt: NOW + 600_000 })).toBe(false)
  })

  it('requires a safe issue identity and an explicit daily observation without fabricated clock time', () => {
    const response = { slug: SLUG, gmp: parseArchivedIpoGmp(html(), issue(), PAGE, NOW), checkedAt: NOW }
    expect(isIpoGmpHistoryResponse(response)).toBe(true)
    expect(isIpoGmpHistoryResponse({ ...response, slug: '../other' })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...response, gmp: { ...response.gmp, asOfDate: '2026-02-31' } })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...response, gmp: { ...response.gmp, asOfDate: '2026-11-09' } })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...response, gmp: { ...response.gmp, asOfDate: '2026-11-08' } })).toBe(true)
    expect(isIpoGmpHistoryResponse({ ...response, gmp: { ...response.gmp, observedAt: NOW } })).toBe(false)
    expect(isIpoGmpHistoryResponse({ ...response, gmp: { ...response.gmp, sourceUrl: 'https://evil.test/ipo/a/' } })).toBe(false)
  })
})
