import { dateFormatter, numberFormatter } from './formatters'
import { calculateHoldingMarketMoves, holdingMovePeriod, holdingMoveToday, type HoldingMarketMove, type HoldingPriceHistories } from './holdingMarketMoves'
import { instrumentLabel } from './instruments'
import type { InvestmentSnapshot } from './investmentWorkspace'
import { getMarketCalendarInfo, isRegularMarketOpen } from './marketCalendar'
import type { MarketStory, MarketStoryRecap, StoryInsight } from './marketStories'
import { formatCurrency, quoteKey } from './valuation'

const DAY = 86_400_000
const tone = (value: number) => value > 0 ? 'positive' as const : value < 0 ? 'negative' as const : 'neutral' as const
const signedCurrency = (value: number) => `${value > 0 ? '+' : ''}${formatCurrency(value)}`

function priceMap(points: HoldingPriceHistories[string], through: string) {
  return new Map(points.filter((point) => {
    const at = Date.parse(`${point.date}T00:00:00Z`)
    return /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === point.date
      && point.date <= through && Number.isFinite(point.close) && point.close >= 0
  }).map((point) => [point.date, point.close]))
}

function story(insight: StoryInsight, title: string, period: MarketStoryRecap): MarketStory {
  return {
    id: `${insight.kind}:${period.from}:${period.through}`, kind: insight.kind, eyebrow: `${period.label} · Price insight`, title,
    metric: signedCurrency(insight.kind === 'bridge' ? insight.net : insight.change), metricLabel: 'Price moves on current quantities',
    tone: tone(insight.kind === 'bridge' ? insight.net : insight.change), rows: [], insight,
    note: `${insight.covered} of ${insight.total} holdings covered. Reprices today's quantities; excludes trades, cash flows and dividends.`,
    actionLabel: 'Explore price movements', target: 'insights', from: period.from, through: period.through,
  }
}

function sessionStory(snapshot: InvestmentSnapshot, period: MarketStoryRecap, moves: HoldingMarketMove[], maps: Map<string, number>[], total: number): MarketStory | undefined {
  if (moves.length !== total) return
  const now = getMarketCalendarInfo(new Date())
  if (period.through === holdingMoveToday() && (!now.lastSessionClose || holdingMoveToday(now.lastSessionClose.getTime()) < period.through)) return
  const keys = new Set(moves.map((row) => row.key))
  const holdings = snapshot.positions.filter((position) => keys.has(quoteKey(position)))
  if (holdings.some((position) => !['NSE', 'BSE'].includes(position.exchange ?? '') || !['stock', 'etf'].includes(position.type))) return
  const days: { date: string; change: number; changePct: number; leader: string; leaderChange: number }[] = []
  for (let at = Date.parse(`${period.from}T00:00:00Z`); at <= Date.parse(`${period.through}T00:00:00Z`); at += DAY) {
    const date = new Date(at).toISOString().slice(0, 10)
    if (!isRegularMarketOpen(new Date(`${date}T06:00:00Z`))) continue
    const calendar = getMarketCalendarInfo(new Date(`${date}T00:00:00+05:30`))
    if (!calendar.available || !calendar.lastSessionClose) return
    const previous = holdingMoveToday(calendar.lastSessionClose.getTime())
    // Missing sessions must not become one large daily move or a forward-filled price.
    if (!maps.every((prices) => prices.has(previous) && prices.has(date))) return
    const opening = moves.reduce((sum, row, index) => sum + row.quantity * maps[index].get(previous)!, 0)
    const changes = moves.map((row, index) => ({ label: row.label, change: row.quantity * (maps[index].get(date)! - maps[index].get(previous)!) }))
    const change = changes.reduce((sum, row) => sum + row.change, 0)
    if (!(opening > 0) || !Number.isFinite(opening) || !Number.isFinite(change)) return
    const leaders = changes.filter((row) => change < 0 ? row.change < 0 : row.change > 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    days.push({ date, change, changePct: change / opening * 100, leader: leaders[0]?.label ?? '', leaderChange: leaders[0]?.change ?? 0 })
  }
  const weekly = /week/i.test(period.label)
  if (days.length < (weekly ? 3 : 10)) return
  const selected = [...days].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0]
  const totalSwing = days.reduce((sum, day) => sum + Math.abs(day.change), 0)
  if (!totalSwing || !weekly && (Math.abs(selected.change) / totalSwing < .20 || Math.abs(selected.changePct) < .5)) return
  const weekday = dateFormatter({ weekday: 'long', timeZone: 'UTC' }).format(new Date(`${selected.date}T00:00:00Z`))
  const drag = weekly ? moves.reduce<HoldingMarketMove | null>((lowest, row) => row.change < 0 && (!lowest || row.change < lowest.change) ? row : lowest, null) : null
  return story({ kind: 'session', ...selected, days: days.map(({ date, changePct }) => ({ date, changePct })), ...(weekly ? { weeklyDrag: drag ? { label: drag.label, change: drag.change, changePct: drag.changePct } : null } : {}), covered: moves.length, total }, `${weekday} made the biggest move.`, period)
}

/** Select notable relationships and moments using a fixed cohort and matching dates. */
export function buildPeriodInsights(snapshot: InvestmentSnapshot, histories: HoldingPriceHistories, period: MarketStoryRecap): MarketStory[] {
  if (!snapshot.positions.length || !holdingMovePeriod('custom', period.from, period.through)) return []
  const weekly = /week/i.test(period.label)
  const positions = weekly ? snapshot.positions.filter((position) => position.type === 'stock' || position.type === 'etf') : snapshot.positions
  const result = calculateHoldingMarketMoves(positions, {}, histories, period.from, period.through)
  const available = result.rows.filter((row) => row.through >= period.from)
  if (!available.length) return []
  const maps = available.map((row) => priceMap(histories[row.key] ?? [], period.through))
  const dates = [...maps[0].keys()].filter((date) => maps.every((prices) => prices.has(date))).sort()
  const earliest = new Date(Date.parse(`${period.from}T00:00:00Z`) - 8 * DAY).toISOString().slice(0, 10)
  const opening = dates.filter((date) => date < period.from && date >= earliest && maps.every((prices) => prices.get(date)! > 0)).slice(-1)[0]
  const closing = dates.filter((date) => date >= period.from).slice(-1)[0]
  if (!opening || !closing || Date.parse(`${period.through}T00:00:00Z`) - Date.parse(`${closing}T00:00:00Z`) > 7 * DAY) return []
  // The feed has no corporate-action metadata. Omit ambiguous discontinuities.
  if (maps.some((prices) => {
    const ordered = [...prices].filter(([date]) => date >= opening && date <= closing).sort(([a], [b]) => a.localeCompare(b))
    return ordered.some(([date, close], index) => index > 0 && Date.parse(date) - Date.parse(ordered[index - 1][0]) <= 4 * DAY
      && ordered[index - 1][1] > 0 && Math.abs(close / ordered[index - 1][1] - 1) > .25)
  })) return []
  const moves = available.map((row, index) => {
    const openingPrice = maps[index].get(opening)!
    const closingPrice = maps[index].get(closing)!
    return { ...row, from: opening, through: closing, openingPrice, closingPrice, value: row.quantity * closingPrice, change: row.quantity * (closingPrice - openingPrice), changePct: (closingPrice / openingPrice - 1) * 100 }
  })
  const openingValue = moves.reduce((sum, row) => sum + row.quantity * row.openingPrice, 0)
  const gains = moves.reduce((sum, row) => sum + Math.max(0, row.change), 0)
  const losses = moves.reduce((sum, row) => sum + Math.min(0, row.change), 0)
  const net = gains + losses
  if (!(openingValue > 0) || ![openingValue, gains, losses, net].every(Number.isFinite)) return []
  const gross = gains - losses
  const nonFlat = moves.filter((row) => row.change !== 0)
  if (weekly) {
    const session = sessionStory(snapshot, period, moves, maps, result.totalCount)
    return session ? [session] : []
  }
  const candidates: MarketStory[] = []
  if (gross / openingValue >= .005 && nonFlat.length >= 3 && gains > 0 && losses < 0 && Math.min(gains, -losses) / Math.max(gains, -losses) >= .2) {
    const drag = [...moves].sort((a, b) => a.change - b.change)[0]
    const offset = -losses / gains * 100
    const title = net >= 0 ? `Losses absorbed ${numberFormatter({ maximumFractionDigits: 0 }).format(offset)}% of the lift.` : 'Losses outweighed the lift.'
    candidates.push(story({ kind: 'bridge', gains, losses, net, offset, leader: drag.label, leaderChange: drag.change, covered: moves.length, total: result.totalCount }, title, period))
  } else if (gross / openingValue >= .005 && nonFlat.length >= 4) {
    const side = moves.filter((row) => gains >= -losses ? row.change > 0 : row.change < 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    const leader = side[0]
    const denominator = gains >= -losses ? gains : -losses
    if (leader && Math.abs(leader.change) / denominator >= .5) {
      const position = snapshot.positions.find((position) => quoteKey(position) === leader.key)!
      const symbol = instrumentLabel(position)
      const subject = symbol.length > 24 ? 'One holding' : symbol
      candidates.push(story({ kind: 'driver', symbol, name: leader.label, share: Math.abs(leader.change) / denominator * 100, change: leader.change, gains, losses, net, covered: moves.length, total: result.totalCount }, `${subject} drove the ${leader.change > 0 ? 'price lift' : 'price drag'}.`, period))
    }
  }
  const session = period.label === 'Monthly' ? undefined : sessionStory(snapshot, period, moves, maps, result.totalCount)
  if (session) candidates.push(session)
  return candidates
}
