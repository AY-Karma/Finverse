import type { FxRate, LiveQuote, Position } from './types'
import { quoteKey } from './valuation'

// ---------------------------------------------------------------------------
// Indian market hours + NSE trading holidays (IST). Polling runs only while the
// market is actually open so we don't hammer the quote APIs off-hours.
// ---------------------------------------------------------------------------

/** NSE trading holidays 2026 (weekday closures only; weekends are closed anyway). */
const NSE_HOLIDAYS_2026: ReadonlySet<string> = new Set([
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

const NSE_HOLIDAYS_BY_YEAR: Readonly<Record<string, ReadonlySet<string>>> = {
  '2026': NSE_HOLIDAYS_2026,
}

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
  const calendarDate = ist.toISOString().slice(0, 10)
  const holidays = NSE_HOLIDAYS_BY_YEAR[calendarDate.slice(0, 4)]
  // Fail closed when this client does not have a maintained holiday calendar
  // for the requested year.
  if (!holidays || holidays.has(calendarDate)) return false
  return true
}

/** The IST calendar date (YYYY-MM-DD) for "has this NAV already been fetched today?" checks. */
function istDate(date: Date = new Date()): string {
  return new Date(date.getTime() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10)
}

export function marketStatusText(
  open: boolean,
  externalEnabled = true,
  fxReady = true,
  isRefreshing = false,
): string {
  if (!externalEnabled) {
    return fxReady
      ? 'External market data off · showing imported prices'
      : 'External market data off · enable it for USD display'
  }
  if (!fxReady) return 'Waiting for USD/INR rate…'
  if (open && isRefreshing) return 'Live Market - fetching latest prices'
  if (open) return 'Live Market - showing latest prices'
  if (!open && isRefreshing) return 'Off-market hours — fetching latest prices'
  return 'Off-market hours — showing latest known prices'
}

// ---------------------------------------------------------------------------
// Quote keys + price resolution (single source of truth for live + sheet price)
// ---------------------------------------------------------------------------

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
 * NSE series suffixes (-EQ, -BE, -SM, -ST, -T, -BL, -Z, -E, -B, -N, -W) are stripped before
 * appending .NS (e.g. "KRN-T" → "KRN.NS", "MON100-E" → "MON100.NS").
 * Mutual funds have no intraday Yahoo price — they return null (handled by NAV).
 */
export function resolveYahooSymbol(p: Position): string | null {
  if (p.type === 'mutual-fund') return null
  if (p.providerSymbol) return p.providerSymbol
  const raw = p.ticker.trim()
  if (!raw) return null
  const upper = raw.toUpperCase()
  const aliased = YAHOO_ALIASES[upper]
  if (aliased) return aliased
  if (upper.includes('.') || upper.startsWith('^')) return upper
  // Strip NSE series suffixes (e.g. KRN-T → KRN, RELIANCE-EQ → RELIANCE, MON100-E → MON100)
  const suffixPattern = /-(EQ|BE|SM|ST|T|BL|Z|E|B|N|W)$/
  const withoutSeries = upper.replace(suffixPattern, '')
  if (p.exchange === 'BSE') return `${withoutSeries}.BO`
  if (p.exchange === 'NASDAQ' || p.exchange === 'NYSE' || p.exchange === 'LSE') return withoutSeries
  return `${withoutSeries}.NS`
}

/** Ordered provider candidates; adapters can fall back without leaking symbol syntax into views. */
export function resolveYahooSymbolCandidates(position: Position): string[] {
  if (position.type === 'mutual-fund') return []
  const primary = resolveYahooSymbol(position)
  const inferred = resolveYahooSymbol({ ...position, providerSymbol: undefined })
  return Array.from(new Set([primary, inferred].filter((symbol): symbol is string => Boolean(symbol))))
}

// ---------------------------------------------------------------------------
// Yahoo Finance fetch (via the CORS relay; NSE data is ~15-20 min delayed)
// ---------------------------------------------------------------------------

interface YahooResult {
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
// USD/INR conversion (portfolio imports are INR-denominated)
// ---------------------------------------------------------------------------

/** Fetch a short-lived conversion rate used only for display conversion. */
export async function fetchUsdInrRate(): Promise<FxRate | null> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR', {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { rates?: { INR?: number } }
    const usdInr = json.rates?.INR
    if (usdInr == null || !Number.isFinite(usdInr) || usdInr <= 0) return null
    return { usdInr, at: Date.now() }
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

/** Pick the best-matching scheme from a mfapi search result for a normalized target. */
function pickScheme(
  matches: { schemeCode: number; schemeName: string }[],
  target: string,
): { schemeCode: number; schemeName: string } | undefined {
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

/** Resolve a scheme name to its mfapi.in scheme code via the search endpoint. */
async function resolveScheme(schemeName: string): Promise<number | null> {
  const target = normalizeScheme(schemeName)
  if (!target) return null
  try {
    const res = await fetch(
      `https://api.mfapi.in/mf/search?q=${encodeURIComponent(schemeName)}`,
      { signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) return null
    const matches = (await res.json()) as { schemeCode: number; schemeName: string }[]
    if (!Array.isArray(matches) || matches.length === 0) return null
    const chosen = pickScheme(matches, target)
    return chosen ? chosen.schemeCode : null
  } catch {
    return null
  }
}

async function fetchNavByName(schemeName: string): Promise<LiveQuote | null> {
  const code = await resolveScheme(schemeName)
  if (code == null) return null
  try {
    const navRes = await fetch(`https://api.mfapi.in/mf/${code}/latest`, {
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

export interface LiveQuotesResult {
  quotes: Record<string, LiveQuote>
  updated: number
  failed: number
  skipped: number
}

const QUOTE_REQUEST_CONCURRENCY = 2
const QUOTE_REQUEST_GAP_MS = 750

export async function fetchLiveQuotes(
  positions: Position[],
  prev: Record<string, LiveQuote>,
): Promise<LiveQuotesResult> {
  const quotes: Record<string, LiveQuote> = { ...prev }
  const today = istDate()

  // combinePositions normally makes this unique already, but keeping the
  // network module defensive avoids duplicate relay calls for raw callers.
  const unique = Array.from(new Map(positions.map((p) => [quoteKey(p), p])).values())
  type Outcome = { key: string; quote?: LiveQuote; status: 'updated' | 'failed' | 'skipped' }

  const fetchOne = async (p: Position): Promise<Outcome> => {
    const key = quoteKey(p)
    if (p.type === 'mutual-fund') {
      const existing = prev[key]
      if (existing && existing.source === 'nav' && istDate(new Date(existing.at)) === today) {
        return { key, status: 'skipped' } // already fetched today's NAV
      }
      const nav = await fetchNavByName(p.name || p.ticker)
      return nav ? { key, quote: nav, status: 'updated' } : { key, status: 'failed' }
    }

    const symbol = resolveYahooSymbol(p)
    if (!symbol) return { key, status: 'skipped' }
    const quote = await fetchYahooPrice(symbol)
    // Keep the previous quote on failure so the board never flashes stale->blank.
    return quote
      ? { key, quote: { price: quote.price, at: quote.at, source: 'yahoo', change: quote.change, changePct: quote.pct }, status: 'updated' }
      : { key, status: 'failed' }
  }

  let next = 0
  const outcomes: Outcome[] = []
  const worker = async () => {
    while (next < unique.length) {
      const p = unique[next++]
      outcomes.push(await fetchOne(p))
      await delay(QUOTE_REQUEST_GAP_MS)
    }
  }
  await Promise.all(Array.from({ length: Math.min(QUOTE_REQUEST_CONCURRENCY, unique.length) }, () => worker()))

  for (const outcome of outcomes) {
    if (outcome.quote) quotes[outcome.key] = outcome.quote
  }
  return {
    quotes,
    updated: outcomes.filter((o) => o.status === 'updated').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Historical price series (daily) for the price-history chart: equities use
// Yahoo's chart endpoint (same CORS relay as live quotes), mutual funds use
// mfapi.in's NAV history. Daily data only changes once a day, so each
// symbol+range result is cached for 24h and reused across visits.
// ---------------------------------------------------------------------------

export interface HistoryPoint {
  /** Trading date as YYYY-MM-DD. */
  date: string
  /** Daily close (equity) or NAV (mutual fund). */
  close: number
}

const HISTORY_TTL_MS = 24 * 60 * 60 * 1000
const historyRequests = new Map<string, Promise<HistoryPoint[]>>()

function historyCacheKey(symbol: string, from: string, to: string): string {
  return `finverse:history:${symbol}:${from}:${to}`
}

function readHistoryCache(key: string): HistoryPoint[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const v = JSON.parse(raw) as { points: HistoryPoint[]; at: number }
    if (!Array.isArray(v?.points) || Date.now() - v.at > HISTORY_TTL_MS) return null
    return v.points
  } catch {
    return null
  }
}

function writeHistoryCache(key: string, points: HistoryPoint[]): void {
  try {
    localStorage.setItem(key, JSON.stringify({ points, at: Date.now() }))
  } catch {
    /* storage unavailable or full — refetch next time */
  }
}

/** Daily close series for an equity/ETF Yahoo symbol, via the CORS relay. */
export function fetchHistory(
  symbol: string,
  from: Date,
  to: Date,
): Promise<HistoryPoint[]> {
  const fromS = istDate(from)
  const toS = istDate(to)
  const key = historyCacheKey(symbol, fromS, toS)
  const cached = readHistoryCache(key)
  if (cached) return Promise.resolve(cached)

  const existing = historyRequests.get(key)
  if (existing) return existing

  const request = fetchHistoryUncached(symbol, from, to, key)
  historyRequests.set(key, request)
  void request.finally(() => historyRequests.delete(key))
  return request
}

async function fetchHistoryUncached(symbol: string, from: Date, to: Date, key: string): Promise<HistoryPoint[]> {

  const url =
    'https://corsproxy.io/?url=' +
    encodeURIComponent(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?period1=${Math.floor(from.getTime() / 1000)}&period2=${Math.floor(to.getTime() / 1000)}&interval=1d`,
    )
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) return []
    const json = (await res.json()) as {
      chart?: {
        result?: {
          timestamp?: number[]
          indicators?: { quote?: { close?: (number | null)[] }[] }
        }[]
      }
    }
    const timestamps = json.chart?.result?.[0]?.timestamp
    const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    if (!Array.isArray(timestamps) || !Array.isArray(closes)) return []
    const points: HistoryPoint[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i]
      if (close == null || !Number.isFinite(close) || close <= 0) continue
      points.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        close,
      })
    }
    writeHistoryCache(key, points)
    return points
  } catch {
    return []
  }
}

/** Daily NAV series for a mutual-fund scheme, matched by name via mfapi.in. */
export async function fetchNavHistory(
  schemeName: string,
  from: Date,
  to: Date,
): Promise<HistoryPoint[]> {
  const fromS = istDate(from)
  const toS = istDate(to)
  const key = historyCacheKey(`mf:${normalizeScheme(schemeName)}`, fromS, toS)
  const cached = readHistoryCache(key)
  if (cached) return cached

  const code = await resolveScheme(schemeName)
  if (code == null) return []
  try {
    const res = await fetch(
      `https://api.mfapi.in/mf/${code}?startDate=${fromS}&endDate=${toS}`,
      { signal: AbortSignal.timeout(12000) },
    )
    if (!res.ok) return []
    const data = (await res.json()) as { data?: { date?: string; nav?: string }[] }
    const points: HistoryPoint[] = []
    for (const row of data?.data ?? []) {
      const nav = Number(row.nav)
      if (!row.date || !Number.isFinite(nav) || nav <= 0) continue
      const [dd, mm, yyyy] = row.date.split('-') // mfapi returns DD-MM-YYYY
      if (!dd || !mm || !yyyy) continue
      points.push({ date: `${yyyy}-${mm}-${dd}`, close: nav })
    }
    // mfapi returns newest-first; we want ascending so the chart reads left→right.
    points.sort((a, b) => a.date.localeCompare(b.date))
    writeHistoryCache(key, points)
    return points
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Manual refresh cooldown. Persisted so a reload cannot bypass the short gap.
// ---------------------------------------------------------------------------

export const MANUAL_REFRESH_COOLDOWN_MS = 30_000
const MANUAL_KEY = 'finverse:manualRefresh'

interface ManualRefreshResult {
  allowed: boolean
  reason?: 'cooldown'
  retryInMs?: number
}

function loadLastManualRefresh(): number {
  try {
    const raw = localStorage.getItem(MANUAL_KEY)
    if (!raw) return 0
    const saved = JSON.parse(raw) as number | number[]
    if (Number.isFinite(saved)) return Number(saved)
    if (Array.isArray(saved)) {
      const valid = saved.filter((value) => Number.isFinite(value))
      return valid.length ? Math.max(...valid) : 0
    }
    return 0
  } catch {
    return 0
  }
}

export function manualRefreshCheck(now: number = Date.now()): ManualRefreshResult {
  const elapsed = now - loadLastManualRefresh()
  if (elapsed < MANUAL_REFRESH_COOLDOWN_MS) {
    return { allowed: false, reason: 'cooldown', retryInMs: MANUAL_REFRESH_COOLDOWN_MS - elapsed }
  }
  return { allowed: true }
}

export function recordManualRefresh(now: number = Date.now()): void {
  try {
    localStorage.setItem(MANUAL_KEY, JSON.stringify(now))
  } catch {
    /* storage unavailable — allow refreshes */
  }
}
