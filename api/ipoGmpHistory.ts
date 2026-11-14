import { isIpoDate, type IpoGmp, type IpoIssue } from '../src/ipoProtocol.js'
import { isIpoGmpHistorySlug, type IpoGmpHistoryResponse, type IpoGmpPoint } from '../src/ipoGmpHistoryProtocol.js'
import { normalizeIpoName, parseIpoDirectory } from './ipos.js'
import { createRequestBudget, readBoundedText } from './requestBudget.js'

const SITEMAP_URL = 'https://gmptoday.in/sitemap.xml'
const CACHE_MS = 60 * 60_000
const MAX_BYTES = 2 * 1024 * 1024
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
const ARCHIVE_ALIASES: Record<string, { name: string; slug: string; heading?: string; preferredSlug?: string }> = {
  'bonfigliolitransmissions-ipo': { name: 'Bonfiglioli Transmissions', slug: 'bonfiglioli-transmissions' },
  'sahajanandmedicaltechnologies-ipo': { name: 'Sahajanand Medical Technologies', slug: 'sahajanand-medical' },
  'tonboimagingindia-ipo': { name: 'Tonbo Imaging India', slug: 'tonbo-imaging' },
  'maxwellengineeringsolutions-ipo': { name: 'Maxwell Engineering Solutions', slug: 'maxwell-engineering-solutions', heading: 'Maxwell Engineering' },
  'bombaycoatedandspecialsteels-ipo': { name: 'Bombay Coated and Special Steels', slug: 'bombay-coated', heading: 'Bombay Coated', preferredSlug: 'bombay-coated-special-steels' },
  'zetwerkmanufacturingbusinesses-ipo': { name: 'Zetwerk Manufacturing Businesses', slug: 'zetwerk-manufacturing', heading: 'Zetwerk' },
  'rkfashionaccessories-ipo': { name: 'R.K.Fashion Accessories', slug: 'r-k-fashion-accessories', preferredSlug: 'r-k-fashion-accessories' },
}

interface Dependencies { fetcher: typeof fetch; now: () => number }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function decode(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]
    const code = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  })
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map((match) => [match[1].toLowerCase(), decode(match[2] ?? match[3])]))
}

function plainText(html: string): string { return decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() }

function archiveDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isIpoDate(value) ? value : null
  const match = value.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/)
  if (!match) return null
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[2].toLowerCase()) + 1
  const date = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`
  return month && isIpoDate(date) ? date : null
}

function facts(html: string): Map<string, string> {
  const result = new Map<string, string>()
  let label: string | null = null
  for (const match of html.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)) {
    const classes = attributes(match[1]).class?.split(/\s+/) ?? []
    if (classes.includes('fact-l')) label = plainText(match[2])
    else if (classes.includes('fact-v') && label) {
      if (result.has(label)) throw new Error('Historical IPO facts are ambiguous.')
      result.set(label, plainText(match[2]))
      label = null
    }
  }
  return result
}

function pageUpdate(html: string, at: number): number | null {
  const meta = [...html.matchAll(/<meta\b([^>]*)>/gi)].map((match) => attributes(match[1])).find((attrs) => attrs.name === 'gmp-built')
  if (!meta?.content || !/(?:Z|[+-]\d{2}:\d{2})$/.test(meta.content)) return null
  const updated = Date.parse(meta.content)
  return Number.isFinite(updated) && updated > 0 && updated <= at + 300_000 ? updated : null
}

function biddingDates(open: string, close: string): string {
  const parts = (value: string) => { const [year, month, day] = value.split('-').map(Number); return { year, month, day, label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1] } }
  const start = parts(open), end = parts(close)
  return start.year === end.year && start.month === end.month ? `${start.day}–${end.day} ${end.label}` : `${start.day} ${start.label}–${end.day} ${end.label}`
}

/** Active pages contain numeric chart placeholders for readings their daily table marks missing. */
function publishedDailyValues(html: string): Map<string, number | null> {
  const result = new Map<string, number | null>()
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)]
    const date = cells.find((cell) => attributes(cell[1])['data-l'] === 'Date')
    const premium = cells.find((cell) => attributes(cell[1])['data-l'] === 'GMP (median)')
    if (!date || !premium) continue
    const day = plainText(date[2]), amount = plainText(premium[2]).replace(/[₹,\s]/g, '')
    if (!isIpoDate(day)) continue
    if (result.has(day)) throw new Error('Daily GMP readings are ambiguous.')
    result.set(day, /^-?\d+(?:\.\d+)?$/.test(amount) ? Number(amount) : null)
  }
  return result
}

interface ParsedTrend { points: IpoGmpPoint[]; sourceUrl: string; sourceUpdatedAt: number | null; gmp: IpoGmp | null }

/** Genuine dated medians, without interpolation, synthetic backfills or listing-day quotes. */
export function parseIpoGmpTrend(html: string, issue: IpoIssue, pageSlug: string, at: number): ParsedTrend | null {
  if (html.length > MAX_BYTES || !isIpoGmpHistorySlug(pageSlug)) throw new Error('Historical IPO page is invalid.')
  if (!isIpoDate(issue.openDate) || !finite(issue.priceMax) || issue.priceMax <= 0) return null
  const sourceUrl = `https://gmptoday.in/ipo/${pageSlug}/`
  const canonicals = [...html.matchAll(/<link\b([^>]*)>/gi)].map((match) => attributes(match[1])).filter((attrs) => attrs.rel === 'canonical')
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
  if (canonicals.length !== 1 || canonicals[0].href !== sourceUrl || headings.length !== 1) return null
  const headingIssuer = plainText(headings[0][1]).split(/\s+IPO\b/i)[0]
  const alias = issue.id.startsWith('xflot:') ? ARCHIVE_ALIASES[issue.id.slice(6)] : undefined
  const knownHeading = alias?.heading && alias.slug === pageSlug && normalizeIpoName(alias.name) === normalizeIpoName(issue.name)
    && normalizeIpoName(headingIssuer) === normalizeIpoName(alias.heading)
  if (normalizeIpoName(headingIssuer) !== normalizeIpoName(issue.name) && !knownHeading) return null
  const details = facts(html)
  const today = new Date(at + 19_800_000).toISOString().slice(0, 10)
  const listed = issue.status === 'LISTED' || details.has('Listed on')
  const publishedListing = archiveDate(details.get('Listed on') ?? '')
  let listingDate = issue.listingDate
  if (listed && issue.status !== 'LISTED') {
    if (issue.status !== 'CLOSED' || !isIpoDate(issue.closeDate) || !publishedListing
      || listingDate !== null && listingDate !== publishedListing
      || publishedListing <= issue.closeDate || publishedListing > today
      || Date.parse(publishedListing) - Date.parse(issue.closeDate) > 14 * 86_400_000
      || (details.get('Issue dates') ?? '').replace(/\s*–\s*/g, '–') !== biddingDates(issue.openDate, issue.closeDate)) return null
    listingDate = publishedListing
  }
  const price = details.get(listed ? 'Issue price' : 'Price band (upper)')?.replace(/[₹,\s]/g, '') ?? ''
  if (!/^\d+(?:\.\d+)?$/.test(price) || Number(price) !== issue.priceMax
    || details.get('Segment')?.toLowerCase() !== (issue.board === 'MAINBOARD' ? 'mainboard' : 'sme')) return null
  if (listed ? !isIpoDate(listingDate) || publishedListing !== listingDate
    : !isIpoDate(issue.closeDate) || (details.get('Bidding dates') ?? '').replace(/\s*–\s*/g, '–') !== biddingDates(issue.openDate, issue.closeDate)) return null

  const charts = [...html.matchAll(/<[a-z][\w:-]*\b([^>]*)>/gi)].map((match) => attributes(match[1])).filter((attrs) => attrs['data-points'] !== undefined)
  if (charts.length !== 1) throw new Error('Historical GMP chart format changed.')
  const data: unknown = JSON.parse(charts[0]['data-points'])
  if (!Array.isArray(data) || data.length > 3660) throw new Error('Historical GMP chart is invalid.')
  const published = listed ? null : publishedDailyValues(html)
  const eligible = data.filter((point): point is { d: string; m: number; lo: number | null; hi: number | null; n: number; bf: false } =>
    record(point) && isIpoDate(point.d) && (!listingDate || point.d < listingDate) && point.d <= today
      && point.bf === false && finite(point.m) && finite(point.n) && Number.isInteger(point.n) && point.n > 0
      && (!published || published.get(point.d) === point.m)
      && (point.lo === null || finite(point.lo)) && (point.hi === null || finite(point.hi))
      && (point.lo === null || point.lo <= point.m) && (point.hi === null || point.hi >= point.m))
  if (!eligible.length || new Set(eligible.map((point) => point.d)).size !== eligible.length) return null
  eligible.sort((a, b) => a.d.localeCompare(b.d))
  const point = listed ? eligible.filter((point) => point.d >= issue.openDate!).at(-1) : undefined
  const sourceUpdatedAt = pageUpdate(html, at)
  const gmp: IpoGmp | null = point ? { amount: point.m, percent: point.m / issue.priceMax * 100, source: 'GMP Today', sourceUrl,
    asOfDate: point.d, observedAt: null, sourceUpdatedAt: pageUpdate(html, at), sources: point.n,
    rangeLow: point.lo, rangeHigh: point.hi } : null
  return { points: eligible.map((point) => ({ date: point.d, amount: point.m })), sourceUrl, sourceUpdatedAt, gmp }
}

function parseSitemap(html: string): string[] {
  const slugs = [...html.matchAll(/<loc>\s*https:\/\/gmptoday\.in\/ipo\/([a-z0-9][a-z0-9-]{0,149})\/\s*<\/loc>/g)].map((match) => match[1])
  if (!slugs.length || slugs.length > 2000) throw new Error('IPO archive directory format changed.')
  return [...new Set(slugs)]
}

export function createIpoGmpHistoryHandler(dependencies: Partial<Dependencies> = {}) {
  const fetcher = dependencies.fetcher ?? fetch, now = dependencies.now ?? Date.now
  const budget = createRequestBudget(now)
  let sitemap: { slugs: string[]; at: number } | null = null
  let sitemapPending: Promise<string[]> | null = null

  async function retrieve(url: string, signal: AbortSignal): Promise<string> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(6_000)])
    const response = await fetcher(url, { signal: deadline, redirect: 'error', headers: { Accept: url.includes('xflot.com') ? 'application/json' : 'text/html,application/xml' } })
    if (!response.ok) throw new Error('Historical IPO source is unavailable.')
    return readBoundedText(response, MAX_BYTES, deadline)
  }

  async function archiveSlugs(signal: AbortSignal): Promise<string[]> {
    if (sitemap && now() - sitemap.at < CACHE_MS) return sitemap.slugs
    if (!sitemapPending) sitemapPending = retrieve(SITEMAP_URL, signal).then((html) => {
      const slugs = parseSitemap(html)
      sitemap = { slugs, at: now() }
      return slugs
    }).finally(() => { sitemapPending = null })
    return sitemapPending
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { ...HEADERS, Allow: 'GET' } })
    const params = [...new URL(request.url).searchParams]
    const slug = params[0]?.[1]
    if (params.length !== 1 || params[0][0] !== 'slug' || !isIpoGmpHistorySlug(slug)) {
      return Response.json({ error: 'Choose one valid IPO issue.' }, { status: 400, headers: HEADERS })
    }
    return budget(slug, CACHE_MS, async (signal) => {
      const checkedAt = now()
      const missing = () => Response.json({ slug, gmp: null, points: [], checkedAt } satisfies IpoGmpHistoryResponse, { headers: HEADERS })
      const raw: unknown = JSON.parse(await retrieve(`https://www.xflot.com/api/public/market/ipos/${slug}`, signal))
      if (!record(raw) || raw.ok !== true || !record(raw.ipo) || raw.ipo.slug !== slug) throw new Error('Historical IPO identity changed.')
      const issues = parseIpoDirectory({ ok: true, ipos: [raw.ipo] }, checkedAt)
      const issue = issues[0]
      if (!issue || !issue.openDate || issue.priceMax === null) return missing()
      const slugs = await archiveSlugs(signal)
      const alias = ARCHIVE_ALIASES[slug]
      const exactMatches = slugs.filter((value) => normalizeIpoName(value) === normalizeIpoName(issue.name))
      const preferred = alias?.preferredSlug && normalizeIpoName(alias.name) === normalizeIpoName(issue.name) ? slugs.filter((value) => value === alias.preferredSlug) : []
      const matches = preferred.length ? preferred : exactMatches.length ? exactMatches : alias && normalizeIpoName(alias.name) === normalizeIpoName(issue.name)
        ? slugs.filter((value) => value === alias.slug)
        : slugs.filter((value) => normalizeIpoName(value) === normalizeIpoName(issue.name))
      if (matches.length !== 1) return missing()
      const page = await retrieve(`https://gmptoday.in/ipo/${matches[0]}/`, signal)
      const trend = parseIpoGmpTrend(page, issue, matches[0], checkedAt)
      if (!trend) return missing()
      return Response.json({ slug, ...trend, gmp: issue.gmp ? null : trend.gmp, checkedAt } satisfies IpoGmpHistoryResponse, { headers: HEADERS })
    })
  }
}

export const handleIpoGmpHistoryRequest = createIpoGmpHistoryHandler()
export default { fetch: handleIpoGmpHistoryRequest }
