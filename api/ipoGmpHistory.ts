import { isIpoDate, type IpoGmp, type IpoIssue } from '../src/ipoProtocol.js'
import { isIpoGmpHistorySlug, type IpoGmpHistoryResponse, type IpoGmpPoint } from '../src/ipoGmpHistoryProtocol.js'
import { parseIpoDirectory } from './ipos.js'
import { cdnCache, createRequestBudget, readBoundedText } from './_requestBudget.js'

const CACHE_MS = 60 * 60_000
const MAX_BYTES = 2 * 1024 * 1024
const MAX_REPORTS = 3660
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }

interface Dependencies { fetcher: typeof fetch; now: () => number }
interface ParsedTrend { points: IpoGmpPoint[]; sourceUrl: string; sourceUpdatedAt: null; gmp: IpoGmp | null }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Xflot's dated GMP reports for one issue, as one median per reported day before listing.
 * No interpolation or backfill: days without a report stay absent. A listed issue also gets its final pre-listing GMP.
 */
export function parseIpoGmpTrend(reports: unknown, issue: IpoIssue, slug: string, at: number): ParsedTrend | null {
  if (!Array.isArray(reports) || reports.length > MAX_REPORTS) throw new Error('Historical GMP reports are invalid.')
  if (!isIpoDate(issue.openDate) || !finite(issue.priceMax) || issue.priceMax <= 0) return null
  const today = new Date(at + 19_800_000).toISOString().slice(0, 10)
  const days = new Map<string, number[]>()
  for (const report of reports) {
    if (!record(report) || typeof report.observedAt !== 'string' || !finite(report.gmp)) continue
    const day = report.observedAt.slice(0, 10)
    if (!isIpoDate(day) || day > today || issue.listingDate && day >= issue.listingDate) continue
    days.set(day, [...days.get(day) ?? [], report.gmp])
  }
  if (!days.size) return null
  const sourceUrl = `https://www.xflot.com/ipo/${slug}`
  const points = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, amount: median(values) }))
  const final = issue.status === 'LISTED' ? points.filter((point) => point.date >= issue.openDate!).at(-1) : undefined
  const reported = final ? days.get(final.date)! : []
  const gmp: IpoGmp | null = final ? { amount: final.amount, percent: final.amount / issue.priceMax * 100, source: 'Xflot', sourceUrl,
    asOfDate: final.date, observedAt: null, sourceUpdatedAt: null, sources: reported.length,
    rangeLow: reported.length > 1 ? Math.min(...reported) : null, rangeHigh: reported.length > 1 ? Math.max(...reported) : null } : null
  return { points, sourceUrl, sourceUpdatedAt: null, gmp }
}

export function createIpoGmpHistoryHandler(dependencies: Partial<Dependencies> = {}) {
  const fetcher = dependencies.fetcher ?? fetch, now = dependencies.now ?? Date.now
  const budget = createRequestBudget(now)

  async function retrieve(url: string, signal: AbortSignal): Promise<string> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(6_000)])
    const response = await fetcher(url, { signal: deadline, redirect: 'error', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('Historical IPO source is unavailable.')
    return readBoundedText(response, MAX_BYTES, deadline)
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
      const issue = parseIpoDirectory({ ok: true, ipos: [raw.ipo] }, checkedAt)[0]
      if (!issue) return missing()
      const trend = parseIpoGmpTrend(raw.ipo.gmp ?? [], issue, slug, checkedAt)
      if (!trend) return missing()
      // Half the client lifetime, so a shared response still has time left in the browser cache.
      return Response.json({ slug, ...trend, gmp: issue.gmp ? null : trend.gmp, checkedAt } satisfies IpoGmpHistoryResponse, { headers: { ...HEADERS, ...cdnCache(CACHE_MS / 2000) } })
    })
  }
}

export const handleIpoGmpHistoryRequest = createIpoGmpHistoryHandler()
export default { fetch: handleIpoGmpHistoryRequest }
