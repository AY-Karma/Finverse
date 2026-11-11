import { BENCHMARKS, marketData, type PublicMarketQuote } from './marketData'
import { createSharedRequest } from './sharedRequest'

export const INDEX_REFRESH_MS = 1_000
const FAILED_INDEX_REFRESH_MS = 30_000
export const MARKET_INDICES = ['nifty-bank', 'nifty-50'].flatMap((id) => {
  const index = BENCHMARKS.find((item) => item.id === id)
  return index?.symbol ? [{ id: index.id, label: id === 'nifty-bank' ? 'Bank Nifty' : index.label, symbol: index.symbol }] : []
})

export interface MarketIndexSnapshot {
  quotes: Record<string, PublicMarketQuote>
  checkedAt: number
  unavailable: string[]
}

let snapshot: MarketIndexSnapshot = { quotes: {}, checkedAt: 0, unavailable: [] }
const shared = createSharedRequest<MarketIndexSnapshot>()
let nextCheckAt = 0

export function cachedMarketIndexQuotes(): MarketIndexSnapshot { return snapshot }
export function nextMarketIndexRefreshAt(): number { return nextCheckAt }

function usable(quote: PublicMarketQuote, now: number): boolean {
  return Number.isFinite(quote.price) && quote.price > 0 && Number.isFinite(quote.at)
    && quote.at > 0 && quote.at <= now + 300_000
}

export function loadMarketIndexQuotes(signal?: AbortSignal, force = false): Promise<MarketIndexSnapshot> {
  signal?.throwIfAborted()
  if (!force && snapshot.checkedAt && Date.now() >= snapshot.checkedAt && Date.now() < nextCheckAt) return Promise.resolve(snapshot)
  return shared('indian-market-indices', async (requestSignal) => {
    let fetched = new Map<string, PublicMarketQuote>()
    try { fetched = await marketData.quotes(MARKET_INDICES.map((index) => index.symbol), requestSignal) }
    catch { requestSignal.throwIfAborted() }
    requestSignal.throwIfAborted()
    const now = Date.now()
    const quotes = { ...snapshot.quotes }
    const unavailable: string[] = []
    for (const { symbol } of MARKET_INDICES) {
      const quote = fetched.get(symbol)
      if (!quote || !usable(quote, now)) { unavailable.push(symbol); continue }
      const previous = quotes[symbol]
      if (previous && previous.at > quote.at) { unavailable.push(symbol); continue }
      quotes[symbol] = {
        price: quote.price, at: quote.at,
        change: quote.change !== null && Number.isFinite(quote.change) ? quote.change : null,
        pct: quote.pct !== null && Number.isFinite(quote.pct) ? quote.pct : null,
      }
    }
    snapshot = { quotes, checkedAt: now, unavailable }
    nextCheckAt = now + (unavailable.length === MARKET_INDICES.length ? FAILED_INDEX_REFRESH_MS : INDEX_REFRESH_MS)
    return snapshot
  }, signal)
}
