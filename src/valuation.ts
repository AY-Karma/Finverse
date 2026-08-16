import type { Currency, LiveQuote, Position } from './types'
import { instrumentKey } from './instruments'

export interface Allocation {
  symbol: string
  value: number
  type: Position['type']
}

export interface PortfolioStats {
  invested: number
  currentValue: number
  pnl: number
  pnlPct: number
  allocations: Allocation[]
}

/** Stable key shared by imports, quote fetching, and every valuation view. */
export function quoteKey(position: Position): string {
  return instrumentKey(position)
}

/** A live quote is preferred over the spreadsheet's most recent reported price. */
export function effectivePrice(position: Position, quotes: Record<string, LiveQuote> = {}): number | null {
  return quotes[quoteKey(position)]?.price ?? position.lastPrice
}

/** Merge same-instrument rows (same mutual-fund scheme name or equity ticker)
 *  so each holding is shown once. Quantities and invested amounts are summed;
 *  cost basis becomes the weighted average (invested ÷ units); the fund XIRR is
 *  averaged across entries by their invested weight; metadata keeps the first
 *  non-empty value. Single rows pass through untouched. */
export function combinePositions(positions: Position[]): Position[] {
  const groups = new Map<string, Position[]>()
  for (const p of positions) {
    const key = quoteKey(p)
    const existing = groups.get(key)
    if (existing) existing.push(p)
    else groups.set(key, [p])
  }
  const out: Position[] = []
  for (const [, rows] of groups) {
    if (rows.length === 1) {
      out.push(rows[0])
      continue
    }
    const quantity = rows.reduce((s, p) => s + (Number.isFinite(p.quantity) ? p.quantity : 0), 0)
    const invested = rows.reduce((s, p) => s + (Number.isFinite(p.invested) ? p.invested : 0), 0)
    const first = rows[0]
    const xirrRows = rows.filter((p) => Number.isFinite(p.xirr))
    const xirrWeight = xirrRows.reduce((s, p) => s + Math.max(0, p.invested), 0)
    const xirr =
      xirrWeight > 0
        ? xirrRows.reduce((s, p) => s + p.xirr! * Math.max(0, p.invested), 0) / xirrWeight
        : null
    out.push({
      id: `merged:${quoteKey(first)}`,
      ticker: first.ticker,
      name: rows.find((p) => (p.name ?? '').trim() !== '')?.name ?? first.name,
      type: first.type,
      quantity,
      buyPrice: quantity > 0 ? invested / quantity : first.buyPrice,
      lastPrice: rows.find((p) => p.lastPrice != null)?.lastPrice ?? first.lastPrice,
      invested,
      amc: (rows.find((p) => (p.amc ?? '').trim() !== '') ?? first).amc,
      category: (rows.find((p) => (p.category ?? '').trim() !== '') ?? first).category,
      subCategory: (rows.find((p) => (p.subCategory ?? '').trim() !== '') ?? first).subCategory,
      folio: (rows.find((p) => (p.folio ?? '').trim() !== '') ?? first).folio,
      source: (rows.find((p) => (p.source ?? '').trim() !== '') ?? first).source,
      returns: rows.find((p) => p.returns != null)?.returns ?? first.returns,
      xirr,
    })
  }
  return out
}

export function isLiveQuote(position: Position, quotes: Record<string, LiveQuote>): boolean {
  return quoteKey(position) in quotes
}

export function positionValue(position: Position, quotes: Record<string, LiveQuote> = {}): number {
  const price = effectivePrice(position, quotes)
  return price == null ? 0 : price * position.quantity
}

export function positionPnl(position: Position, quotes: Record<string, LiveQuote> = {}): number | null {
  const price = effectivePrice(position, quotes)
  return price == null ? null : positionValue(position, quotes) - position.invested
}

export function positionPnlPct(position: Position, quotes: Record<string, LiveQuote> = {}): number | null {
  const pnl = positionPnl(position, quotes)
  return pnl == null || position.invested <= 0 ? null : (pnl / position.invested) * 100
}

export function computePortfolioStats(
  positions: Position[],
  quotes: Record<string, LiveQuote> = {},
): PortfolioStats {
  const invested = positions.reduce((sum, position) => sum + position.invested, 0)
  const currentValue = positions.reduce((sum, position) => sum + positionValue(position, quotes), 0)
  const allocationsBySymbol = new Map<string, { value: number; type: Position['type'] }>()
  for (const position of positions) {
    const value = positionValue(position, quotes)
    const previous = allocationsBySymbol.get(position.ticker)
    if (previous) previous.value += value
    else allocationsBySymbol.set(position.ticker, { value, type: position.type })
  }
  const allocations = Array.from(allocationsBySymbol, ([symbol, allocation]) => ({ symbol, ...allocation }))
    .sort((a, b) => b.value - a.value)
  const pnl = currentValue - invested
  return { invested, currentValue, pnl, pnlPct: invested > 0 ? (pnl / invested) * 100 : 0, allocations }
}

const MINUS_SIGN = '\u2212'

/** Format INR portfolio values in the selected display currency. */
export function formatCurrency(
  amountInInr: number,
  currency: Currency = 'INR',
  usdInrRate?: number | null,
): string {
  const displayValue = currency === 'USD'
    ? usdInrRate != null && Number.isFinite(usdInrRate) && usdInrRate > 0
      ? amountInInr / usdInrRate
      : null
    : amountInInr
  if (displayValue == null) return '—'
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency', currency, maximumFractionDigits: Math.abs(displayValue) >= 1000 ? 0 : 2,
  }).format(displayValue)
  return displayValue < 0 ? formatted.replace('-', MINUS_SIGN) : formatted
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : MINUS_SIGN}${Math.abs(value).toFixed(2)}%`
}
