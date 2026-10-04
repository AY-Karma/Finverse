import { isRegularMarketOpen } from './marketCalendar'

const DAY_MS = 24 * 60 * 60 * 1000
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

interface RiskPoint {
  at: number
  value: number
  isCurrent?: boolean
}

function consecutiveCloses(previous: RiskPoint, point: RiskPoint): boolean {
  if (previous.isCurrent || point.isCurrent) return false
  const previousDay = Math.floor((previous.at + IST_OFFSET_MS) / DAY_MS)
  const day = Math.floor((point.at + IST_OFFSET_MS) / DAY_MS)
  if (day <= previousDay) return false
  for (let missing = previousDay + 1; missing < day; missing += 1) {
    if (isRegularMarketOpen(new Date(missing * DAY_MS + 12 * 3600000 - IST_OFFSET_MS))) return false
  }
  return true
}

/** Drawdown uses every observation; volatility uses consecutive daily closes only. */
export function calculatePortfolioRisk(points: readonly RiskPoint[]) {
  let peak = 0
  let peakAt: number | null = null
  let worst = 0
  let worstAt: number | null = null
  let worstPeakAt: number | null = null
  const returns: number[] = []
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1]
    if (previous?.value > 0 && consecutiveCloses(previous, point)) returns.push((point.value - previous.value) / previous.value)
    if (point.value >= peak) {
      peak = point.value
      peakAt = point.at
    }
    const drawdown = peak > 0 ? ((point.value - peak) / peak) * 100 : 0
    if (drawdown < worst) {
      worst = drawdown
      worstAt = point.at
      worstPeakAt = peakAt
    }
  }
  const average = returns.length ? returns.reduce((sum, item) => sum + item, 0) / returns.length : 0
  const variance = returns.length > 1 ? returns.reduce((sum, item) => sum + (item - average) ** 2, 0) / (returns.length - 1) : null
  const currentValue = points[points.length - 1]?.value ?? peak
  return {
    worst,
    current: peak > 0 ? ((currentValue - peak) / peak) * 100 : 0,
    volatility: variance == null ? null : Math.sqrt(variance) * Math.sqrt(252) * 100,
    worstAt,
    worstPeakAt,
  }
}
