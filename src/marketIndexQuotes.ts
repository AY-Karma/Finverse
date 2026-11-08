import { BENCHMARKS, marketData, type PublicMarketQuote } from './marketData'
import { createSharedRequest } from './sharedRequest'

export const INDEX_REFRESH_MS = 30_000
export const MARKET_INDICES = ['nifty-50', 'sensex', 'nifty-bank', 'nifty-next-50', 'nifty-midcap-50']
  .flatMap((id) => {
    const index = BENCHMARKS.find((item) => item.id === id && item.symbol)
    return index?.symbol ? [{ id: index.id, label: index.label, symbol: index.symbol }] : []
  })

export interface MarketIndexSnapshot {
  quotes: Record<string, PublicMarketQuote>
  checkedAt: number
  unavailable: string[]
}

let snapshot: MarketIndexSnapshot = { quotes: {}, checkedAt: 0, unavailable: [] }
const shared = createSharedRequest<MarketIndexSnapshot>()

export function cachedMarketIndexQuotes(): MarketIndexSnapshot { return snapshot }

function usable(quote: PublicMarketQuote, now: number): boolean {
  return Number.isFinite(quote.price) && quote.price > 0 && Number.isFinite(quote.at)
    && quote.at > 0 && quote.at <= now + 300_000
}

export function loadMarketIndexQuotes(signal?: AbortSignal): Promise<MarketIndexSnapshot> {
  signal?.throwIfAborted()
  if (snapshot.checkedAt && Date.now() - snapshot.checkedAt < INDEX_REFRESH_MS) return Promise.resolve(snapshot)
  return shared('indian-market-indices', async (requestSignal) => {
    let fetched = new Map<string, PublicMarketQuote>()
    try { fetched = await marketData.quotes(MARKET_INDICES.map((index) => index.symbol), requestSignal) }
    catch { requestSignal.throwIfAborted() }
    requestSignal.throwIfAborted()
    const now = Date.now()
    const quotes = { ...snapshot.quotes }
    const unavailable: string[] = []
    for (const index of MARKET_INDICES) {
      const quote = fetched.get(index.symbol)
      if (!quote || !usable(quote, now)) { unavailable.push(index.symbol); continue }
      const previous = quotes[index.symbol]
      if (previous && previous.at > quote.at) { unavailable.push(index.symbol); continue }
      quotes[index.symbol] = {
        price: quote.price, at: quote.at,
        change: quote.change !== null && Number.isFinite(quote.change) ? quote.change : null,
        pct: quote.pct !== null && Number.isFinite(quote.pct) ? quote.pct : null,
      }
    }
    snapshot = { quotes, checkedAt: now, unavailable }
    return snapshot
  }, signal)
}
