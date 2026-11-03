import type { LiveQuote, Position } from './types'
import { hasSupportedValuationCurrency, quoteKey } from './valuation'

export type HoldingMoveRange = 'month' | 'year' | 'custom'
export type HoldingPriceHistories = Record<string, { date: string; close: number }[]>
export interface HoldingMarketMove {
  key: string
  label: string
  quantity: number
  from: string
  through: string
  openingPrice: number
  closingPrice: number
  value: number
  change: number
  changePct: number
}

const DAY_MS = 86_400_000

function validDate(value: string): boolean {
  const at = Date.parse(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value
}

export function holdingMoveToday(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10)
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

export function holdingMovePeriod(range: HoldingMoveRange, customFrom: string, today = holdingMoveToday()) {
  const from = range === 'month' ? `${today.slice(0, 7)}-01` : range === 'year' ? `${today.slice(0, 4)}-01-01` : customFrom
  if (!validDate(today) || !validDate(from) || from > today) return null
  return { from, to: today, historyFrom: shiftDate(from, -8) }
}

export function uniqueMarketHoldings(positions: Position[]): Position[] {
  const holdings = new Map<string, Position>()
  for (const position of positions) {
    if (!Number.isFinite(position.quantity) || position.quantity <= 0) continue
    const key = quoteKey(position)
    const existing = holdings.get(key)
    holdings.set(key, existing ? { ...existing, quantity: existing.quantity + position.quantity } : { ...position })
  }
  return [...holdings.values()]
}

/** Reprices today's quantities. It does not reconstruct past ownership or investment profits. */
export function calculateHoldingMarketMoves(
  positions: Position[], quotes: Record<string, LiveQuote>, histories: HoldingPriceHistories,
  from: string, to = holdingMoveToday(),
) {
  const holdings = uniqueMarketHoldings(positions)
  const rows: HoldingMarketMove[] = []
  const unavailable: string[] = []
  let knownMarketValue = 0
  if (!validDate(from) || !validDate(to) || from > to) return { rows, unavailable: holdings.map((holding) => holding.name || holding.ticker), totalCount: holdings.length, coveredCount: 0, knownMarketValue, coveredMarketValue: 0, coveragePct: null, totalChange: 0 }
  const openingDate = shiftDate(from, -1)
  for (const holding of holdings) {
    const key = quoteKey(holding)
    const label = holding.name || holding.ticker
    if (holding.identityIssue || !hasSupportedValuationCurrency(holding)) { unavailable.push(label); continue }
    const prices = (histories[key] ?? []).filter((point) => validDate(point.date) && Number.isFinite(point.close) && point.close >= 0 && point.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date))
    const opening = [...prices].reverse().find((point) => point.date <= openingDate && point.date >= shiftDate(openingDate, -7) && point.close > 0)
    let closing = [...prices].reverse().find((point) => point.date >= shiftDate(to, -7))
    const quote = quotes[key]
    if (quote && Number.isFinite(quote.at) && quote.at >= 0 && quote.at <= 8_640_000_000_000_000 - 330 * 60_000 && Number.isFinite(quote.price) && quote.price >= 0) {
      const date = holdingMoveToday(quote.at)
      if (date <= to && date >= shiftDate(to, -7) && (!closing || date >= closing.date)) closing = { date, close: quote.price }
    }
    if (closing) knownMarketValue += holding.quantity * closing.close
    if (!opening || !closing || closing.date < opening.date) { unavailable.push(label); continue }
    const change = holding.quantity * (closing.close - opening.close)
    const value = holding.quantity * closing.close
    if (![change, value].every(Number.isFinite)) { unavailable.push(label); continue }
    rows.push({ key, label, quantity: holding.quantity, from: opening.date, through: closing.date, openingPrice: opening.close, closingPrice: closing.close, value, change, changePct: (closing.close / opening.close - 1) * 100 })
  }
  const coveredMarketValue = rows.reduce((sum, row) => sum + row.value, 0)
  return { rows, unavailable, totalCount: holdings.length, coveredCount: rows.length, knownMarketValue, coveredMarketValue,
    coveragePct: knownMarketValue > 0 ? coveredMarketValue / knownMarketValue * 100 : null,
    totalChange: rows.reduce((sum, row) => sum + row.change, 0) }
}
