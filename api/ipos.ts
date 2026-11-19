import { isIpoDate, type IpoBoard, type IpoFeed, type IpoIssue, type IpoStatus } from '../src/ipoProtocol.js'
import { cdnCache, createRequestBudget, readBoundedText } from './_requestBudget.js'

const CORE_URL = 'https://www.xflot.com/api/public/market/ipos?limit=200'
const CACHE_MS = 60 * 60_000
const RETRY_MS = 60_000
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
type Row = Record<string, unknown>
interface Dependencies { fetcher: typeof fetch; now: () => number }
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
function today(now: number): string { return new Date(now + 19_800_000).toISOString().slice(0, 10) }
export function normalizeIpoName(value: string): string { return value.toLowerCase().replace(/\b(?:limited|ltd)\b/g, '').replace(/[^a-z0-9]/g, '') }

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

/**
 * IPO discovery from Xflot's documented public API (attribute, poll at most once a minute, keep the disclaimer).
 * Its GMP already aggregates the reporting sites (InvestorGain, IPOWatch and others) and blanks disputed values.
 * GMP Today is no longer read: it answers Vercel's servers with a Cloudflare challenge.
 */
export function createIpoHandler(dependencies: Partial<Dependencies> = {}) {
  const fetcher = dependencies.fetcher ?? fetch, now = dependencies.now ?? Date.now
  const budget = createRequestBudget(now)
  let core: (IpoDirectory & { at: number }) | null = null
  let ttl = CACHE_MS

  async function retrieve(signal: AbortSignal): Promise<string> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(8_000)])
    const response = await fetcher(CORE_URL, { signal: deadline, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('Source unavailable.')
    return readBoundedText(response, 2 * 1024 * 1024, deadline)
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { ...HEADERS, Allow: 'GET' } })
    if ([...new URL(request.url).searchParams].length) return Response.json({ error: 'IPO discovery does not accept portfolio data or query parameters.' }, { status: 400, headers: HEADERS })
    return budget('ipos', () => ttl, async (signal) => {
      const at = now()
      let refreshFailed = false
      if (!core || at - core.at >= CACHE_MS) {
        try {
          const directory = parseDirectory(JSON.parse(await retrieve(signal)), at)
          if (directory.issues.length || !core) core = { ...directory, at }
          else refreshFailed = true
        } catch { refreshFailed = true }
      }
      ttl = refreshFailed ? RETRY_MS : CACHE_MS
      if (!core) return Response.json({ error: 'IPO details are unavailable. Try again shortly.' }, { status: 502, headers: HEADERS })
      const warnings = [...(refreshFailed ? ['IPO details could not be refreshed. Showing the last available data when possible.'] : []), ...core.warnings]
      const payload: IpoFeed = {
        issues: core.issues,
        fetchedAt: core.at,
        sources: [{ name: 'Xflot', url: 'https://www.xflot.com/api-docs', updatedAt: null }],
        warnings, stale: refreshFailed,
        ...(core.disclaimer ? { disclaimer: core.disclaimer } : {}),
      }
      // Share fully refreshed feeds for the rest of their source lifetime, and a retained feed only until the next retry.
      return Response.json(payload, { headers: { ...HEADERS, ...cdnCache(refreshFailed ? RETRY_MS / 1000 : (core.at + CACHE_MS - at) / 1000) } })
    })
  }
}

export const handleIpoRequest = createIpoHandler()
export default { fetch: handleIpoRequest }
