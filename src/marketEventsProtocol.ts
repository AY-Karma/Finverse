export const MAX_EVENT_SYMBOLS = 25

export type MarketEventKind = 'results' | 'meeting' | 'dividend' | 'corporate-action' | 'filing'
export type MarketEventDateLabel = 'Meeting date' | 'Ex-date' | 'Published'

export interface MarketEventPayload {
  id: string
  symbol: string
  isin?: string
  /** Current equity listing verified against NSE's security master for issuer-level filings. */
  issuerIsin?: string
  title: string
  kind: MarketEventKind
  date: string
  dateLabel: MarketEventDateLabel
  publishedAt?: number
  sourceUrl: string
  source: 'NSE'
}

export interface MarketEventIssue { source: string; message: string }

export interface MarketEventsPayload {
  events: MarketEventPayload[]
  issues: MarketEventIssue[]
  fetchedAt: number
}

export function isEventSymbol(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9&-]{0,29}$/.test(value) && /[A-Z]/.test(value)
}

export function isEventDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

export function isOfficialEventUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['www.nseindia.com', 'nsearchives.nseindia.com', 'archives.nseindia.com'].includes(url.hostname)
  } catch { return false }
}
