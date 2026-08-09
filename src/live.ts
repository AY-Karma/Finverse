import type { LiveQuote, Position } from './types'

// ---------------------------------------------------------------------------
// Indian market hours + NSE trading holidays (IST). Polling runs only while the
// market is actually open so we don't hammer the quote APIs off-hours.
// ---------------------------------------------------------------------------

/** NSE trading holidays 2026 (weekday closures only; weekends are closed anyway). */
export const NSE_HOLIDAYS_2026: ReadonlySet<string> = new Set([
  '2026-01-15', // Municipal Corporation Election — Maharashtra
  '2026-01-26', // Republic Day
  '2026-03-03', // Holi
  '2026-03-26', // Shri Ram Navami
  '2026-03-31', // Shri Mahavir Jayanti
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Baba Saheb Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-28', // Bakri Id
  '2026-06-26', // Muharram
  '2026-09-14', // Ganesh Chaturthi
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-10', // Diwali-Balipratipada
  '2026-11-24', // Prakash Gurpurb Sri Guru Nanak Dev
  '2026-12-25', // Christmas
])

const MARKET_OPEN_MIN = 9 * 60 + 15 // 09:15 IST
const MARKET_CLOSE_MIN = 15 * 60 + 30 // 15:30 IST

/** Dev/test override: ?live=1 forces the market to be treated as open. */
const FORCE_LIVE =
  typeof location !== 'undefined' && /[?&]live=1(\b|&|$)/.test(location.search)

/** True while the NSE cash market is trading (IST weekdays, 09:15–15:30, non-holiday). */
export function isMarketOpen(date: Date = new Date()): boolean {
  if (FORCE_LIVE) return true
  const ist = new Date(date.getTime() + (5 * 60 + 30) * 60 * 1000) // IST = UTC+5:30
  const day = ist.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  if (minutes < MARKET_OPEN_MIN || minutes >= MARKET_CLOSE_MIN) return false
  if (NSE_HOLIDAYS_2026.has(ist.toISOString().slice(0, 10))) return false
  return true
}

/** The IST calendar date (YYYY-MM-DD) for "has this NAV already been fetched today?" checks. */
export function istDate(date: Date = new Date()): string {
  return new Date(date.getTime() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10)
}

export function marketStatusText(open: boolean, liveCount: number): string {
  if (open && liveCount > 0) return 'Live prices · refreshed every 60s'
  if (open) return 'Market open — fetching live prices…'
  return 'Off-market hours — showing latest known prices'
}

// ---------------------------------------------------------------------------
// Quote keys + price resolution (single source of truth for live + sheet price)
// ---------------------------------------------------------------------------

/** Stable key used for a position in the live-quotes map. */
export function quoteKey(p: Position): string {
  return p.type === 'mutual-fund' ? (p.name || p.ticker).trim() : p.ticker.trim().toUpperCase()
}

/**
 * Effective price for a position: live quote when available, otherwise the
 * sheet's lastPrice, otherwise the buy price (only used as a last resort).
 */
export function livePriceOf(
  p: Position,
  quotes: Record<string, LiveQuote>,
): number | null {
  const q = quotes[quoteKey(p)]
  if (q) return q.price
  return p.lastPrice ?? (p.invested > 0 ? p.buyPrice : null)
}

export function isLiveQuote(p: Position, quotes: Record<string, LiveQuote>): boolean {
  return !!quotes[quoteKey(p)]
}

// ---------------------------------------------------------------------------
// Symbol resolution: imported ticker -> Yahoo symbol
// ---------------------------------------------------------------------------

const YAHOO_ALIASES: Record<string, string> = {
  TATAMOTORS: 'TATAMOTORS.NS',
  'TATA MOTORS': 'TATAMOTORS.NS',
  'TATA STEEL': 'TATASTEEL.NS',
  BHARTIARTL: 'BHARTIARTL.NS',
  'HDFC BANK': 'HDFCBANK.NS',
  'HDFC BANK NIFTY50 ETF': 'HDFCBANK.NS',
  'ICICI BANK': 'ICICIBANK.NS',
  'AXIS BANK': 'AXISBANK.NS',
  'KOTAK BANK': 'KOTAKBANK.NS',
  'INFOSYS (INFY)': 'INFY.NS',
  NIFTYBEES: 'NIFTYBEES.NS',
  NIFTY50BEES: 'NIFTYBEES.NS',
  JUNIORBEES: 'JUNIORBEES.NS',
  BANKBEES: 'BANKBEES.NS',
  'NIFTY 50': '^NSEI',
}

/**
 * Resolve a holding to a Yahoo symbol. Equity/ETF rows with a known ticker map
 * to NSE (.NS) by default; symbols that already carry a suffix pass through.
 * Mutual funds have no intraday Yahoo price — they return null (handled by NAV).
 */
export function resolveYahooSymbol(p: Position): string | null {
  if (p.type === 'mutual-fund') return null
  const raw = p.ticker.trim()
  if (!raw) return null
  const upper = raw.toUpperCase()
  const aliased = YAHOO_ALIASES[upper]
  if (aliased) return aliased
  if (upper.includes('.') || upper.startsWith('^')) return upper
  return `${upper}.NS`
}

// ---------------------------------------------------------------------------
// Yahoo Finance fetch (via the CORS relay; NSE data is ~15-20 min delayed)
// ---------------------------------------------------------------------------

export interface YahooResult {
  price: number
  change: number | null
  pct: number | null
  at: number
}

export async function fetchYahooPrice(symbol: string): Promise<YahooResult | null> {
  const url =
    'https://corsproxy.io/?url=' +
    encodeURIComponent(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    )
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) return null
    const json = (await res.json()) as {
      chart?: {
        result?: {
          meta?: {
            regularMarketPrice?: number
            chartPreviousClose?: number
          }
        }[]
      }
    }
    const meta = json.chart?.result?.[0]?.meta
    const price = meta?.regularMarketPrice
    if (!meta || price == null) return null
    const prev = meta.chartPreviousClose
    const change = prev != null && prev !== 0 ? price - prev : null
    const pct = change != null && prev != null ? (change / prev) * 100 : null
    return { price, change, pct, at: Date.now() }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Mutual-fund NAV (mfapi.in — keyless, CORS-friendly; NAV publishes once daily)
// ---------------------------------------------------------------------------

/** Lowercase + strip everything but letters/digits so scheme names can be compared. */
function normalizeScheme(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function fetchNavByName(schemeName: string): Promise<LiveQuote | null> {
  const target = normalizeScheme(schemeName)
  if (!target) return null
  const pick = (matches: { schemeCode: number; schemeName: string }[]) => {
    const direct = matches.find((m) => normalizeScheme(m.schemeName) === target)
    if (direct) return direct
    const hasDirect = /direct/.test(target)
    const hasGrowth = /growth/.test(target)
    const hasIdcw = /idcw|dividend/.test(target)
    const scored = matches
      .map((m) => {
        const n = normalizeScheme(m.schemeName)
        const isDirect = /direct/.test(n) === hasDirect
        const isGrowth = hasIdcw ? !/idcw|dividend/.test(n) : /growth/.test(n) === hasGrowth
        const len = Math.min(n.length, target.length)
        const sim =
          (len > 0 ? [...target].filter((c, i) => n[i] === c).length / len : 0) +
          (n.includes(target) || target.includes(n) ? 1 : 0)
        return { m, score: sim + (isDirect ? 2 : 0) + (isGrowth ? 1 : 0) }
      })
      .sort((a, b) => b.score - a.score)
    return scored[0]?.score >= 2 ? scored[0].m : undefined
  }

  try {
    const res = await fetch(
      `https://api.mfapi.in/mf/search?q=${encodeURIComponent(schemeName)}`,
      { signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) return null
    const matches = (await res.json()) as { schemeCode: number; schemeName: string }[]
    if (!Array.isArray(matches) || matches.length === 0) return null
    const chosen = pick(matches)
    if (!chosen) return null
    const navRes = await fetch(`https://api.mfapi.in/mf/${chosen.schemeCode}/latest`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!navRes.ok) return null
    const data = (await navRes.json()) as { data?: { nav?: string }[] }
    const nav = Number(data?.data?.[0]?.nav)
    if (!Number.isFinite(nav) || nav <= 0) return null
    return { price: nav, at: Date.now(), source: 'nav' }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Orchestration: refresh all holdings, reusing previous quotes on failure and
// fetching MF NAVs at most once per IST day.
// ---------------------------------------------------------------------------

export async function fetchLiveQuotes(
  positions: Position[],
  prev: Record<string, LiveQuote>,
  opts?: { force?: boolean },
): Promise<{ quotes: Record<string, LiveQuote>; updated: number }> {
  const quotes: Record<string, LiveQuote> = { ...prev }
  let updated = 0
  const today = istDate()

  for (const p of positions) {
    const key = quoteKey(p)
    if (p.type === 'mutual-fund') {
      const existing = prev[key]
      if (!opts?.force && existing && existing.source === 'nav' && istDate(new Date(existing.at)) === today) {
        continue // already fetched today's NAV
      }
      const nav = await fetchNavByName(p.name || p.ticker)
      if (nav) {
        quotes[key] = nav
        updated++
      }
      await delay(120)
      continue
    }

    const symbol = resolveYahooSymbol(p)
    if (!symbol) continue
    const quote = await fetchYahooPrice(symbol)
    if (quote) {
      quotes[key] = { price: quote.price, at: quote.at, source: 'yahoo' }
      updated++
    }
    // keep the previous quote on failure so the board never flashes stale->blank
    await delay(150)
  }

  return { quotes, updated }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Manual-refresh rate limit. Client-only app, so this is best-effort (no
// backend to enforce): 5 manual refreshes per rolling hour with a 5-minute
// minimum gap between two. Persisted to localStorage so it survives reloads.
// ---------------------------------------------------------------------------

const MANUAL_LIMIT_PER_HOUR = 5 // max manual refreshes per rolling hour
const MANUAL_COOLDOWN_MS = 5 * 60 * 1000 // min gap between two manual refreshes
const MANUAL_KEY = 'finverse:manualRefresh'

export interface ManualRefreshResult {
  allowed: boolean
  reason?: 'cooldown' | 'limit'
  retryInMs?: number
}

function loadManualTimes(): number[] {
  try {
    const raw = localStorage.getItem(MANUAL_KEY)
    const arr = raw ? (JSON.parse(raw) as number[]) : []
    return Array.isArray(arr) ? arr.filter((n) => Number.isFinite(n)) : []
  } catch {
    return []
  }
}

/** Check the manual-refresh rate limit without consuming an allowance. */
export function manualRefreshCheck(now: number = Date.now()): ManualRefreshResult {
  const hourAgo = now - 60 * 60 * 1000
  const recent = loadManualTimes().filter((t) => t > hourAgo)
  if (recent.length >= MANUAL_LIMIT_PER_HOUR) {
    return { allowed: false, reason: 'limit', retryInMs: recent[0] + 60 * 60 * 1000 - now }
  }
  const last = recent.length ? Math.max(...recent) : 0
  const sinceLast = now - last
  if (sinceLast < MANUAL_COOLDOWN_MS) {
    return { allowed: false, reason: 'cooldown', retryInMs: MANUAL_COOLDOWN_MS - sinceLast }
  }
  return { allowed: true }
}

/** Record a manual refresh. Only call after manualRefreshCheck() passed. */
export function recordManualRefresh(now: number = Date.now()): void {
  try {
    const hourAgo = now - 60 * 60 * 1000
    const recent = loadManualTimes().filter((t) => t > hourAgo)
    recent.push(now)
    localStorage.setItem(MANUAL_KEY, JSON.stringify(recent))
  } catch {
    /* storage unavailable — allow, best effort */
  }
}
