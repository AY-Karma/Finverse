import type { Position } from './types'

// ---------------------------------------------------------------------------
// Research deep-links (Tier 1): we don't scrape screener.in — we hand the user
// off to canonical screener.in pages plus a couple of reliable secondary
// sources (NSE quote, TradingView chart). All links are plain <a href>.
//
// Key facts learned from the live site:
//  - screener.in company sections are HASH ANCHORS on the company page
//    (#quarters, #ratios, #shareholding, #peers, #chart), not separate paths.
//  - canonical slugs don't always match NSE tickers (Tata Motors -> "TMCV",
//    some companies use numeric ids), so we resolve via screener's own search
//    API (through the CORS relay) and cache the result.
// ---------------------------------------------------------------------------

export interface ResearchLink {
  label: string
  url: string
}

/** Human-readable provenance for outbound research links. */
export function researchSource(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host === 'nseindia.com') return 'NSE India'
    if (host === 'tradingview.com') return 'TradingView'
    if (host === 'screener.in') return 'Screener'
    if (host === 'google.com') return 'Google'
    return host
  } catch {
    return 'External source'
  }
}

/** Ticker → screener.in canonical slug (upper-case, dots/spaces removed). */
function screenerSlug(symbol: string): string {
  return symbol
    .toUpperCase()
    .replace(/\.(NS|NSE|BSE)$/, '')
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * Screener's HTML search page (/search/?q=) was removed and now 404s, so any
 * "search on screener" hand-off goes through Google's index instead. This never
 * breaks, regardless of slug quirks.
 */
export function screenerFallbackSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:screener.in ${query.trim()}`)}`
}

/** `/company/TMCV/consolidated/` or `/company/538683/` → `/company/TMCV/`. */
function toBasePath(url: string): string {
  const u = url.startsWith('/') ? url : `/${url}`
  return u.replace(/\/consolidated\/?$/, '/').replace(/\/+$/, '/')
}

const RESOLVE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // cache a resolved path for a week

function readResolved(symbol: string): string | null {
  try {
    const raw = localStorage.getItem(`finverse:screenerPath:${screenerSlug(symbol)}`)
    if (!raw) return null
    const v = JSON.parse(raw) as { path: string; at: number }
    if (!v?.path || Date.now() - v.at > RESOLVE_TTL_MS) return null
    return v.path
  } catch {
    return null
  }
}

function writeResolved(symbol: string, path: string): void {
  try {
    localStorage.setItem(
      `finverse:screenerPath:${screenerSlug(symbol)}`,
      JSON.stringify({ path, at: Date.now() }),
    )
  } catch {
    /* storage unavailable — fine, we just resolve again next time */
  }
}

/**
 * Resolve a ticker to screener.in's canonical company path (e.g.
 * `/company/TMCV/`). Uses screener's search API through the CORS relay, cached
 * in localStorage. Falls back to the naive slug if resolution fails so links
 * never break entirely.
 */
export async function resolveScreenerCompanyPath(symbol: string): Promise<string> {
  const cached = readResolved(symbol)
  if (cached) return cached
  const fallback = toBasePath(`/company/${screenerSlug(symbol)}/`)
  try {
    const target = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(symbol)}`
    const res = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(target)}`, {
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return fallback
    const json = (await res.json()) as { url?: string }[]
    if (!Array.isArray(json) || json.length === 0) return fallback
    const company = json.find((x) => x?.url && x.url.startsWith('/company/'))
    if (!company?.url) return fallback
    const base = toBasePath(company.url)
    writeResolved(symbol, base)
    return base
  } catch {
    return fallback
  }
}

/** Secondary sources + a screener search fallback for unresolved symbols. */
export function marketLinks(position: Position): ResearchLink[] {
  if (position.type === 'mutual-fund') {
    const name = position.name || position.ticker
    return [
      { label: 'Google', url: `https://www.google.com/search?q=${encodeURIComponent(`${name} mutual fund`)}` },
    ]
  }
  const slug = screenerSlug(position.ticker)
  return [
    { label: 'NSE quote', url: `https://www.nseindia.com/get-quotes/equity?symbol=${slug}` },
    { label: 'TradingView chart', url: `https://www.tradingview.com/chart/?symbol=NSE%3A${slug}` },
    { label: 'Screener', url: screenerFallbackSearchUrl(position.ticker) },
  ]
}
