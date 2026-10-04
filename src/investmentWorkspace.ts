import type { Folio, FxRate, LiveQuote, PortfolioSnapshot, Position } from './types'
import { assetTypeLabel, instrumentLabel, normalizePosition } from './instruments'
import { combinePositions, computePortfolioStats, effectivePrice, positionPnl, positionValue, quoteKey } from './valuation'

interface Contribution {
  symbol: string
  type: Position['type']
  value: number
  priced: boolean
  weight: number
  pnl: number | null
  dailyChange: number | null
  dailyContribution: number | null
  dailyPriceChange: number | null
  dailyPriceChangePct: number | null
  sector: string
}

export interface SectorAllocation {
  label: string
  value: number
  weight: number
  count: number
  type: Position['type'] | 'mixed'
}

export interface InvestmentSnapshot {
  folios: Folio[]
  rawPositions: Position[]
  positions: Position[]
  quotes: Record<string, LiveQuote>
  fxRate: FxRate | null
  invested: number
  pricedInvested: number
  pricedCount: number
  unpricedCount: number
  valuationComplete: boolean
  currentValue: number
  pnl: number
  pnlPct: number
  dailyChange: number | null
  dailyChangePct: number | null
  /** Provider date in IST. Aggregate movement requires every holding on this date. */
  dailyChangeDate: string | null
  dailyChangeCount: number
  contributions: Contribution[]
  sectors: SectorAllocation[]
  topFiveWeight: number
  staleQuotes: number
  quotedCount: number
  lastUpdatedAt: number | null
  history: PortfolioSnapshot[]
}

interface WorkspaceInput {
  folios: Folio[]
  quotes: Record<string, LiveQuote>
  fxRate: FxRate | null
  history?: PortfolioSnapshot[]
}

interface InvestmentWorkspace {
  /** One read seam for all dashboard projections and visual tools. */
  readSnapshot(input: WorkspaceInput): InvestmentSnapshot
  /** Normalize imported positions at the storage seam. */
  normalizeImport(positions: Position[]): Position[]
}

// Scheme categories like "Equity - Large Cap Fund" are asset-class words, not
// sectors; letting them through is how mutual funds ended up bucketed as Equity.
const ASSET_CLASS_LABEL = /^(equity|debt|hybrid|commodity|bond|cash|gold|silver|index|fof|arbitrage|liquid)\b/i

function sectorOf(position: Position): string {
  const detail = [position.sector, position.category]
    .map((value) => value?.trim() ?? '')
    .find((value) => value && !ASSET_CLASS_LABEL.test(value))
  if (detail) return detail
  // Legacy imports typed real equities as "other"; label them by what they trade as.
  if (position.type === 'other' && (position.exchange || position.providerSymbol)) return 'Equity'
  return assetTypeLabel(position.type)
}

function quoteChange(position: Position, quotes: Record<string, LiveQuote>): number | null {
  const quote = quotes[quoteKey(position)]
  if (quote?.change != null && Number.isFinite(quote.change)) {
    const change = quote.change * position.quantity
    return Number.isFinite(change) ? change : null
  }
  return null
}

const IST_OFFSET_MS = 330 * 60_000

function quoteDate(at: number): string {
  return new Date(at + IST_OFFSET_MS).toISOString().slice(0, 10)
}

function validQuote(quote: LiveQuote | undefined): quote is LiveQuote {
  return !!quote && Number.isFinite(quote.price) && quote.price >= 0 && Number.isFinite(quote.at) && quote.at > 0
    && Number.isFinite(new Date(quote.at + IST_OFFSET_MS).getTime())
}

function quoteIsStale(quote: LiveQuote): boolean {
  return Date.now() - quote.at > 24 * 60 * 60 * 1000
}

function buildContributions(positions: Position[], quotes: Record<string, LiveQuote>, currentValue: number, sessionDate: string | null): Contribution[] {
  return positions
    .map((position) => {
      const value = positionValue(position, quotes)
      const quote = quotes[quoteKey(position)]
      const inSession = quote != null && quoteDate(quote.at) === sessionDate
      const dailyChange = inSession ? quoteChange(position, quotes) : null
      return {
        symbol: instrumentLabel(position),
        type: position.type,
        value,
        priced: effectivePrice(position, quotes) != null,
        weight: currentValue > 0 ? (value / currentValue) * 100 : 0,
        pnl: positionPnl(position, quotes),
        dailyChange,
        dailyContribution: dailyChange,
        dailyPriceChange: inSession && Number.isFinite(quote.change) ? quote.change! : null,
        dailyPriceChangePct: inSession && Number.isFinite(quote.changePct) ? quote.changePct! : null,
        sector: sectorOf(position),
      }
    })
    .sort((a, b) => (b.dailyContribution ?? -Infinity) - (a.dailyContribution ?? -Infinity))
}

function buildSectors(contributions: Contribution[], currentValue: number): SectorAllocation[] {
  const groups = new Map<string, { value: number; types: Set<Position['type']>; count: number }>()
  for (const item of contributions) {
    if (!item.priced) continue
    const group = groups.get(item.sector) ?? { value: 0, types: new Set<Position['type']>(), count: 0 }
    group.value += item.value
    group.types.add(item.type)
    group.count += 1
    groups.set(item.sector, group)
  }
  return Array.from(groups, ([label, group]): SectorAllocation => ({
    label,
    value: group.value,
    weight: currentValue > 0 ? (group.value / currentValue) * 100 : 0,
    count: group.count,
    type: group.types.size === 1 ? [...group.types][0] : 'mixed',
  })).sort((a, b) => b.value - a.value)
}

function lastUpdated(quotes: Record<string, LiveQuote>): number | null {
  const times = Object.values(quotes).map((quote) => quote.at).filter(Number.isFinite)
  return times.length ? Math.max(...times) : null
}

export const investmentWorkspace: InvestmentWorkspace = {
  normalizeImport(positions) {
    return positions.map(normalizePosition)
  },

  readSnapshot(input) {
    // Folios are normalized when they enter storage; quote refreshes can now
    // reuse the same position objects without rebuilding their identity.
    const rawPositions = input.folios.flatMap((folio) => folio.positions)
    const positions = combinePositions(rawPositions)
    const quotes = Object.fromEntries(positions.flatMap((position) => {
      const key = quoteKey(position)
      const quote = input.quotes[key]
      return validQuote(quote) ? [[key, quote]] : []
    }))
    const quoteValues = positions.flatMap((position) => quotes[quoteKey(position)] ?? [])
    const changeTimes = quoteValues.filter((quote) => Number.isFinite(quote.change) || Number.isFinite(quote.changePct)).map((quote) => quote.at)
    const dailyChangeDate = changeTimes.length ? quoteDate(Math.max(...changeTimes)) : null
    const stats = computePortfolioStats(positions, quotes)
    const contributions = buildContributions(positions, quotes, stats.currentValue, dailyChangeDate)
    const dailyChangeValues = contributions.map((item) => item.dailyChange).filter((value): value is number => value != null)
    const dailyChangeCount = dailyChangeValues.length
    const dailyChange = positions.length > 0 && dailyChangeCount === positions.length
      ? dailyChangeValues.reduce((sum, value) => sum + value, 0) : null
    const previousValue = dailyChange == null ? null : stats.currentValue - dailyChange
    return {
      folios: input.folios,
      rawPositions,
      positions,
      quotes,
      fxRate: input.fxRate,
      invested: stats.invested,
      pricedInvested: stats.pricedInvested,
      pricedCount: stats.pricedCount,
      unpricedCount: stats.unpricedCount,
      valuationComplete: stats.valuationComplete,
      currentValue: stats.currentValue,
      pnl: stats.pnl,
      pnlPct: stats.pnlPct,
      dailyChange,
      dailyChangePct: dailyChange != null && previousValue != null && previousValue > 0 ? (dailyChange / previousValue) * 100 : null,
      dailyChangeDate,
      dailyChangeCount,
      contributions,
      sectors: buildSectors(contributions, stats.currentValue),
      topFiveWeight: [...contributions].sort((a, b) => b.value - a.value).slice(0, 5).reduce((sum, item) => sum + item.weight, 0),
      staleQuotes: quoteValues.filter(quoteIsStale).length,
      quotedCount: quoteValues.length,
      lastUpdatedAt: lastUpdated(quotes),
      history: input.history ?? [],
    }
  },
}

/** Used by import preview and export without coupling those views to storage. */
export function importIdentitySummary(positions: Position[]): { normalized: Position[]; duplicateCount: number; unmatchedCount: number } {
  const normalized = investmentWorkspace.normalizeImport(positions)
  return {
    normalized,
    duplicateCount: normalized.length - combinePositions(normalized).length,
    unmatchedCount: normalized.filter((position) => position.type === 'other').length,
  }
}

export function exportPortfolioCsv(positions: Position[]): string {
  const headers = ['Symbol', 'Name', 'Type', 'Exchange', 'ISIN', 'Quantity', 'Average cost', 'Last price', 'Invested', 'Sector']
  const cells = (position: Position): (string | number)[] => [
    instrumentLabel(position), position.name, assetTypeLabel(position.type), position.exchange ?? '', position.isin ?? '',
    position.quantity, position.buyPrice, position.lastPrice ?? '', position.invested, position.sector ?? position.category ?? '',
  ]
  const escape = (value: string | number) => {
    const text = String(value)
    const safe = typeof value === 'string' && /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text
    return `"${safe.replace(/"/g, '""')}"`
  }
  return [headers, ...positions.map(cells)].map((row) => row.map(escape).join(',')).join('\n')
}
