import { dateFormatter, numberFormatter } from './formatters'
import { calculateHoldingMarketMoves, holdingMovePeriod, holdingMoveToday, type HoldingMarketMove, type HoldingPriceHistories } from './holdingMarketMoves'
import type { InvestmentSnapshot } from './investmentWorkspace'
import type { MarketStory, MarketStoryRow } from './marketStories'
import { buildPeriodInsights } from './periodStoryInsights'
import type { StoryEdition } from './recapSchedule'
import { compareStatements } from './statementChanges'
import { formatPercent } from './valuation'
import type { MarketEvent } from './marketEvents'
import { buildWeeklyStories } from './weeklyStories'

const tone = (value: number) => value > 0 ? 'positive' as const : value < 0 ? 'negative' as const : 'neutral' as const

function folioUpdates(snapshot: InvestmentSnapshot, edition: StoryEdition): MarketStory | undefined {
  if (edition.id !== 'monthly') return
  const rows: MarketStoryRow[] = []
  for (const folio of snapshot.folios) {
    const at = folio.operationAt ?? folio.importedAt
    const date = folio.statement?.statementDate ?? (Number.isFinite(at) ? holdingMoveToday(at) : '')
    if (!date || date < edition.from || date > edition.through) continue
    if (!folio.previousRevision) {
      if (folio.lastOperation === 'added') rows.push({ label: folio.name, value: 'Folio added', amount: 1, tone: 'positive' })
      continue
    }
    const changes = compareStatements(folio.previousRevision.positions, folio.positions).changes
      .filter((change) => change.kind !== 'valuation' || change.before?.invested !== change.after?.invested)
    for (const change of changes) {
      const before = change.before?.quantity ?? 0
      const after = change.after?.quantity ?? 0
      rows.push({
        label: change.after?.label ?? change.before!.label,
        value: change.kind === 'added' ? 'Added' : change.kind === 'removed' ? 'Removed' : change.kind === 'quantity' ? 'Quantity updated' : 'Cost updated',
        detail: change.kind === 'valuation' ? undefined : `${numberFormatter({ maximumFractionDigits: 6 }).format(before)} → ${numberFormatter({ maximumFractionDigits: 6 }).format(after)} units`,
        amount: Math.abs(after - before), tone: change.kind === 'added' ? 'positive' : change.kind === 'removed' ? 'negative' : 'neutral',
      })
    }
  }
  if (!rows.length) return
  return {
    id: `updates:${edition.key}`, kind: 'updates', eyebrow: 'Monthly · Saved statement changes', title: 'Your folio, refreshed.',
    metric: String(rows.length), metricLabel: `Recorded update${rows.length === 1 ? '' : 's'}`, tone: 'neutral', rows: rows.slice(0, 3),
    note: 'Changes between saved statements, not a record of trades.', actionLabel: 'View portfolio', target: 'overview',
  }
}

function performanceStory(kind: 'winners' | 'laggards', moves: HoldingMarketMove[], histories: HoldingPriceHistories, edition: StoryEdition): MarketStory {
  const positive = kind === 'winners'
  const ranked = moves.filter((row) => positive ? row.changePct > 0 : row.changePct < 0)
    .sort((a, b) => positive ? b.changePct - a.changePct : a.changePct - b.changePct)
  const leader = ranked[0]
  const points = leader ? (histories[leader.key] ?? []).filter((point) => point.date >= leader.from && point.date <= leader.through && Number.isFinite(point.close) && point.close >= 0)
    .sort((a, b) => a.date.localeCompare(b.date)).map((point) => point.close) : []
  return {
    id: `${kind}:${edition.key}`, kind, eyebrow: `${edition.label} · Holding price moves`, title: positive ? 'Your top performers.' : 'Your worst performers.',
    metric: leader ? formatPercent(leader.changePct) : '',
    metricLabel: leader?.label ?? (moves.length ? positive ? 'No positive price moves this period.' : 'No negative price moves this period.' : 'Period prices are unavailable.'),
    tone: leader ? positive ? 'positive' : 'negative' : 'neutral',
    rows: ranked.slice(1, 3).map((row) => ({ label: row.label, value: formatPercent(row.changePct), amount: row.changePct, tone: tone(row.changePct) })),
    chart: points, note: 'Ranked by price change over the recap period, not total investment return.', actionLabel: 'Explore holdings', target: 'insights',
    from: edition.from, through: edition.through,
  }
}

export function recapClosingStory(edition: StoryEdition): MarketStory {
  const from = new Date(`${edition.from}T00:00:00Z`)
  const through = new Date(`${edition.through}T00:00:00Z`)
  const end = dateFormatter({ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(through)
  const start = dateFormatter({
    day: 'numeric', timeZone: 'UTC',
    month: edition.from.slice(0, 7) !== edition.through.slice(0, 7) ? 'short' : undefined,
    year: edition.from.slice(0, 4) !== edition.through.slice(0, 4) ? 'numeric' : undefined,
  }).format(from)
  const range = edition.from === edition.through ? end : `${start}–${end}`
  return {
    id: `covered:${edition.key}`, kind: 'covered', eyebrow: `${edition.label} recap`, title: "You're covered.",
    metric: edition.id === 'monthly' ? dateFormatter({ month: 'long', timeZone: 'UTC' }).format(from) : range,
    metricLabel: edition.id === 'monthly' ? '' : 'Your week, wrapped up.', tone: 'neutral', rows: [],
    note: '', actionLabel: '', target: 'overview', from: edition.from, through: edition.through,
  }
}

/** Completed-period insights use historical prices and recorded statement changes. */
export function buildRecapStories(snapshot: InvestmentSnapshot, histories: HoldingPriceHistories, edition: StoryEdition, today: string, hideValues = false, events: MarketEvent[] = []): MarketStory[] {
  if (!holdingMovePeriod('custom', edition.from, edition.through) || edition.through > today) return []
  const closing = recapClosingStory(edition)
  if (hideValues) return [closing]
  if (!snapshot.positions.length) {
    const updates = folioUpdates(snapshot, edition)
    return updates ? [updates, closing] : [closing]
  }
  const insights = buildPeriodInsights(snapshot, histories, edition)
  if (edition.id === 'weekly') return [...insights.slice(0, 1), ...buildWeeklyStories(snapshot, histories, edition, events), closing]
  const calculated = calculateHoldingMarketMoves(snapshot.positions, {}, histories, edition.from, edition.through)
  const moves = calculated.rows.filter((row) => row.through >= edition.from)
  const updates = folioUpdates(snapshot, edition)
  return [...insights.slice(0, updates ? 1 : 2), ...(updates ? [updates] : []), performanceStory('winners', moves, histories, edition), performanceStory('laggards', moves, histories, edition), closing]
}
