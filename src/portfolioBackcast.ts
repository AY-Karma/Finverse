import type { HistoryPoint } from './live'
import type { MarketDataAdapter } from './marketData'
import type { LiveQuote, Position } from './types'
import { downsampleSeries } from './timeSeries'
import { positionValue } from './valuation'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_HOLDINGS = 40
const HISTORY_CONCURRENCY = 4
const MAX_POINTS = 260

export interface PortfolioBackcastPoint {
  at: number
  value: number
  invested: number
}

export interface PortfolioBackcast {
  points: PortfolioBackcastPoint[]
  coveragePct: number
  holdingsIncluded: number
  holdingsTotal: number
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
): Promise<PositionHistory[]> {
  const results: PositionHistory[] = []
  let next = 0
  const worker = async () => {
    while (next < positions.length) {
      const position = positions[next]
      next += 1
      try {
        const points = await source.history(position, from, to)
        if (points.length > 1) results.push({ position, points })
      } catch {
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
  quotes: Record<string, LiveQuote>,
  source: Pick<MarketDataAdapter, 'history'>,
  days = 366,
): Promise<PortfolioBackcast> {
  const eligible = positions
    .filter((position) => position.quantity > 0)
    .sort((a, b) => positionValue(b, quotes) - positionValue(a, quotes))
    .slice(0, MAX_HOLDINGS)
  if (eligible.length === 0) return { points: [], coveragePct: 0, holdingsIncluded: 0, holdingsTotal: positions.length }

  const to = new Date()
  const from = new Date(to.getTime() - days * DAY_MS)
  const histories = await loadHistories(eligible, from, to, source)
  if (histories.length === 0) return { points: [], coveragePct: 0, holdingsIncluded: 0, holdingsTotal: positions.length }

  const commonStart = histories.reduce((latest, item) => Math.max(latest, dateAt(item.points[0].date)), 0)
  const dates = Array.from(new Set(histories.flatMap((item) => item.points.map((point) => point.date))))
    .filter((date) => dateAt(date) >= commonStart)
    .sort()
  const cursors = histories.map(() => 0)
  const lastCloses = histories.map(() => 0)
  const invested = histories.reduce((sum, item) => sum + item.position.invested, 0)
  const rows: PortfolioBackcastPoint[] = []

  for (const date of dates) {
    let value = 0
    for (let index = 0; index < histories.length; index += 1) {
      const history = histories[index]
      while (cursors[index] < history.points.length && history.points[cursors[index]].date <= date) {
        lastCloses[index] = history.points[cursors[index]].close
        cursors[index] += 1
      }
      value += lastCloses[index] * history.position.quantity
    }
    if (value > 0) rows.push({ at: dateAt(date), value, invested })
  }

  const currentCoveredValue = histories.reduce((sum, item) => sum + positionValue(item.position, quotes), 0)
  const totalCurrentValue = positions.reduce((sum, position) => sum + positionValue(position, quotes), 0)
  const latestValue = currentCoveredValue > 0 ? currentCoveredValue : rows[rows.length - 1]?.value
  if (latestValue > 0) rows.push({ at: Date.now(), value: latestValue, invested })

  return {
    points: downsampleSeries(rows, MAX_POINTS),
    coveragePct: totalCurrentValue > 0 ? Math.min(100, currentCoveredValue / totalCurrentValue * 100) : 0,
    holdingsIncluded: histories.length,
    holdingsTotal: positions.length,
  }
}
