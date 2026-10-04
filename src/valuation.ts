import type { Currency, LiveQuote, Position } from './types'
import { instrumentKey, instrumentLabel } from './instruments'

export interface Allocation {
  symbol: string
  value: number
  type: Position['type']
}

export interface PortfolioStats {
  invested: number
  pricedInvested: number
  pricedCount: number
  unpricedCount: number
  valuationComplete: boolean
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
  const live = quotes[quoteKey(position)]?.price
  if (live != null && Number.isFinite(live) && live >= 0) return live
  return position.lastPrice != null && Number.isFinite(position.lastPrice) && position.lastPrice >= 0 ? position.lastPrice : null
}

/** Merge same-instrument rows (same mutual-fund scheme name or equity ticker)
 *  so each holding is shown once. Quantities and invested amounts are summed;
 *  cost basis becomes the weighted average (invested ÷ units); merged XIRR is
 *  unavailable without dated cash flows; metadata keeps the first
 *  non-empty value. Conflicting identity metadata remains separate; descriptive
 *  metadata uses the first non-empty value in import order. */
const IDENTITY_FIELDS = ['type', 'exchange', 'currency', 'providerSymbol', 'isin'] as const

function groupPositions(positions: Position[]) {
  const groups = new Map<string, { rows: Position[]; identity: Partial<Position> }[]>()
  for (const p of positions) {
    const key = quoteKey(p)
    const candidates = groups.get(key) ?? []
    const existing = candidates.find(({ identity }) => IDENTITY_FIELDS.every((field) =>
      !p[field] || !identity[field] || identity[field] === p[field],
    ))
    if (existing) {
      existing.rows.push(p)
      existing.identity = { ...existing.identity, ...Object.fromEntries(IDENTITY_FIELDS.filter((field) => p[field]).map((field) => [field, p[field]])) }
    } else candidates.push({ rows: [p], identity: p })
    groups.set(key, candidates)
  }
  return groups
}

function combinedId(rows: Position[], conflictingGroups: number): string {
  if (rows.length === 1) return rows[0].id
  const identity = conflictingGroups > 1 ? ':' + IDENTITY_FIELDS.map((field) => rows.find((p) => p[field])?.[field] ?? '').join(':') : ''
  return `merged:${quoteKey(rows[0])}${identity}`
}

export function combinedPositionMembers(positions: Position[]): Map<string, Position[]> {
  const members = new Map<string, Position[]>()
  for (const candidates of groupPositions(positions).values()) {
    for (const { rows } of candidates) members.set(combinedId(rows, candidates.length), rows)
  }
  return members
}

export function combinePositions(positions: Position[]): Position[] {
  const groups = groupPositions(positions)
  const out: Position[] = []
  for (const candidates of groups.values()) for (const { rows } of candidates) {
    if (rows.length === 1) {
      out.push(rows[0])
      continue
    }
    const quantity = rows.reduce((s, p) => s + (Number.isFinite(p.quantity) ? p.quantity : 0), 0)
    const invested = rows.reduce((s, p) => s + (Number.isFinite(p.invested) ? p.invested : 0), 0)
    const first = rows[0]
    out.push({
      ...first,
      id: combinedId(rows, candidates.length),
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
      xirr: null,
      instrumentKey: rows.find((p) => p.instrumentKey)?.instrumentKey,
      exchange: rows.find((p) => p.exchange)?.exchange,
      currency: rows.find((p) => p.currency)?.currency,
      providerSymbol: rows.find((p) => p.providerSymbol)?.providerSymbol,
      isin: rows.find((p) => p.isin)?.isin,
      sector: rows.find((p) => p.sector?.trim())?.sector,
      industry: rows.find((p) => p.industry?.trim())?.industry,
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
  const priced = positions.filter((position) => effectivePrice(position, quotes) != null)
  const pricedInvested = priced.reduce((sum, position) => sum + position.invested, 0)
  const currentValue = priced.reduce((sum, position) => sum + positionValue(position, quotes), 0)
  const allocationsBySymbol = new Map<string, { value: number; type: Position['type'] }>()
  for (const position of priced) {
    const value = positionValue(position, quotes)
    const previous = allocationsBySymbol.get(position.ticker)
    if (previous) previous.value += value
    else allocationsBySymbol.set(position.ticker, { value, type: position.type })
  }
  const allocations = Array.from(allocationsBySymbol, ([symbol, allocation]) => ({ symbol, ...allocation }))
    .sort((a, b) => b.value - a.value)
  const pnl = currentValue - pricedInvested
  return { invested, pricedInvested, currentValue, pnl, pnlPct: pricedInvested > 0 ? (pnl / pricedInvested) * 100 : 0,
    pricedCount: priced.length, unpricedCount: positions.length - priced.length, valuationComplete: priced.length === positions.length, allocations }
}

export interface PortfolioPulse {
  /** Holdings by unrealized-P&L sign; unpriced holdings are excluded. */
  up: number
  down: number
  flat: number
  /** Mean unrealized return across winners / losers. */
  avgWinPct: number | null
  avgLossPct: number | null
  /** Strongest and weakest priced holding by return. */
  best: { symbol: string; pct: number } | null
  worst: { symbol: string; pct: number } | null
  /** Current value and holding count per asset class. */
  equityValue: number
  mutualValue: number
  equityCount: number
  mutualCount: number
  /** Holdings count and value share per weight band, priced positions only. */
  bands: { heavy: number; mid: number; light: number }
  bandWeight: { heavy: number; mid: number; light: number }
  bandMembers: { heavy: string[]; mid: string[]; light: string[] }
}

/** Overview "portfolio pulse": breadth, asset split and weight bands read from
 *  the whole book, independent of any panel scope filter. */
export function portfolioPulse(
  positions: Position[],
  quotes: Record<string, LiveQuote> = {},
): PortfolioPulse {
  const pulse: PortfolioPulse = {
    up: 0,
    down: 0,
    flat: 0,
    avgWinPct: null,
    avgLossPct: null,
    best: null,
    worst: null,
    equityValue: 0,
    mutualValue: 0,
    equityCount: 0,
    mutualCount: 0,
    bands: { heavy: 0, mid: 0, light: 0 },
    bandWeight: { heavy: 0, mid: 0, light: 0 },
    bandMembers: { heavy: [], mid: [], light: [] },
  }
  let totalValue = 0
  let winPctSum = 0
  let lossPctSum = 0
  const weights: { symbol: string; value: number; priced: boolean }[] = []
  for (const position of positions) {
    const value = positionValue(position, quotes)
    if (position.type === 'mutual-fund') {
      pulse.mutualValue += value
      pulse.mutualCount += 1
    } else {
      pulse.equityValue += value
      pulse.equityCount += 1
    }
    totalValue += value
    weights.push({ symbol: instrumentLabel(position), value, priced: effectivePrice(position, quotes) != null })
    const pct = positionPnlPct(position, quotes)
    if (pct == null) continue
    const pnl = positionPnl(position, quotes)
    if (pnl == null || pnl === 0) pulse.flat += 1
    else if (pnl > 0) {
      pulse.up += 1
      winPctSum += pct
    } else {
      pulse.down += 1
      lossPctSum += pct
    }
    const symbol = instrumentLabel(position)
    if (!pulse.best || pct > pulse.best.pct) pulse.best = { symbol, pct }
    if (!pulse.worst || pct < pulse.worst.pct) pulse.worst = { symbol, pct }
  }
  pulse.avgWinPct = pulse.up > 0 ? winPctSum / pulse.up : null
  pulse.avgLossPct = pulse.down > 0 ? lossPctSum / pulse.down : null
  for (const { symbol, value, priced } of [...weights].sort((a, b) => b.value - a.value)) {
    if (!priced || totalValue <= 0) continue
    const weight = (value / totalValue) * 100
    if (weight >= 10) {
      pulse.bands.heavy += 1
      pulse.bandWeight.heavy += weight
      pulse.bandMembers.heavy.push(symbol)
    } else if (weight >= 5) {
      pulse.bands.mid += 1
      pulse.bandWeight.mid += weight
      pulse.bandMembers.mid.push(symbol)
    } else {
      pulse.bands.light += 1
      pulse.bandWeight.light += weight
      pulse.bandMembers.light.push(symbol)
    }
  }
  return pulse
}

const MINUS_SIGN = '\u2212'
const currencyFormatters = new Map<string, Intl.NumberFormat>()

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
  const maximumFractionDigits = Math.abs(displayValue) >= 1000 ? 0 : 2
  const key = `${currency}:${maximumFractionDigits}`
  let formatter = currencyFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits })
    currencyFormatters.set(key, formatter)
  }
  const formatted = formatter.format(displayValue)
  return displayValue < 0 ? formatted.replace('-', MINUS_SIGN) : formatted
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : MINUS_SIGN}${Math.abs(value).toFixed(2)}%`
}
