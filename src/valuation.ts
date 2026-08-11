import type { Currency, LiveQuote, Position } from './types'

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
  return position.type === 'mutual-fund'
    ? (position.name || position.ticker).trim()
    : position.ticker.trim().toUpperCase()
}

/** A live quote is preferred over the spreadsheet's most recent reported price. */
export function effectivePrice(position: Position, quotes: Record<string, LiveQuote> = {}): number | null {
  return quotes[quoteKey(position)]?.price ?? position.lastPrice
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
