import type { AssetType, Currency, Exchange, Position } from './types'

const NSE_SERIES_SUFFIX = /-(EQ|BE|SM|ST|T|BL|Z|E|B|N|W)$/i

function clean(value: string | undefined): string {
  return (value ?? '').trim()
}

function canonicalSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/\.(NS|NSE|BO|BSE)$/i, '').replace(NSE_SERIES_SUFFIX, '')
}

function inferExchange(ticker: string, exchange?: string): Exchange {
  const explicit = clean(exchange).toUpperCase()
  if (explicit === 'NSE' || explicit === 'BSE' || explicit === 'NASDAQ' || explicit === 'NYSE' || explicit === 'LSE') {
    return explicit
  }
  if (/\.(NS|NSE)$/i.test(ticker)) return 'NSE'
  if (/\.(BO|BSE)$/i.test(ticker)) return 'BSE'
  return 'NSE'
}

function inferCurrency(exchange: Exchange, currency?: Currency): Currency {
  if (currency === 'USD' || currency === 'INR') return currency
  return exchange === 'NASDAQ' || exchange === 'NYSE' ? 'USD' : 'INR'
}

/** Stable identity used by imports, quotes, history, and research links. */
export function instrumentKey(position: Pick<Position, 'ticker' | 'name' | 'type' | 'instrumentKey'>): string {
  if (position.instrumentKey) return position.instrumentKey
  if (position.type === 'mutual-fund') return `MF:${clean(position.name || position.ticker).toLowerCase()}`
  return `EQ:${canonicalSymbol(position.ticker)}`
}

/** Add a deterministic identity without requiring a provider lookup. */
export function normalizePosition(position: Position): Position {
  const exchange = inferExchange(position.ticker, position.exchange)
  const ticker = position.type === 'mutual-fund' ? clean(position.ticker) : canonicalSymbol(position.ticker)
  const key = instrumentKey({ ...position, ticker })
  const providerSuffix = exchange === 'BSE' ? 'BO' : exchange === 'NSE' ? 'NS' : ''
  const providerSymbol = position.providerSymbol || (position.type === 'mutual-fund' || !providerSuffix ? undefined : `${ticker}.${providerSuffix}`)
  return {
    ...position,
    ticker,
    instrumentKey: key,
    exchange,
    providerSymbol,
    currency: inferCurrency(exchange, position.currency),
    sector: clean(position.sector || position.category) || undefined,
    industry: clean(position.industry || position.subCategory) || undefined,
  }
}

export function instrumentLabel(position: Pick<Position, 'ticker' | 'name' | 'type'>): string {
  return position.type === 'mutual-fund' ? clean(position.name || position.ticker) : clean(position.ticker || position.name)
}

export function assetTypeLabel(type: AssetType): string {
  if (type === 'mutual-fund') return 'Mutual fund'
  if (type === 'etf') return 'ETF'
  if (type === 'stock') return 'Equity'
  return 'Other'
}
