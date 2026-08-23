/**
 * Company logo resolution for holdings avatars.
 *
 * Layered guarantee — every holding ends up with something distinctive:
 *  1. Real marks from keyless static CDNs, keyed by ISIN (jsDelivr's
 *     extra-isin set) and by exchange+ticker (EODHD).
 *  2. Sparse imports often lack ISINs, so we resolve them once from Groww's
 *     public instruments CSV and cache locally — unlocking layer 1's best set.
 *  3. If every remote source misses (obscure ETFs do), a deterministic
 *     tinted-monogram tile keeps the row glanceable. Never blank.
 */

const JSDELIVR_BASE = 'https://cdn.jsdelivr.net/npm/@extra-isin/logos/data'
const EODHD_BASE = 'https://eodhd.com/img/logos'
const NSE_EQUITY_MASTER_URL = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv'
const ISIN_CACHE_PREFIX = 'finverse:isin:'
const ISIN_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000
const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/

export function isinLogoUrl(isin: string | undefined | null): string | null {
  if (!isin) return null
  const value = isin.trim().toUpperCase()
  if (!ISIN_PATTERN.test(value)) return null
  return `${JSDELIVR_BASE}/${value}.png`
}

export function tickerLogoUrl(ticker: string, exchange?: string): string | null {
  const base = normalizeTicker(ticker)
  if (!base || !/^[A-Z0-9]{2,20}$/.test(base)) return null
  const exchangeCode = exchange === 'BSE' ? 'BSE' : 'NSE'
  return `${EODHD_BASE}/${exchangeCode}/${base}.png`
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\.(NS|NSE|BO|BSE)$/, '')
}

// ---------------------------------------------------------------------------
// Ticker → ISIN bridge (NSE official equity master, cached per browser)
// ---------------------------------------------------------------------------

type TextFetcher = (url: string, signal?: AbortSignal) => Promise<string>

async function defaultFetcher(url: string): Promise<string> {
  const response = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

let masterInFlight: Promise<string> | null = null

function loadEquityMaster(fetcher: TextFetcher): Promise<string> {
  masterInFlight ??= fetcher(NSE_EQUITY_MASTER_URL).catch((reason) => {
    masterInFlight = null
    throw reason
  })
  return masterInFlight
}

/** Pull the ISIN column out of one CSV row using the header's column order. */
export function extractIsinFromRow(header: string[], row: string[], symbol: string): string | null {
  const symbolIndex = header.findIndex((name) => name.trim().toUpperCase() === 'SYMBOL')
  const isinIndex = header.findIndex((name) => name.trim().toUpperCase() === 'ISIN NUMBER')
  if (symbolIndex === -1 || isinIndex === -1) return null
  if ((row[symbolIndex] ?? '').trim().toUpperCase() !== symbol.toUpperCase()) return null
  const isin = (row[isinIndex] ?? '').trim().toUpperCase()
  return ISIN_PATTERN.test(isin) ? isin : null
}

function readCachedIsin(ticker: string): string | null {
  try {
    const raw = localStorage.getItem(ISIN_CACHE_PREFIX + ticker)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { isin?: unknown; at?: unknown }
    if (typeof parsed.isin !== 'string' || typeof parsed.at !== 'number') return null
    if (Date.now() - parsed.at > ISIN_CACHE_TTL_MS) return null
    return parsed.isin
  } catch {
    return null
  }
}

function writeCachedIsin(ticker: string, isin: string): void {
  try {
    localStorage.setItem(ISIN_CACHE_PREFIX + ticker, JSON.stringify({ isin, at: Date.now() }))
  } catch {
    /* storage full or unavailable — resolution just retries next session */
  }
}

/** Resolve an ISIN for a ticker: cache first, then one bulk pass over the NSE master. */
export async function resolveIsin(
  ticker: string,
  fetcher: TextFetcher = defaultFetcher,
): Promise<string | null> {
  const symbol = normalizeTicker(ticker)
  if (!symbol || !/^[A-Z0-9]{2,20}$/.test(symbol)) return null
  const cached = readCachedIsin(symbol)
  if (cached) return cached
  const csv = await loadEquityMaster(fetcher)
  const lines = csv.split(/\r?\n/)
  const header = lines[0]?.split(',').map((name) => name.trim()) ?? []
  for (let index = 1; index < lines.length; index++) {
    const row = lines[index].split(',')
    const isin = extractIsinFromRow(header, row, symbol)
    if (isin) {
      writeCachedIsin(symbol, isin)
      return isin
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Deterministic monogram tile — the never-blank final layer
// ---------------------------------------------------------------------------

/** Stable 0–359 hue from the ticker so each holding keeps its own colour. */
export function tickerHue(ticker: string): number {
  let hash = 0
  for (let index = 0; index < ticker.length; index++) {
    hash = (hash * 31 + ticker.charCodeAt(index)) >>> 0
  }
  return hash % 360
}

export function monogramTile(tickerBase: string, label?: string, mode: 'dark' | 'light' = 'dark'): string {
  const letters = (label ?? tickerBase).replace(/[^A-Z0-9]/g, '').slice(0, 3) || '₹'
  const hue = tickerHue(tickerBase)
  const fontSize = letters.length > 2 ? 11 : 15
  const bg = mode === 'light' ? `hsl(${hue} 45% 88%)` : `hsl(${hue} 28% 16%)`
  const fg = mode === 'light' ? `hsl(${hue} 55% 30%)` : `hsl(${hue} 70% 74%)`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">` +
    `<rect width="48" height="48" rx="10" fill="${bg}"/>` +
    `<text x="24" y="24" dy=".36em" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="${fontSize}" font-weight="600" fill="${fg}">${letters}</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
