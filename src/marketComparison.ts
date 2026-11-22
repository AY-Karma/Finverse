export type ComparisonPeriod = '1m' | '3m' | '6m' | '1y' | 'all'

export const COMPARISON_PERIODS: { id: ComparisonPeriod; label: string; days: number | null }[] = [
  { id: '1m', label: '1M', days: 30 },
  { id: '3m', label: '3M', days: 91 },
  { id: '6m', label: '6M', days: 182 },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'all', label: 'All', days: null },
]

const DAY_MS = 24 * 60 * 60 * 1000

function cutoff(period: ComparisonPeriod, now: number): number | null {
  const days = COMPARISON_PERIODS.find((item) => item.id === period)?.days
  return days == null ? null : now - days * DAY_MS
}

/** The history points inside the chosen window; `all` keeps everything. */
export function historyForPeriod<T extends { at: number }>(history: T[], period: ComparisonPeriod, now: number): T[] {
  const start = cutoff(period, now)
  return start == null ? history : history.filter((point) => point.at >= start)
}

/** A window is offered only when the history reaches back to its start. */
export function periodAvailable(history: { at: number }[], period: ComparisonPeriod, now: number): boolean {
  const start = cutoff(period, now)
  return start == null || (history.length > 0 && history[0].at <= start && historyForPeriod(history, period, now).length >= 2)
}

const tenths = (value: number) => Math.round(value * 10) / 10

export interface ComparisonMovement { verb: 'rose' | 'fell' | 'was flat'; amount: string; tone: 'up' | 'down' | '' }

/** A return in words: "fell 8.0%" rather than a bare minus sign. */
export function describeMovement(value: number): ComparisonMovement {
  const rounded = tenths(value)
  if (rounded === 0) return { verb: 'was flat', amount: '0.0%', tone: '' }
  return { verb: rounded > 0 ? 'rose' : 'fell', amount: `${Math.abs(rounded).toFixed(1)}%`, tone: rounded > 0 ? 'up' : 'down' }
}

export interface ComparisonVerdict { text: string; points: string | null; tone: 'up' | 'down' | '' }

/** One plain sentence on how the holdings did against the benchmark over the same window. */
export function describeComparison(portfolio: number, benchmark: number, label: string): ComparisonVerdict {
  const [mine, theirs] = [tenths(portfolio), tenths(benchmark)]
  const gap = tenths(portfolio - benchmark)
  if (gap === 0) return { text: `In line with ${label}`, points: null, tone: '' }
  const points = `${Math.abs(gap).toFixed(1)} points`
  const tone = gap > 0 ? 'up' : 'down'
  const say = (text: string): ComparisonVerdict => ({ text, points, tone })
  if (mine > 0 && theirs < 0) return say(`You rose while ${label} fell`)
  if (mine < 0 && theirs > 0) return say(`You fell while ${label} rose`)
  if (mine === 0) return say(`You were flat while ${label} ${theirs > 0 ? 'rose' : 'fell'}`)
  if (mine > 0 || theirs > 0) return say(gap > 0 ? `You gained more than ${label}` : `${label} gained more than you`)
  return say(gap > 0 ? `You fell less than ${label}` : `You fell more than ${label}`)
}
