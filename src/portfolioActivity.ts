import { instrumentLabel } from './instruments'
import { freshQuote, holdingIdentity, usableQuote } from './monitor'
import type { Currency, FxRate, LiveQuote, Position } from './types'
import { combinePositions, effectivePrice, quoteKey } from './valuation'

export type ActivityFreshness = 'recent' | 'stale' | 'imported' | 'unavailable'

export interface HoldingActivity {
  id: string
  instrumentIdentity: string
  key: string
  ticker: string
  name: string
  type: Position['type']
  assetCurrency: Currency
  /** Price in the asset's currency. Contribution is in the display currency. */
  price: number | null
  source: string | null
  observedAt: number | null
  marketTimeZone: string
  freshness: ActivityFreshness
  changePct: number | null
  dayContribution: number | null
  weightPct: number | null
  trend: 'up' | 'down' | 'neutral'
  movementLabel: 'Day move' | 'NAV move'
}

export interface PortfolioActivity {
  holdings: HoldingActivity[]
  movers: HoldingActivity[]
  currency: Currency
  summary: {
    largestImpact: HoldingActivity | null
    latestObservedAt: number | null
    quoteCount: number
    navCount: number
    impactCount: number
    impactEligibleCount: number
  }
  counts: {
    total: number
    quoted: number
    fresh: number
    stale: number
    imported: number
    unavailable: number
    movement: number
    impact: number
    fxUnavailable: number
    gainers: number | null
    decliners: number | null
    flat: number | null
  }
}

interface ActivityInput {
  positions: Position[]
  quotes: Record<string, LiveQuote>
  fxRate?: FxRate | null
  currency?: Currency
  hideValues?: boolean
  now?: number
}

const SOURCE_LABELS: Record<LiveQuote['source'], string> = {
  yahoo: 'Yahoo Finance',
  'nse-close': 'NSE close',
  nav: 'Published NAV',
}

function marketTimeZone(position: Position): string {
  if (position.type === 'mutual-fund' || position.exchange === 'NSE' || position.exchange === 'BSE') return 'Asia/Kolkata'
  if (position.exchange === 'LSE') return 'Europe/London'
  return position.currency === 'USD' || position.exchange === 'NASDAQ' || position.exchange === 'NYSE'
    ? 'America/New_York' : 'Asia/Kolkata'
}

function conversionFactor(from: Currency, to: Currency, fxRate: FxRate | null | undefined): number | null {
  if (from === to) return 1
  const rate = fxRate?.usdInr
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null
  return from === 'USD' ? rate : 1 / rate
}

function finiteValue(value: number): number | null {
  return Number.isFinite(value) ? value : null
}

function reportedChange(quote: LiveQuote): number | null {
  if (quote.change == null || !Number.isFinite(quote.change)) return null
  const previousPrice = quote.price - quote.change
  if (!Number.isFinite(previousPrice) || previousPrice <= 0) return null
  return quote.change
}

function reportedChangePct(quote: LiveQuote, change: number | null): number | null {
  if (quote.changePct != null && Number.isFinite(quote.changePct) && quote.changePct > -100) return quote.changePct
  return change == null ? null : finiteValue(change / (quote.price - change) * 100)
}

function holdingOrder(left: HoldingActivity, right: HoldingActivity): number {
  return (left.ticker || left.name).localeCompare(right.ticker || right.name)
    || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
}

function moverOrder(left: HoldingActivity, right: HoldingActivity): number {
  if (left.dayContribution == null && right.dayContribution != null) return 1
  if (left.dayContribution != null && right.dayContribution == null) return -1
  const impactOrder = Math.abs(right.dayContribution ?? 0) - Math.abs(left.dayContribution ?? 0)
  if (impactOrder) return impactOrder
  return Math.abs(right.changePct ?? 0) - Math.abs(left.changePct ?? 0) || holdingOrder(left, right)
}

/** Local projection of holdings, provider observations, and currency-safe impact estimates. */
export function buildPortfolioActivity({
  positions, quotes, fxRate, currency = 'INR', hideValues = false, now = Date.now(),
}: ActivityInput): PortfolioActivity {
  const combined = combinePositions(positions)
  const keyCounts = new Map<string, number>()
  for (const position of combined) {
    const key = quoteKey(position)
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
  }

  const rows = combined.map((position) => {
    const key = quoteKey(position)
    const candidate = keyCounts.get(key) === 1 ? quotes[key] : undefined
    const quote = usableQuote(candidate, now)
      && (position.type === 'mutual-fund' ? candidate.source === 'nav' : candidate.source !== 'nav')
      ? candidate : undefined
    const assetCurrency = position.currency ?? (position.exchange === 'NASDAQ' || position.exchange === 'NYSE' ? 'USD' : 'INR')
    const factor = conversionFactor(assetCurrency, currency, fxRate)
    const price = effectivePrice(position, quote ? { [key]: quote } : {})
    const timeZone = marketTimeZone(position)
    const recent = quote != null && freshQuote(quote, now)
    const change = recent ? reportedChange(quote) : null
    const changePct = recent ? reportedChangePct(quote, change) : null
    const validQuantity = Number.isFinite(position.quantity) && position.quantity >= 0
    const value = price != null && factor != null && validQuantity ? finiteValue(price * position.quantity * factor) : null
    const dayContribution = change != null && factor != null && validQuantity ? finiteValue(change * position.quantity * factor) : null
    const movement = changePct ?? change
    const holding: HoldingActivity = {
      id: position.id,
      instrumentIdentity: holdingIdentity(position),
      key,
      ticker: instrumentLabel(position),
      name: position.name,
      type: position.type,
      assetCurrency,
      price,
      source: quote ? SOURCE_LABELS[quote.source] : price != null ? 'Imported price' : null,
      observedAt: quote?.at ?? null,
      marketTimeZone: timeZone,
      freshness: quote ? recent ? 'recent' : 'stale' : price != null ? 'imported' : 'unavailable',
      changePct,
      dayContribution,
      weightPct: null,
      trend: movement == null || movement === 0 ? 'neutral' : movement > 0 ? 'up' : 'down',
      movementLabel: position.type === 'mutual-fund' ? 'NAV move' : 'Day move',
    }
    return { holding, value, hasMovement: movement != null, missingFx: factor == null }
  })

  const totalValue = rows.reduce((sum, row) => sum + (row.value ?? 0), 0)
  const valuationComplete = rows.length > 0 && rows.every((row) => row.value != null) && Number.isFinite(totalValue)
  if (valuationComplete && totalValue > 0) {
    for (const row of rows) row.holding.weightPct = row.value! / totalValue * 100
  }
  const holdings = rows.map((row) => row.holding).sort(holdingOrder)
  const reported = rows.filter((row) => row.hasMovement).map((row) => row.holding)
  const movers = reported.filter((row) => row.trend !== 'neutral').sort(moverOrder)
  const recentHoldings = holdings.filter((row) => row.freshness === 'recent')
  const recentQuotes = recentHoldings.filter((row) => row.type !== 'mutual-fund')
  const summary = {
    largestImpact: hideValues ? null : recentQuotes.reduce<HoldingActivity | null>((largest, row) => {
      if (row.dayContribution == null || row.dayContribution === 0) return largest
      return largest == null || moverOrder(row, largest) < 0 ? row : largest
    }, null),
    latestObservedAt: recentHoldings.reduce<number | null>((latest, row) => row.observedAt == null
      ? latest : Math.max(latest ?? row.observedAt, row.observedAt), null),
    quoteCount: recentQuotes.length,
    navCount: recentHoldings.filter((row) => row.type === 'mutual-fund').length,
    impactCount: recentQuotes.filter((row) => row.dayContribution != null).length,
    impactEligibleCount: holdings.filter((row) => row.type !== 'mutual-fund').length,
  }
  const counts = {
    total: holdings.length,
    quoted: holdings.filter((row) => row.observedAt != null).length,
    fresh: holdings.filter((row) => row.freshness === 'recent').length,
    stale: holdings.filter((row) => row.freshness === 'stale').length,
    imported: holdings.filter((row) => row.freshness === 'imported').length,
    unavailable: holdings.filter((row) => row.freshness === 'unavailable').length,
    movement: reported.length,
    impact: reported.filter((row) => row.dayContribution != null).length,
    fxUnavailable: rows.filter((row) => row.missingFx).length,
    gainers: hideValues ? null : reported.filter((row) => row.trend === 'up').length,
    decliners: hideValues ? null : reported.filter((row) => row.trend === 'down').length,
    flat: hideValues ? null : reported.filter((row) => row.trend === 'neutral').length,
  }

  if (hideValues) {
    for (const row of holdings) {
      row.price = null
      row.changePct = null
      row.dayContribution = null
      row.weightPct = null
      row.trend = 'neutral'
    }
    movers.sort(holdingOrder)
  }
  return { holdings, movers, currency, summary, counts }
}
