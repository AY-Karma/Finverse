import type { Position } from './types'
import {
  fetchHistory,
  fetchLiveQuotes,
  fetchNavHistory,
  fetchYahooPrice,
  resolveYahooSymbolCandidates,
  type HistoryPoint,
  type LiveQuotesResult,
} from './live'

export interface MarketDataAdapter {
  refreshQuotes(positions: Position[], previous: Record<string, import('./types').LiveQuote>): Promise<LiveQuotesResult>
  history(position: Position, from: Date, to: Date): Promise<HistoryPoint[]>
  benchmarkHistory(symbol: string, from: Date, to: Date): Promise<HistoryPoint[]>
  quote(symbol: string): Promise<{ price: number; change: number | null; pct: number | null; at: number } | null>
}

interface BenchmarkDefinition {
  id: string
  label: string
  symbol: string | null
  region: 'India' | 'Global'
  unavailableReason?: string
}

/** Benchmarks intentionally live beside the data adapter so views never need to know provider symbols. */
export const BENCHMARKS: BenchmarkDefinition[] = [
  { id: 'nifty-50', label: 'NIFTY 50', symbol: '^NSEI', region: 'India' },
  { id: 'nifty-next-50', label: 'NIFTY Next 50', symbol: '^NSMIDCP', region: 'India' },
  { id: 'nifty-100', label: 'NIFTY 100', symbol: '^CNX100', region: 'India' },
  { id: 'nifty-200', label: 'NIFTY 200', symbol: '^CNX200', region: 'India' },
  {
    id: 'nifty-250',
    label: 'NIFTY 250',
    symbol: null,
    region: 'India',
    unavailableReason: 'The current public data connection does not provide a reliable NIFTY 250 history yet.',
  },
  { id: 'nifty-largemid-250', label: 'NIFTY Largemid 250', symbol: 'NIFTY_LARGEMID250.NS', region: 'India' },
  { id: 'nifty-midcap-50', label: 'NIFTY Midcap 50', symbol: '^NSEMDCP50', region: 'India' },
  { id: 'nifty-smallcap-100', label: 'NIFTY Smallcap 100', symbol: '^CNXSC', region: 'India' },
  { id: 'sensex', label: 'S&P BSE Sensex', symbol: '^BSESN', region: 'India' },
  { id: 'sp-500', label: 'S&P 500', symbol: '^GSPC', region: 'Global' },
  { id: 'nasdaq-composite', label: 'NASDAQ Composite', symbol: '^IXIC', region: 'Global' },
  { id: 'dow-jones', label: 'Dow Jones', symbol: '^DJI', region: 'Global' },
  { id: 'ftse-100', label: 'FTSE 100', symbol: '^FTSE', region: 'Global' },
  { id: 'nikkei-225', label: 'Nikkei 225', symbol: '^N225', region: 'Global' },
  { id: 'hang-seng', label: 'Hang Seng', symbol: '^HSI', region: 'Global' },
  { id: 'dax', label: 'DAX', symbol: '^GDAXI', region: 'Global' },
  { id: 'cac-40', label: 'CAC 40', symbol: '^FCHI', region: 'Global' },
]

/** Current public adapter. A licensed or first-party adapter can replace it at this seam. */
export const marketData: MarketDataAdapter = {
  refreshQuotes: fetchLiveQuotes,
  history(position, from, to) {
    if (position.type === 'mutual-fund') return fetchNavHistory(position.name || position.ticker, from, to)
    return (async () => {
      for (const symbol of resolveYahooSymbolCandidates(position)) {
        const points = await fetchHistory(symbol, from, to)
        if (points.length > 0) return points
      }
      return []
    })()
  },
  benchmarkHistory(symbol, from, to) {
    return fetchHistory(symbol, from, to)
  },
  quote: fetchYahooPrice,
}
