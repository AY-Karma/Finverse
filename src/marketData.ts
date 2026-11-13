import type { Position } from './types'
import { reviewFundScheme, type FundSchemeReview } from './fundSchemes'
import { listingIdentity } from './instruments'
import {
  fetchHistory,
  fetchLiveQuotes,
  fetchNavHistory,
  fetchYahooPrice,
  fetchYahooPrices,
  resolveYahooSymbolCandidates,
  type HistoryPoint,
  type LiveQuotesResult,
} from './live'

export interface MarketDataAdapter {
  reviewFundScheme(name: string, signal?: AbortSignal): Promise<FundSchemeReview>
  refreshQuotes(positions: Position[], previous: Record<string, import('./types').LiveQuote>, signal?: AbortSignal, onProgress?: (result: LiveQuotesResult) => void): Promise<LiveQuotesResult>
  history(position: Position, from: Date, to: Date, signal?: AbortSignal): Promise<HistoryPoint[]>
  benchmarkHistory(symbol: string, from: Date, to: Date, signal?: AbortSignal): Promise<HistoryPoint[]>
  quote(symbol: string, signal?: AbortSignal): Promise<{ price: number; change: number | null; pct: number | null; at: number } | null>
  quotes(symbols: string[], signal?: AbortSignal): Promise<Map<string, PublicMarketQuote>>
}

export interface PublicMarketQuote {
  price: number
  change: number | null
  pct: number | null
  at: number
}

export { BENCHMARKS } from './marketIndexSelection'

/** Current public adapter. A licensed or first-party adapter can replace it at this seam. */
export const marketData: MarketDataAdapter = {
  reviewFundScheme,
  refreshQuotes: fetchLiveQuotes,
  history(position, from, to, signal) {
    if (position.type === 'mutual-fund') return fetchNavHistory(position, from, to, signal)
    return (async () => {
      for (const symbol of resolveYahooSymbolCandidates(position)) {
        signal?.throwIfAborted()
        const points = await fetchHistory(symbol, from, to, signal, listingIdentity(position))
        if (points.length > 0) return points
      }
      return []
    })()
  },
  benchmarkHistory(symbol, from, to, signal) {
    return fetchHistory(symbol, from, to, signal)
  },
  quote: fetchYahooPrice,
  quotes: fetchYahooPrices,
}
