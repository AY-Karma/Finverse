import type { LiveQuote, Position } from './types'
import { reviewFundScheme, type FundSchemeReview } from './fundSchemes'
import { listingIdentity } from './instruments'
import {
  fetchHistory,
  fetchLiveQuotes,
  fetchNavHistory,
  fetchYahooPrices,
  resolveYahooSymbol,
  type HistoryPoint,
  type LiveQuotesResult,
} from './live'

export interface MarketDataAdapter {
  reviewFundScheme(name: string, signal?: AbortSignal): Promise<FundSchemeReview>
  refreshQuotes(positions: Position[], previous: Record<string, LiveQuote>, signal?: AbortSignal, onProgress?: (result: LiveQuotesResult) => void): Promise<LiveQuotesResult>
  history(position: Position, from: Date, to: Date, signal?: AbortSignal): Promise<HistoryPoint[]>
  benchmarkHistory(symbol: string, from: Date, to: Date, signal?: AbortSignal): Promise<HistoryPoint[]>
  quotes(symbols: string[], signal?: AbortSignal): Promise<Map<string, PublicMarketQuote>>
}

export interface PublicMarketQuote {
  price: number
  change: number | null
  pct: number | null
  at: number
  /** Earliest time the provider can have a newer price; null or absent when unknown. */
  nextUpdateAt?: number | null
}

export { BENCHMARKS } from './marketIndexSelection'

/** Current public adapter. A licensed or first-party adapter can replace it at this seam. */
export const marketData: MarketDataAdapter = {
  reviewFundScheme,
  refreshQuotes: fetchLiveQuotes,
  history(position, from, to, signal) {
    if (position.type === 'mutual-fund') return fetchNavHistory(position, from, to, signal)
    const symbol = resolveYahooSymbol(position)
    return symbol ? fetchHistory(symbol, from, to, signal, listingIdentity(position)) : Promise.resolve([])
  },
  benchmarkHistory(symbol, from, to, signal) {
    return fetchHistory(symbol, from, to, signal)
  },
  quotes: fetchYahooPrices,
}
