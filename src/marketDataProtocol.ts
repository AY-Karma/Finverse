export const MAX_MARKET_SYMBOLS = 25

const MARKET_SYMBOL_PATTERN = /^(?:\^[A-Z0-9][A-Z0-9._-]{0,30}|[A-Z0-9][A-Z0-9._=-]{0,31})$/

export type EquityQuoteSource = 'yahoo' | 'nse-close'

export interface MarketQuotePayload {
  symbol: string
  price: number
  previousClose: number | null
  change: number | null
  changePct: number | null
  marketTime: string
  source: EquityQuoteSource
}

export interface QuoteErrorPayload {
  symbol: string
  message: string
}

export interface QuotesPayload {
  provider: 'yahoo-unofficial' | 'nse-official-close' | 'mixed'
  fetchedAt: string
  quotes: MarketQuotePayload[]
  errors: QuoteErrorPayload[]
}

export interface HistoryPayload {
  symbol: string
  points: { date: string; close: number }[]
}

export function isMarketSymbol(value: string): boolean {
  return MARKET_SYMBOL_PATTERN.test(value)
}
