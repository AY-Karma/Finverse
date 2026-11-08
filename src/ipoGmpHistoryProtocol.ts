import { isIpoDate, isIpoGmp, type IpoGmp } from './ipoProtocol'

export interface IpoGmpHistoryResponse {
  slug: string
  gmp: IpoGmp | null
  checkedAt: number
  points?: IpoGmpPoint[]
  sourceUrl?: string
  sourceUpdatedAt?: number | null
}

export interface IpoGmpPoint { date: string; amount: number }

export function isIpoGmpHistorySlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,149}$/.test(value)
}

export function isIpoGmpHistoryResponse(value: unknown): value is IpoGmpHistoryResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (!isIpoGmpHistorySlug(row.slug) || typeof row.checkedAt !== 'number' || !Number.isFinite(row.checkedAt) || row.checkedAt <= 0) return false
  const checkedDate = new Date(row.checkedAt + 19_800_000)
  if (!Number.isFinite(checkedDate.getTime())) return false
  const today = checkedDate.toISOString().slice(0, 10)
  const sourceUrl = (value: unknown) => typeof value === 'string' && /^https:\/\/gmptoday\.in\/ipo\/[a-z0-9][a-z0-9-]{0,149}\/$/.test(value)
  if (row.sourceUrl !== undefined && !sourceUrl(row.sourceUrl)) return false
  if (row.sourceUpdatedAt !== undefined && row.sourceUpdatedAt !== null && (typeof row.sourceUpdatedAt !== 'number' || !Number.isFinite(row.sourceUpdatedAt) || row.sourceUpdatedAt <= 0 || row.sourceUpdatedAt > row.checkedAt + 300_000)) return false
  if (row.points !== undefined) {
    if (!Array.isArray(row.points) || row.points.length > 3660 || row.points.length > 0 && !sourceUrl(row.sourceUrl)) return false
    let previous = ''
    for (const point of row.points) {
      if (!point || typeof point !== 'object' || !isIpoDate(point.date) || point.date > today || point.date <= previous || typeof point.amount !== 'number' || !Number.isFinite(point.amount)) return false
      previous = point.date
    }
  }
  if (row.gmp === null) return true
  if (!isIpoGmp(row.gmp) || row.gmp.source !== 'GMP Today' || !isIpoDate(row.gmp.asOfDate) || row.gmp.observedAt !== null) return false
  if (row.gmp.asOfDate > today) return false
  return /^https:\/\/gmptoday\.in\/ipo\/[a-z0-9][a-z0-9-]{0,149}\/$/.test(row.gmp.sourceUrl)
}
