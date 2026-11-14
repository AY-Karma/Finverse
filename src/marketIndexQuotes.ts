import { marketData, type PublicMarketQuote } from './marketData'
import { createSharedRequest } from './sharedRequest'
import { MARKET_INDEX_CHOICES, selectedMarketIndices } from './marketIndexSelection'

export const INDEX_REFRESH_MS = 1_000
const FAILED_INDEX_REFRESH_MS = 30_000

export interface MarketIndexSnapshot {
  quotes: Record<string, PublicMarketQuote>
  checkedAt: number
  unavailable: string[]
}

const CACHE_KEY = 'finverse:index-quotes:v1'
let savedSnapshot: MarketIndexSnapshot = restoreMarketIndexQuotes()
let lastSavedAt = 0
const shared = createSharedRequest<MarketIndexSnapshot>()
const pairs = new Map<string, { snapshot: MarketIndexSnapshot; nextCheckAt: number }>()

function selectedState(selection?: unknown) {
  const indices = selectedMarketIndices(selection)
  const key = indices.map((index) => index.symbol).join(',')
  let state = pairs.get(key)
  if (!state) {
    const quotes = Object.fromEntries(indices.flatMap(({ symbol }) => savedSnapshot.quotes[symbol] ? [[symbol, savedSnapshot.quotes[symbol]]] : []))
    state = { snapshot: { quotes, checkedAt: Object.keys(quotes).length ? savedSnapshot.checkedAt : 0,
      unavailable: savedSnapshot.unavailable.filter((symbol) => indices.some((index) => index.symbol === symbol)) }, nextCheckAt: 0 }
    pairs.set(key, state)
  }
  return { indices, key, state }
}

export function cachedMarketIndexQuotes(selection?: unknown): MarketIndexSnapshot { return selectedState(selection).state.snapshot }
export function nextMarketIndexRefreshAt(selection?: unknown): number { return selectedState(selection).state.nextCheckAt }

function usable(quote: PublicMarketQuote, now: number): boolean {
  return Number.isFinite(quote.price) && quote.price > 0 && Number.isFinite(quote.at)
    && quote.at > 0 && quote.at <= now + 300_000
}

function restoreMarketIndexQuotes(): MarketIndexSnapshot {
  const empty = { quotes: {}, checkedAt: 0, unavailable: [] }
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw || raw.length > 32_000) return empty
    const cached = JSON.parse(raw)
    const now = Date.now()
    if (cached?.version !== 1 || !Number.isFinite(cached.checkedAt) || cached.checkedAt <= 0 || cached.checkedAt > now + 300_000) return empty
    const quotes: Record<string, PublicMarketQuote> = {}
    for (const { symbol } of MARKET_INDEX_CHOICES) {
      if (!symbol) continue
      const quote = cached.quotes?.[symbol]
      if (!quote || !usable(quote, now) || quote.at < now - 7 * 86_400_000) continue
      quotes[symbol] = { price: quote.price, at: quote.at,
        change: quote.change === null || Number.isFinite(quote.change) ? quote.change : null,
        pct: quote.pct === null || Number.isFinite(quote.pct) ? quote.pct : null }
    }
    if (!Object.keys(quotes).length) return empty
    return { quotes, checkedAt: cached.checkedAt,
      unavailable: MARKET_INDEX_CHOICES.flatMap(({ symbol }) => symbol && Array.isArray(cached.unavailable) && cached.unavailable.includes(symbol) ? [symbol] : []) }
  } catch { return empty }
}

export function persistMarketIndexQuotes(): void {
  if (!savedSnapshot.checkedAt || !Object.keys(savedSnapshot.quotes).length) return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, ...savedSnapshot }))
    lastSavedAt = Date.now()
  } catch { /* Retain working quotes when browser storage is unavailable. */ }
}

export function loadMarketIndexQuotes(signal?: AbortSignal, force = false, selection?: unknown): Promise<MarketIndexSnapshot> {
  signal?.throwIfAborted()
  const { indices, key, state } = selectedState(selection)
  if (!force && state.snapshot.checkedAt && Date.now() >= state.snapshot.checkedAt && Date.now() < state.nextCheckAt) return Promise.resolve(state.snapshot)
  return shared(`market-indices:${key}`, async (requestSignal) => {
    let fetched = new Map<string, PublicMarketQuote>()
    try { fetched = await marketData.quotes(indices.map((index) => index.symbol), requestSignal) }
    catch { requestSignal.throwIfAborted() }
    requestSignal.throwIfAborted()
    const now = Date.now()
    const quotes = Object.fromEntries(indices.flatMap(({ symbol }) => savedSnapshot.quotes[symbol] ? [[symbol, savedSnapshot.quotes[symbol]]] : []))
    const unavailable: string[] = []
    for (const { symbol } of indices) {
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
    state.snapshot = { quotes, checkedAt: now, unavailable }
    savedSnapshot = { quotes: { ...savedSnapshot.quotes, ...quotes }, checkedAt: now,
      unavailable: [...savedSnapshot.unavailable.filter((symbol) => !indices.some((index) => index.symbol === symbol)), ...unavailable] }
    if (!lastSavedAt || now - lastSavedAt >= 10_000) persistMarketIndexQuotes()
    state.nextCheckAt = now + (unavailable.length === indices.length ? FAILED_INDEX_REFRESH_MS : INDEX_REFRESH_MS)
    return state.snapshot
  }, signal)
}
