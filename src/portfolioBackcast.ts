import type { HistoryPoint } from './live'
import type { MarketDataAdapter } from './marketData'
import type { LiveQuote, Position } from './types'
import { hasSupportedValuationCurrency, positionValue, quoteKey } from './valuation'

const DAY_MS = 24 * 60 * 60 * 1000
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
// Date-only Indian equity bars are considered closes after the regular session ends.
const EQUITY_CLOSE_OFFSET_MS = 15.5 * 60 * 60 * 1000
const MAX_HOLDINGS = 40
const HISTORY_CONCURRENCY = 6

interface PortfolioBackcastPoint {
  at: number
  value: number
  invested: number
  isCurrent?: boolean
}

export interface PortfolioBackcastHistory {
  points: PortfolioBackcastPoint[]
  coveredPositions: Position[]
  holdingsIncluded: number
  holdingsTotal: number
}

export interface PortfolioBackcast extends PortfolioBackcastHistory {
  /** Share of the currently priced INR value represented by these holdings. */
  coveragePct: number
  /** Same India-calendar date; individual provider observation times can differ. */
  currentObservation?: { from: number; to: number }
}

interface PositionHistory {
  position: Position
  points: HistoryPoint[]
}

function dateAt(date: string): number {
  return new Date(`${date}T00:00:00+05:30`).getTime()
}

async function loadHistories(
  positions: Position[],
  from: Date,
  to: Date,
  source: Pick<MarketDataAdapter, 'history'>,
  signal?: AbortSignal,
): Promise<PositionHistory[]> {
  const results: PositionHistory[] = []
  let next = 0
  const worker = async () => {
    while (next < positions.length) {
      signal?.throwIfAborted()
      const position = positions[next]
      next += 1
      try {
        const rawPoints = await source.history(position, from, to, signal)
        signal?.throwIfAborted()
        const points = [...new Map(rawPoints.filter((point) => {
          const at = dateAt(point.date)
          const observedBy = at + (position.type === 'mutual-fund' ? 0 : EQUITY_CLOSE_OFFSET_MS)
          return /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(at)
            && new Date(at + IST_OFFSET_MS).toISOString().slice(0, 10) === point.date
            && observedBy <= to.getTime() && Number.isFinite(point.close) && point.close > 0
        }).map((point) => [point.date, point])).values()].sort((a, b) => a.date.localeCompare(b.date))
        if (points.length > 1) results.push({ position, points })
      } catch {
        signal?.throwIfAborted()
        // A single unsupported symbol should not discard the usable portfolio history.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(HISTORY_CONCURRENCY, positions.length) }, () => worker()))
  return results
}

/**
 * Reconstruct the current set of holdings across real historical closes.
 * This is an instant comparison tool, not a transaction-aware performance record.
 */
export async function buildPortfolioBackcast(
  positions: Position[],
  source: Pick<MarketDataAdapter, 'history'>,
  days = 366,
  signal?: AbortSignal,
): Promise<PortfolioBackcastHistory> {
  signal?.throwIfAborted()
  const eligible = positions
    .filter((position) => Number.isFinite(position.quantity) && position.quantity > 0 && hasSupportedValuationCurrency(position))
    .sort((a, b) => b.invested - a.invested)
    .slice(0, MAX_HOLDINGS)
  const empty = { points: [], coveredPositions: [], holdingsIncluded: 0, holdingsTotal: positions.length }
  if (eligible.length === 0) return empty

  const to = new Date()
  const from = new Date(to.getTime() - days * DAY_MS)
  const histories = await loadHistories(eligible, from, to, source, signal)
  if (histories.length === 0) return empty

  const closes = histories.map((history) => new Map(history.points.map((point) => [point.date, point.close])))
  // A combined observation exists only when every included holding has a close on that date.
  const dates = histories[0].points.map((point) => point.date).filter((date) => closes.every((series) => series.has(date)))
  if (dates.length === 0) return empty
  const invested = histories.reduce((sum, item) => sum + item.position.invested, 0)
  const rows: PortfolioBackcastPoint[] = []

  for (const date of dates) {
    let value = 0
    for (const [index, history] of histories.entries()) value += closes[index].get(date)! * history.position.quantity
    if (value > 0) rows.push({ at: dateAt(date), value, invested })
  }

  return {
    points: rows,
    coveredPositions: histories.map((item) => item.position),
    holdingsIncluded: histories.length,
    holdingsTotal: positions.length,
  }
}

/** Apply provider observations without changing or refetching the reusable historical series. */
export function applyPortfolioQuoteOverlay(
  history: PortfolioBackcastHistory,
  positions: Position[],
  quotes: Record<string, LiveQuote>,
): PortfolioBackcast {
  const coveredIds = new Set(history.coveredPositions.map((position) => position.id))
  const coveredValue = positions.filter((position) => coveredIds.has(position.id)).reduce((sum, position) => sum + positionValue(position, quotes), 0)
  const totalValue = positions.reduce((sum, position) => sum + positionValue(position, quotes), 0)
  const result = { ...history, coveragePct: totalValue > 0 ? Math.min(100, coveredValue / totalValue * 100) : 0 }
  const latest = history.points[history.points.length - 1]
  if (!latest || history.coveredPositions.length === 0) return result

  const now = Date.now()
  const observations = history.coveredPositions.map((position) => {
    const quote = position.identityIssue ? undefined : quotes[quoteKey(position)]
    const supportedSource = position.type === 'mutual-fund' ? quote?.source === 'nav' : quote?.source === 'yahoo' || quote?.source === 'nse-close'
    const latestCloseAt = latest.at + (position.type === 'mutual-fund' ? 0 : EQUITY_CLOSE_OFFSET_MS)
    return quote && supportedSource && Number.isFinite(quote.price) && quote.price > 0
      && Number.isFinite(quote.at) && quote.at >= latestCloseAt && quote.at <= now ? quote : null
  })
  const accepted = observations.filter((quote): quote is LiveQuote => quote != null)
  if (accepted.length !== history.coveredPositions.length) return result
  const observationDay = Math.floor((accepted[0].at + IST_OFFSET_MS) / DAY_MS)
  if (accepted.some((quote) => Math.floor((quote.at + IST_OFFSET_MS) / DAY_MS) !== observationDay)) return result
  const from = Math.min(...accepted.map((quote) => quote.at))
  const to = Math.max(...accepted.map((quote) => quote.at))
  const value = accepted.reduce((sum, quote, index) => sum + quote.price * history.coveredPositions[index].quantity, 0)
  const current = { at: to, value, invested: latest.invested, isCurrent: to > latest.at }
  return {
    ...result,
    points: [...(to === latest.at ? history.points.slice(0, -1) : history.points), current],
    currentObservation: { from, to },
  }
}
