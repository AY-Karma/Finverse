import type { Folio, FxRate, LiveQuote, PortfolioSnapshot, Position } from './types'
import { assetTypeLabel, instrumentKey, instrumentLabel, normalizePosition } from './instruments'
import { combinePositions, computePortfolioStats, positionPnl, positionValue, quoteKey } from './valuation'

interface Contribution {
  symbol: string
  type: Position['type']
  value: number
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
  currentValue: number
  pnl: number
  pnlPct: number
  dailyChange: number | null
  dailyChangePct: number | null
  contributions: Contribution[]
  sectors: SectorAllocation[]
  topFiveWeight: number
  staleQuotes: number
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
  if (quote?.change != null && Number.isFinite(quote.change)) return quote.change * position.quantity
  return null
}

function quoteIsStale(quote: LiveQuote): boolean {
  return Date.now() - quote.at > 24 * 60 * 60 * 1000
}

function buildContributions(positions: Position[], quotes: Record<string, LiveQuote>, currentValue: number): Contribution[] {
  return positions
    .map((position) => {
      const value = positionValue(position, quotes)
      const dailyChange = quoteChange(position, quotes)
      const quote = quotes[quoteKey(position)]
      return {
        symbol: instrumentLabel(position),
        type: position.type,
        value,
        weight: currentValue > 0 ? (value / currentValue) * 100 : 0,
        pnl: positionPnl(position, quotes),
        dailyChange,
        dailyContribution: dailyChange,
        dailyPriceChange: quote?.change ?? null,
        dailyPriceChangePct: quote?.changePct ?? null,
        sector: sectorOf(position),
      }
    })
    .sort((a, b) => (b.dailyContribution ?? -Infinity) - (a.dailyContribution ?? -Infinity))
}

function buildSectors(contributions: Contribution[], currentValue: number): SectorAllocation[] {
  const groups = new Map<string, { value: number; types: Set<Position['type']>; count: number }>()
  for (const item of contributions) {
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
    const stats = computePortfolioStats(positions, input.quotes)
    const contributions = buildContributions(positions, input.quotes, stats.currentValue)
    const dailyChangeValues = contributions.map((item) => item.dailyChange).filter((value): value is number => value != null)
    const dailyChange = dailyChangeValues.length ? dailyChangeValues.reduce((sum, value) => sum + value, 0) : null
    const quoteValues = Object.values(input.quotes)
    return {
      folios: input.folios,
      rawPositions,
      positions,
      quotes: input.quotes,
      fxRate: input.fxRate,
      invested: stats.invested,
      currentValue: stats.currentValue,
      pnl: stats.pnl,
      pnlPct: stats.pnlPct,
      dailyChange,
      dailyChangePct: dailyChange != null && stats.currentValue > 0 ? (dailyChange / (stats.currentValue - dailyChange)) * 100 : null,
      contributions,
      sectors: buildSectors(contributions, stats.currentValue),
      topFiveWeight: [...contributions].sort((a, b) => b.value - a.value).slice(0, 5).reduce((sum, item) => sum + item.weight, 0),
      staleQuotes: quoteValues.filter(quoteIsStale).length,
      lastUpdatedAt: lastUpdated(input.quotes),
      history: input.history ?? [],
    }
  },
}

/** Used by import preview and export without coupling those views to storage. */
export function importIdentitySummary(positions: Position[]): { normalized: Position[]; duplicateCount: number; unmatchedCount: number } {
  const normalized = investmentWorkspace.normalizeImport(positions)
  const counts = new Map<string, number>()
  for (const position of normalized) counts.set(instrumentKey(position), (counts.get(instrumentKey(position)) ?? 0) + 1)
  return {
    normalized,
    duplicateCount: Array.from(counts.values()).filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0),
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
