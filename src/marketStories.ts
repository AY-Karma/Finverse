import { dateFormatter } from './formatters'
import { calculateHoldingMarketMoves, holdingMovePeriod, holdingMoveToday, type HoldingMarketMove, type HoldingPriceHistories } from './holdingMarketMoves'
import type { InvestmentSnapshot } from './investmentWorkspace'
import type { Position } from './types'
import { buildPeriodInsights } from './periodStoryInsights'
import { formatCurrency, formatPercent, quoteKey } from './valuation'
import type { WeeklyStoryContent } from './weeklyStories'

export type MarketStoryTone = 'neutral' | 'positive' | 'negative'

export type StoryInsight = {
  kind: 'bridge'
  gains: number
  losses: number
  net: number
  offset: number
  leader: string
  leaderChange: number
  covered: number
  total: number
} | {
  kind: 'driver'
  symbol: string
  name: string
  share: number
  change: number
  gains: number
  losses: number
  net: number
  covered: number
  total: number
} | {
  kind: 'session'
  date: string
  change: number
  changePct: number
  days: { date: string; changePct: number }[]
  leader: string
  leaderChange: number
  covered: number
  total: number
}

export interface MarketStoryRow {
  label: string
  value: string
  amount: number
  tone: MarketStoryTone
  detail?: string
}

export interface MarketStory {
  id: string
  kind: 'bridge' | 'driver' | 'session' | 'weekly-sectors' | 'weekly-events' | 'month' | 'sectors' | 'market' | 'updates' | 'winners' | 'laggards' | 'covered'
  eyebrow: string
  title: string
  metric: string
  metricLabel: string
  metricAmount?: number
  tone: MarketStoryTone
  rows: MarketStoryRow[]
  note: string
  actionLabel: string
  target: 'overview' | 'insights' | 'holdings'
  from?: string
  through?: string
  chart?: number[]
  marketChart?: { date: string; close: number }[]
  insight?: StoryInsight
  weekly?: WeeklyStoryContent
}

export interface MarketStoryBenchmark {
  label: string
  points: { date: string; close: number }[]
}

export interface MarketStoryRecap {
  from: string
  through: string
  label: string
}

function tone(value: number): MarketStoryTone {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
}

function signedCurrency(value: number): string {
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`
}

function observations(rows: HoldingMarketMove[]) {
  return {
    from: rows.reduce((date, row) => row.from < date ? row.from : date, rows[0].from),
    through: rows.reduce((date, row) => row.through > date ? row.through : date, rows[0].through),
  }
}

function benchmarkPeriodPoints(points: MarketStoryBenchmark['points'], from: string, through: string) {
  const available = [...new Map(points.filter((point) => point.date >= from && point.date <= through && Number.isFinite(point.close) && point.close >= 0)
    .map((point) => [point.date, point])).values()].sort((a, b) => a.date.localeCompare(b.date))
  return available.length >= 2 && available[0].date === from && available[available.length - 1].date === through ? available : undefined
}

export function buildMarketStories(snapshot: InvestmentSnapshot, histories: HoldingPriceHistories, today = holdingMoveToday(), benchmarks: MarketStoryBenchmark[] = [], recap?: MarketStoryRecap): MarketStory[] {
  if (!snapshot.positions.length && !recap) return []
  const period = recap ? holdingMovePeriod('custom', recap.from, recap.through) : holdingMovePeriod('month', '', today)
  if (recap && (!period || recap.through > today)) return []
  const stories: MarketStory[] = !recap && period ? buildPeriodInsights(snapshot, histories, { from: period.from, through: period.to, label: 'Month to date' }) : []

  if (period) {
    const month = dateFormatter({ month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(`${period.from}T00:00:00Z`))
    const weekly = recap?.label.toLowerCase().includes('week') ?? false
    const editionLabel = recap ? weekly ? 'Weekly recap' : `${month} recap` : month
    const periodKey = recap ? `${recap.from}:${recap.through}` : today.slice(0, 7)
    const benchmarkPositions: Position[] = benchmarks.map((benchmark, index) => ({
      id: `benchmark-${index}`, ticker: `BENCHMARK${index}`, name: benchmark.label, type: 'stock',
      quantity: 1, buyPrice: 0, invested: 0, lastPrice: null,
    }))
    const benchmarkHistories = Object.fromEntries(benchmarkPositions.map((position, index) => [quoteKey(position), benchmarks[index].points]))
    const benchmarkMoves = calculateHoldingMarketMoves(benchmarkPositions, {}, benchmarkHistories, period.from, period.to).rows
      .filter((row) => row.through >= period.from)
    if (benchmarkMoves.length) stories.push({
      id: `market:${periodKey}`, kind: 'market', eyebrow: `${editionLabel} · Indian markets`, title: recap ? weekly ? 'The market this week.' : `The market in ${month}.` : 'The market this month.',
      metric: formatPercent(benchmarkMoves[0].changePct), metricLabel: benchmarkMoves[0].label, tone: tone(benchmarkMoves[0].changePct),
      marketChart: benchmarkPeriodPoints(benchmarks.find((benchmark) => benchmark.label === benchmarkMoves[0].label)?.points ?? [], benchmarkMoves[0].from, benchmarkMoves[0].through),
      rows: benchmarkMoves.slice(1, 5).map((row) => ({ label: row.label, value: formatPercent(row.changePct), amount: row.changePct, tone: tone(row.changePct) })),
      note: `${benchmarkMoves.length} of ${benchmarks.length} indices covered. ${recap ? `${editionLabel} index` : 'Month-to-date index'} price changes at available closes.`,
      actionLabel: 'Open insights', target: 'insights', ...observations(benchmarkMoves),
    })
    const calculated = calculateHoldingMarketMoves(snapshot.positions, recap ? {} : snapshot.quotes, histories, period.from, period.to)
    const moves = { ...calculated, rows: calculated.rows.filter((row) => row.through >= period.from) }
    moves.coveredCount = moves.rows.length
    moves.totalChange = moves.rows.reduce((sum, row) => sum + row.change, 0)
    if (moves.rows.length) {
      const dates = observations(moves.rows)
      if (!stories.some((story) => story.kind === 'bridge' || story.kind === 'driver')) stories.push({
        id: `month:${periodKey}`, kind: 'month', eyebrow: recap ? editionLabel : `${month} so far`, title: 'What moved your holdings.',
        metric: signedCurrency(moves.totalChange), metricLabel: recap ? weekly ? 'Weekly market move' : `${month} market move` : 'Month-to-date market move', tone: tone(moves.totalChange),
        rows: moves.rows.filter((row) => row.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3)
          .map((row) => ({ label: row.label, value: signedCurrency(row.change), amount: row.change, tone: tone(row.change) })),
        note: `${moves.coveredCount} of ${moves.totalCount} holdings covered. Price changes at today's quantities, not your investment return.`,
        actionLabel: 'Explore movements', target: 'insights', ...dates,
      })

      const stocks = snapshot.positions.filter((position) => position.type === 'stock')
      const sectors = new Map<string, { opening: number; change: number }>()
      const sectorMoves: HoldingMarketMove[] = []
      let classifiedCount = 0
      for (const row of moves.rows) {
        const matches = stocks.filter((position) => quoteKey(position) === row.key)
        if (matches.some((position) => !position.sector?.trim())) continue
        const names = new Set(matches.map((position) => position.sector?.trim()).filter(Boolean))
        const sector = names.size === 1 ? [...names][0] : undefined
        if (!sector || /^(unclassified|unknown|other|equity|stock|stocks|n\/?a)$/i.test(sector)) continue
        const opening = row.quantity * row.openingPrice
        const group = sectors.get(sector) ?? { opening: 0, change: 0 }
        group.opening += opening
        group.change += row.change
        sectors.set(sector, group)
        sectorMoves.push(row)
        classifiedCount++
      }
      const sectorRows = [...sectors].filter(([, sector]) => sector.opening > 0 && sector.change !== 0)
        .map(([label, sector]) => ({ label, amount: sector.change / sector.opening * 100 }))
        .filter((row) => Number.isFinite(row.amount))
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 4).map((row) => ({ ...row, value: formatPercent(row.amount), tone: tone(row.amount) }))
      if (sectorRows.length) stories.push({
        id: `sectors:${periodKey}`, kind: 'sectors', eyebrow: `${editionLabel} · Sector moves`, title: 'Your stocks by sector.',
        metric: sectorRows[0].value, metricLabel: sectorRows[0].label, metricAmount: sectorRows[0].amount, tone: sectorRows[0].tone, rows: sectorRows.slice(1),
        note: `${classifiedCount} of ${new Set(stocks.map(quoteKey)).size} stocks covered. Opening-value weighted moves in your stocks, not sector indices.`,
        actionLabel: 'Explore sectors', target: 'insights', ...observations(sectorMoves),
      })
    }
  }

  return stories
}
