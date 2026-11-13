import type { LiveQuote, Position } from './types'
import { hasCompatibleFundScheme } from './fundSchemes'
import { resolveYahooSymbol } from './live'
import { quoteKey } from './valuation'

const CACHE_KEY = 'finverse:live-quotes:v1'
const MAX_AGE_MS = 7 * 24 * 60 * 60_000
const MAX_QUOTES = 5_000

function pricingIdentity(position: Position): string | null {
  return position.type === 'mutual-fund'
    ? hasCompatibleFundScheme(position) ? `nav:${position.mfScheme!.code}` : null
    : resolveYahooSymbol(position)
}

function usableQuote(value: unknown, identity: string, now: number): LiveQuote | null {
  if (!value || typeof value !== 'object') return null
  const quote = value as LiveQuote
  if (!Number.isFinite(quote.price) || quote.price <= 0 || !Number.isFinite(quote.at)
    || quote.at <= 0 || quote.at < now - MAX_AGE_MS || quote.at > now + 300_000
    || (identity.startsWith('nav:') ? quote.source !== 'nav' : quote.source !== 'yahoo' && quote.source !== 'nse-close')
    || (quote.fetchedAt != null && (!Number.isFinite(quote.fetchedAt) || quote.fetchedAt <= 0 || quote.fetchedAt > now + 300_000))) return null
  return {
    price: quote.price, at: quote.at, source: quote.source,
    ...(quote.fetchedAt != null ? { fetchedAt: quote.fetchedAt } : {}),
    ...(quote.change === null || Number.isFinite(quote.change) ? { change: quote.change } : {}),
    ...(quote.changePct === null || Number.isFinite(quote.changePct) ? { changePct: quote.changePct } : {}),
  }
}

export function loadCachedQuotes(positions: Position[], now = Date.now()): Record<string, LiveQuote> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw || raw.length > 2_000_000) return {}
    const cache = JSON.parse(raw)
    if (cache?.version !== 1 || !cache.quotes || typeof cache.quotes !== 'object' || Array.isArray(cache.quotes)) return {}
    const quotes: Record<string, LiveQuote> = {}
    for (const position of positions.slice(0, MAX_QUOTES)) {
      const key = quoteKey(position)
      const identity = pricingIdentity(position)
      const entry = cache.quotes[key]
      if (!identity || entry?.identity !== identity) continue
      const quote = usableQuote(entry.quote, identity, now)
      if (quote) quotes[key] = quote
    }
    return quotes
  } catch { return {} }
}

export function saveCachedQuotes(positions: Position[], quotes: Record<string, LiveQuote>, now = Date.now()): void {
  try {
    const entries: Record<string, { identity: string; quote: LiveQuote }> = {}
    for (const position of positions.slice(0, MAX_QUOTES)) {
      const key = quoteKey(position)
      if (!quotes[key]) continue
      const identity = pricingIdentity(position)
      const quote = identity ? usableQuote(quotes[key], identity, now) : null
      if (identity && quote) entries[key] = { identity, quote }
    }
    if (Object.keys(entries).length) localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, quotes: entries }))
    else localStorage.removeItem(CACHE_KEY)
  } catch { /* Quote caching must not block prices when browser storage is unavailable. */ }
}
