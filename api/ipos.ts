import { isIpoDate, type IpoBoard, type IpoFeed, type IpoGmp, type IpoIssue, type IpoStatus } from '../src/ipoProtocol.js'
import { createRequestBudget, readBoundedText } from './requestBudget.js'

const CORE_URL = 'https://www.xflot.com/api/public/market/ipos?limit=200'
const GMP_URL = 'https://gmptoday.in/'
const CACHE_MS = 60 * 60_000
const RETRY_MS = 60_000
const DAY_MS = 86_400_000
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
type Row = Record<string, unknown>
interface Dependencies { fetcher: typeof fetch; now: () => number }
interface GmpRow { name: string; slug: string; board: IpoBoard; gmp: IpoGmp }
interface GmpBoard { rows: GmpRow[]; updatedAt: number | null }
interface IpoDirectory { issues: IpoIssue[]; warnings: string[]; disclaimer?: string }

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function positive(value: unknown): number | null { const parsed = number(value); return parsed !== null && parsed > 0 ? parsed : null }
function text(value: unknown): string { return typeof value === 'string' ? value.trim().slice(0, 200) : '' }
function date(value: unknown): string | null { const parsed = text(value).slice(0, 10); return isIpoDate(parsed) ? parsed : null }
function timestamp(value: unknown, now: number): number | null {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now + 300_000 ? parsed : null
}
function today(now: number): string { return new Date(now + 19_800_000).toISOString().slice(0, 10) }
export function normalizeIpoName(value: string): string { return value.toLowerCase().replace(/\b(?:limited|ltd)\b/g, '').replace(/[^a-z0-9]/g, '') }

// These publisher display names were reconciled against the corresponding issue names and slugs.
const GMP_ALIASES: Record<string, string> = {
  'maxwell-engineering-solutions': 'Maxwell Engineering Solutions Limited',
  'bombay-coated': 'Bombay Coated and Special Steels',
}

function status(row: Row, at: number): IpoStatus | null {
  const known = text(row.status)
  if (!['OPEN', 'UPCOMING', 'CLOSED', 'LISTED'].includes(known)) return null
  const day = today(at), listing = date(row.listingDate), open = date(row.openDate), close = date(row.closeDate)
  if (listing && listing <= day || known === 'LISTED') return 'LISTED'
  if (open && open > day) return 'UPCOMING'
  if (close && close < day) return 'CLOSED'
  if (open && close && open <= day && close >= day) return 'OPEN'
  return known as IpoStatus
}

function consolidateOffers(issues: IpoIssue[], warnings: string[]): IpoIssue[] {
  const offers = new Map<string, IpoIssue[]>()
  for (const issue of issues) {
    const key = issue.openDate && issue.closeDate
      ? [normalizeIpoName(issue.name), issue.board, issue.openDate, issue.closeDate].join('|') : issue.id
    offers.set(key, [...offers.get(key) ?? [], issue])
  }
  const facts = ['listingDate', 'allotmentDate', 'priceMin', 'priceMax', 'lotSize'] as const
  const result: IpoIssue[] = []
  let conflicts = 0
  let quoteConflicts = 0
  for (const group of offers.values()) {
    if (facts.some((field) => new Set(group.map((issue) => issue[field]).filter((value) => value !== null)).size > 1)) {
      conflicts += 1
      continue
    }
    const completeness = (issue: IpoIssue) => facts.filter((field) => issue[field] !== null).length
    const sorted = [...group].sort((a, b) => completeness(b) - completeness(a) || a.id.localeCompare(b.id))
    const merged = { ...sorted[0] }
    for (const issue of sorted) {
      merged.listingDate ??= issue.listingDate
      merged.allotmentDate ??= issue.allotmentDate
      merged.priceMin ??= issue.priceMin
      merged.priceMax ??= issue.priceMax
      merged.lotSize ??= issue.lotSize
    }
    if (group.some((issue) => issue.status === 'LISTED')) merged.status = 'LISTED'
    const quotes = group.flatMap((issue) => issue.gmp ? [issue.gmp] : [])
    merged.gmp = quotes.length && quotes.every((quote) => quote.amount === quotes[0].amount && quote.percent === quotes[0].percent) ? quotes[0] : null
    if (quotes.length && !merged.gmp) quoteConflicts += 1
    result.push(merged)
  }
  if (conflicts) warnings.push(`Omitted ${conflicts} ${conflicts === 1 ? 'offer' : 'offers'} with conflicting issue details.`)
  if (quoteConflicts) warnings.push(`Omitted conflicting GMP reports for ${quoteConflicts} ${quoteConflicts === 1 ? 'offer' : 'offers'}.`)
  return result
}

export function parseIpoDirectory(value: unknown, at: number, warnings: string[] = []): IpoIssue[] {
  if (!value || typeof value !== 'object' || !('ok' in value) || value.ok !== true || !('ipos' in value) || !Array.isArray(value.ipos) || value.ipos.length > 200) throw new Error('IPO directory format changed.')
  const issues: IpoIssue[] = []
  for (const input of value.ipos) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) continue
    const row = input as Row, name = text(row.name), slug = text(row.slug), board = text(row.board), state = status(row, at)
    if (!name || !/^[a-z0-9][a-z0-9-]{0,149}$/.test(slug) || !['MAINBOARD', 'SME'].includes(board) || !state) continue
    if (row.typeOfIssue && row.typeOfIssue !== 'IPO') continue
    const lot = positive(row.lotSize), low = positive(row.priceMin), high = positive(row.priceMax)
    if (low !== null && high !== null && low > high) continue
    const amount = row.gmpDisputed === true ? null : number(row.lastGmp)
    const sourceCount = number(row.gmpSources)
    issues.push({ id: `xflot:${slug}`, name, board: board as IpoBoard, status: state,
      openDate: date(row.openDate), closeDate: date(row.closeDate), listingDate: date(row.listingDate), allotmentDate: date(row.allotmentDate),
      priceMin: low, priceMax: high, lotSize: lot !== null && Number.isInteger(lot) ? lot : null,
      sourceUrl: `https://www.xflot.com/ipo/${slug}`,
      gmp: amount === null ? null : { amount, percent: number(row.lastGmpPct), source: 'Xflot', sourceUrl: `https://www.xflot.com/ipo/${slug}`,
        sourceUpdatedAt: null, observedAt: null, sources: sourceCount !== null && Number.isInteger(sourceCount) && sourceCount >= 0 ? sourceCount : null, rangeLow: null, rangeHigh: null },
    })
  }
  const grouped = new Map<string, IpoIssue[]>()
  for (const issue of issues) grouped.set(issue.id, [...grouped.get(issue.id) ?? [], issue])
  const unique: IpoIssue[] = []
  let conflicts = 0
  for (const group of grouped.values()) {
    if (group.every((issue) => JSON.stringify(issue) === JSON.stringify(group[0]))) unique.push(group[0])
    else conflicts += 1
  }
  if (conflicts) warnings.push(`Omitted ${conflicts} ${conflicts === 1 ? 'issue' : 'issues'} with conflicting source records.`)
  if (unique.length === 0 && value.ipos.length > 0) throw new Error('IPO directory identities changed.')
  return consolidateOffers(unique, warnings)
}

function parseDirectory(value: unknown, at: number): IpoDirectory {
  const warnings: string[] = []
  const issues = parseIpoDirectory(value, at, warnings)
  const rawDisclaimer = (value as Row).disclaimer
  if (rawDisclaimer !== undefined && (typeof rawDisclaimer !== 'string' || rawDisclaimer.trim().length === 0 || rawDisclaimer.length > 2000)) throw new Error('IPO source disclaimer format changed.')
  return { issues, warnings, ...(typeof rawDisclaimer === 'string' ? { disclaimer: rawDisclaimer } : {}) }
}

function decode(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]
    const code = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  })
}
function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [match[1].toLowerCase(), decode(match[2] ?? match[3])]))
}

export function parseGmpBoard(html: string, at: number): GmpBoard {
  const meta = [...html.matchAll(/<meta\b([^>]*)>/gi)].map((match) => attributes(match[1])).find((attrs) => attrs.name === 'gmp-built')
  const updatedAt = timestamp(meta?.content, at)
  if (!updatedAt) throw new Error('GMP source update time unavailable.')
  const rows: GmpRow[] = []
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = attributes(match[1]), body = decode(match[2].replace(/<[^>]*>/g, ' '))
    if (!attrs.class?.split(/\s+/).includes('row')) continue
    const board = attrs['data-group'] === 'sme' ? 'SME' : attrs['data-group'] === 'mainboard' ? 'MAINBOARD' : null
    const name = text(attrs['data-name']), slug = text(attrs['data-slug']), amount = number(attrs['data-med'])
    if (!board || !name || !/^[a-z0-9][a-z0-9-]{0,149}$/.test(slug) || attrs.href !== `/ipo/${slug}/` || amount === null) continue
    const sources = body.match(/\b(\d+)\s+sources?\b/i)
    const range = match[2].match(/class=["'][^"']*\bc-range\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]
    const bounds = range ? decode(range.replace(/<[^>]*>/g, '')).replace(/[,₹\s]/g, '').match(/^(-?\d+(?:\.\d+)?)[–−-](-?\d+(?:\.\d+)?)$/) : null
    rows.push({ name, slug, board, gmp: { amount, percent: number(attrs['data-est']), source: 'GMP Today', sourceUrl: `https://gmptoday.in/ipo/${slug}/`,
      sourceUpdatedAt: updatedAt, observedAt: null, sources: sources ? Number(sources[1]) : null,
      rangeLow: bounds ? number(bounds[1]) : null, rangeHigh: bounds ? number(bounds[2]) : null } })
  }
  if (!rows.length || rows.length > 200 || new Set(rows.map((row) => row.slug)).size !== rows.length) throw new Error('GMP board format changed.')
  return { rows, updatedAt }
}

export function enrichIpoGmp(issues: IpoIssue[], board: GmpBoard, at: number): IpoIssue[] {
  return issues.map((issue) => {
    const close = issue.closeDate ? Date.parse(`${issue.closeDate}T00:00:00Z`) : null
    if (close !== null && at - close > 45 * DAY_MS) return issue
    const matches = board.rows.filter((row) => row.board === issue.board && normalizeIpoName(GMP_ALIASES[row.slug] ?? row.name) === normalizeIpoName(issue.name))
    if (matches.length !== 1) return issue
    const reverse = issues.filter((candidate) => candidate.board === issue.board && normalizeIpoName(candidate.name) === normalizeIpoName(issue.name))
    if (reverse.length !== 1) return issue
    return { ...issue, gmp: matches[0].gmp }
  })
}

export function createIpoHandler(dependencies: Partial<Dependencies> = {}) {
  const fetcher = dependencies.fetcher ?? fetch, now = dependencies.now ?? Date.now
  const budget = createRequestBudget(now)
  let core: (IpoDirectory & { at: number }) | null = null
  let gmp: GmpBoard | null = null
  let gmpFetchedAt = 0
  let ttl = CACHE_MS

  async function retrieve(url: string, signal: AbortSignal): Promise<string> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(8_000)])
    const response = await fetcher(url, { signal: deadline, headers: { Accept: url === GMP_URL ? 'text/html' : 'application/json' } })
    if (!response.ok) throw new Error('Source unavailable.')
    return readBoundedText(response, 2 * 1024 * 1024, deadline)
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { ...HEADERS, Allow: 'GET' } })
    if ([...new URL(request.url).searchParams].length) return Response.json({ error: 'IPO discovery does not accept portfolio data or query parameters.' }, { status: 400, headers: HEADERS })
    return budget('ipos', () => ttl, async (signal) => {
      const warnings: string[] = []
      const at = now()
      const refreshCore = !core || at - core.at >= CACHE_MS
      const refreshGmp = !gmp || at - gmpFetchedAt >= CACHE_MS
      const [directory, board] = await Promise.allSettled([
        !refreshCore && core ? Promise.resolve(core) : retrieve(CORE_URL, signal).then((body) => parseDirectory(JSON.parse(body), at)),
        !refreshGmp && gmp ? Promise.resolve(gmp) : retrieve(GMP_URL, signal).then((body) => parseGmpBoard(body, at)),
      ])
      const coreFailed = directory.status === 'rejected' || directory.value.issues.length === 0 && Boolean(core)
      if (directory.status === 'fulfilled' && !coreFailed) {
        if (refreshCore) core = { ...directory.value, at }
      }
      else warnings.push('IPO details could not be refreshed. Showing the last available data when possible.')
      if (board.status === 'fulfilled') { if (refreshGmp) { gmp = board.value; gmpFetchedAt = at } }
      else warnings.push('Reported GMP could not be refreshed. Source values may be unavailable or dated.')
      ttl = warnings.length ? RETRY_MS : CACHE_MS
      if (!core) return Response.json({ error: 'IPO details are unavailable. Try again shortly.' }, { status: 502, headers: HEADERS })
      warnings.push(...core.warnings)
      const payload: IpoFeed = {
        issues: gmp ? enrichIpoGmp(core.issues, gmp, at) : core.issues,
        fetchedAt: core.at,
        sources: [{ name: 'Xflot', url: 'https://www.xflot.com/api-docs', updatedAt: null },
          ...(gmp ? [{ name: 'GMP Today', url: GMP_URL, updatedAt: gmp.updatedAt }] : [])],
        warnings, stale: coreFailed || board.status === 'rejected' || Boolean(gmp?.updatedAt && at - gmp.updatedAt > DAY_MS),
        ...(core.disclaimer ? { disclaimer: core.disclaimer } : {}),
      }
      return Response.json(payload, { headers: HEADERS })
    })
  }
}

export const handleIpoRequest = createIpoHandler()
export default { fetch: handleIpoRequest }
