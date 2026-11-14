export type IpoBoard = 'MAINBOARD' | 'SME'
export type IpoStatus = 'OPEN' | 'UPCOMING' | 'CLOSED' | 'LISTED'

export interface IpoGmp {
  amount: number
  percent: number | null
  source: 'GMP Today' | 'Xflot'
  sourceUrl: string
  sourceUpdatedAt: number | null
  observedAt: number | null
  /** Daily historical observation; no intraday quote time is implied. */
  asOfDate?: string
  sources: number | null
  rangeLow: number | null
  rangeHigh: number | null
}

export interface IpoIssue {
  id: string
  name: string
  board: IpoBoard
  status: IpoStatus
  openDate: string | null
  closeDate: string | null
  listingDate: string | null
  allotmentDate: string | null
  priceMin: number | null
  priceMax: number | null
  lotSize: number | null
  sourceUrl: string
  gmp: IpoGmp | null
}

export interface IpoFeed {
  issues: IpoIssue[]
  fetchedAt: number
  sources: { name: string; url: string; updatedAt: number | null }[]
  warnings: string[]
  stale: boolean
  disclaimer?: string
}

export function isIpoSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['www.xflot.com', 'xflot.com', 'gmptoday.in'].includes(url.hostname)
  } catch { return false }
}

export function isIpoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const numberOrNull = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isFinite(value)
const timeOrNull = (value: unknown) => value === null || typeof value === 'number' && Number.isFinite(value) && value > 0
const dateOrNull = (value: unknown) => value === null || isIpoDate(value)
const positiveOrNull = (value: unknown) => value === null || typeof value === 'number' && Number.isFinite(value) && value > 0
const shortText = (value: unknown, maximum: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum

export function isIpoGmp(value: unknown): value is IpoGmp {
  if (!record(value)) return false
  return typeof value.amount === 'number' && Number.isFinite(value.amount)
    && numberOrNull(value.percent) && ['GMP Today', 'Xflot'].includes(String(value.source))
    && isIpoSourceUrl(value.sourceUrl) && timeOrNull(value.sourceUpdatedAt) && timeOrNull(value.observedAt)
    && (value.asOfDate === undefined || isIpoDate(value.asOfDate))
    && (value.sources === null || Number.isInteger(value.sources) && Number(value.sources) >= 0)
    && numberOrNull(value.rangeLow) && numberOrNull(value.rangeHigh)
    && (value.rangeLow === null || value.rangeHigh === null || value.rangeLow <= value.rangeHigh)
}

function isIpoIssue(value: unknown): value is IpoIssue {
  if (!record(value)) return false
  return shortText(value.id, 200) && shortText(value.name, 200)
    && ['MAINBOARD', 'SME'].includes(String(value.board)) && ['OPEN', 'UPCOMING', 'CLOSED', 'LISTED'].includes(String(value.status))
    && dateOrNull(value.openDate) && dateOrNull(value.closeDate) && dateOrNull(value.listingDate) && dateOrNull(value.allotmentDate)
    && positiveOrNull(value.priceMin) && positiveOrNull(value.priceMax)
    && (value.priceMin === null || value.priceMax === null || Number(value.priceMin) <= Number(value.priceMax))
    && (value.lotSize === null || Number.isInteger(value.lotSize) && Number(value.lotSize) > 0)
    && isIpoSourceUrl(value.sourceUrl) && (value.gmp === null || isIpoGmp(value.gmp))
}

export function isIpoFeed(value: unknown): value is IpoFeed {
  if (!record(value)) return false
  return Array.isArray(value.issues) && value.issues.length <= 200 && value.issues.every(isIpoIssue)
    && new Set(value.issues.map((issue) => issue.id)).size === value.issues.length
    && typeof value.fetchedAt === 'number' && Number.isFinite(value.fetchedAt) && value.fetchedAt > 0
    && typeof value.stale === 'boolean' && Array.isArray(value.warnings) && value.warnings.length <= 20
    && (value.disclaimer === undefined || shortText(value.disclaimer, 2000))
    && value.warnings.every((warning) => shortText(warning, 500))
    && Array.isArray(value.sources) && value.sources.length <= 5
    && value.sources.every((source) => record(source) && shortText(source.name, 80) && isIpoSourceUrl(source.url) && timeOrNull(source.updatedAt))
}
