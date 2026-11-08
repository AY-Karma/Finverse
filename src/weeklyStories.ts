import { calculateHoldingMarketMoves, holdingMovePeriod, holdingMoveToday, uniqueMarketHoldings, type HoldingPriceHistories } from './holdingMarketMoves'
import type { InvestmentSnapshot } from './investmentWorkspace'
import type { MarketEvent } from './marketEvents'
import { isEventDate, isOfficialEventUrl } from './marketEventsProtocol'
import type { MarketStory } from './marketStories'
import { holdingIdentity } from './monitor'
import type { StoryEdition } from './recapSchedule'
import { formatCurrency, quoteKey } from './valuation'

export type WeeklyStoryContent = {
  kind: 'sectors'
  sectors: { label: string; change: number; changePct: number }[]
  net: number
  covered: number
  total: number
  from: string
  through: string
} | {
  kind: 'events'
  events: MarketEvent[]
  from: string
  through: string
}

const DAY = 86_400_000
const tone = (value: number) => value > 0 ? 'positive' as const : value < 0 ? 'negative' as const : 'neutral' as const
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)

function sectorStory(snapshot: InvestmentSnapshot, histories: HoldingPriceHistories, edition: StoryEdition): MarketStory | undefined {
  const stocks = snapshot.positions.filter((position) => position.type === 'stock')
  const result = calculateHoldingMarketMoves(stocks, {}, histories, edition.from, edition.through)
  const rows = result.rows.filter((row) => row.through >= edition.from).flatMap((row) => {
    const matches = stocks.filter((position) => quoteKey(position) === row.key)
    const sectors = new Set(matches.map((position) => position.sector?.trim()))
    const sector = sectors.size === 1 ? [...sectors][0] : undefined
    if (!sector || /^(unclassified|unknown|other|equity|stocks?|n\/?a)$/i.test(sector)) return []
    const prices = new Map((histories[row.key] ?? []).filter((point) => isEventDate(point.date) && point.date <= edition.through && Number.isFinite(point.close) && point.close >= 0).map((point) => [point.date, point.close]))
    return [{ ...row, sector, prices }]
  })
  if (!rows.length) return
  const dates = [...rows[0].prices.keys()].filter((date) => rows.every((row) => row.prices.has(date))).sort()
  const opening = dates.filter((date) => date < edition.from && date >= shift(edition.from, -8) && rows.every((row) => row.prices.get(date)! > 0)).slice(-1)[0]
  const closing = dates.filter((date) => date >= edition.from).slice(-1)[0]
  if (!opening || !closing || closing < shift(edition.through, -7)) return
  const sectors = new Map<string, { opening: number; change: number }>()
  for (const row of rows) {
    const ordered = [...row.prices].filter(([date]) => date >= opening && date <= closing).sort(([a], [b]) => a.localeCompare(b))
    if (ordered.some(([date, price], index) => index > 0 && Date.parse(date) - Date.parse(ordered[index - 1][0]) <= 4 * DAY && ordered[index - 1][1] > 0 && Math.abs(price / ordered[index - 1][1] - 1) > .25)) return
    const current = sectors.get(row.sector) ?? { opening: 0, change: 0 }
    current.opening += row.quantity * row.prices.get(opening)!
    current.change += row.quantity * (row.prices.get(closing)! - row.prices.get(opening)!)
    sectors.set(row.sector, current)
  }
  const contributions = [...sectors].filter(([, values]) => values.opening > 0 && values.change !== 0)
    .map(([label, values]) => ({ label, change: values.change, changePct: values.change / values.opening * 100 }))
    .filter((row) => Number.isFinite(row.change) && Number.isFinite(row.changePct))
  if (contributions.length < 2) return
  const net = contributions.reduce((sum, row) => sum + row.change, 0)
  if (!Number.isFinite(net)) return
  const leader = [...contributions].sort((a, b) => net < 0 ? a.change - b.change : b.change - a.change)[0]
  const ranked = [leader, ...contributions.filter((row) => row !== leader).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))].slice(0, 3)
  return {
    id: `weekly-sectors:${edition.key}`, kind: 'weekly-sectors', eyebrow: 'Weekly sector drivers',
    title: `${leader.label} ${net < 0 ? 'weighed on the week.' : 'led the week.'}`,
    metric: `${net > 0 ? '+' : ''}${formatCurrency(net)}`, metricLabel: 'Net price move in classified stocks', tone: tone(net), rows: [],
    weekly: { kind: 'sectors', sectors: ranked, net, covered: rows.length, total: uniqueMarketHoldings(stocks).length, from: opening, through: closing },
    note: `Current stock quantities at matching ${opening} and ${closing} closes. These are contributions from your stocks, not sector indices.`,
    actionLabel: 'Explore sector movements', target: 'insights', from: opening, through: closing,
  }
}

function upcomingStory(snapshot: InvestmentSnapshot, edition: StoryEdition, events: MarketEvent[], now: number): MarketStory | undefined {
  const weekday = new Date(`${edition.through}T00:00:00Z`).getUTCDay()
  const from = shift(edition.through, (8 - weekday) % 7 || 7)
  const through = shift(from, 4)
  const today = holdingMoveToday(now)
  const identities = new Set(snapshot.positions.map(holdingIdentity))
  const seen = new Set<string>()
  const selected = events.filter((event) => {
    const expectedLabel = event.kind === 'results' || event.kind === 'meeting' ? 'Meeting date' : 'Ex-date'
    if (event.kind === 'filing' || event.source !== 'NSE' || !isEventDate(event.date) || !isOfficialEventUrl(event.sourceUrl)
      || event.dateLabel !== expectedLabel || event.date < today || event.date < from || event.date > through || !identities.has(event.instrumentIdentity)) return false
    const key = `${event.symbol}:${event.kind}:${event.date}:${event.title.trim().toLowerCase().replace(/\s+/g, ' ')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol)).slice(0, 3)
  if (!selected.length) return
  return {
    id: `weekly-events:${edition.key}`, kind: 'weekly-events', eyebrow: 'Confirmed company events', title: 'Next week, on your radar.',
    metric: String(selected.length), metricLabel: 'Confirmed dates for your holdings', tone: 'neutral', rows: [],
    weekly: { kind: 'events', events: selected, from, through },
    note: 'Announced NSE meetings and ex-dates for current holdings. Ex-dates are not dividend payment dates. No forecasts or estimated dates.',
    actionLabel: 'Open Monitor', target: 'holdings', from, through,
  }
}

export function buildWeeklyStories(snapshot: InvestmentSnapshot, histories: HoldingPriceHistories, edition: StoryEdition, events: MarketEvent[] = [], now = Date.now()): MarketStory[] {
  if (edition.id !== 'weekly' || !holdingMovePeriod('custom', edition.from, edition.through)) return []
  return [sectorStory(snapshot, histories, edition), upcomingStory(snapshot, edition, events, now)].filter((story): story is MarketStory => story !== undefined)
}
