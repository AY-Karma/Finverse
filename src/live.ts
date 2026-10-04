import type { FxRate, LiveQuote, Position } from './types'
import { quoteKey } from './valuation'
import { createSharedRequest } from './sharedRequest'
import { isRegularMarketOpen } from './marketCalendar'
import {
  MAX_MARKET_SYMBOLS,
  isMarketSymbol,
  type EquityQuoteSource,
  type HistoryPayload,
  type MarketQuotePayload,
  type QuotesPayload,
} from './marketDataProtocol'

// ---------------------------------------------------------------------------
// Indian market hours + NSE trading holidays (IST). Polling runs only while the
// market is actually open so we don't hammer the quote APIs off-hours.
// ---------------------------------------------------------------------------

/** Dev/test override: ?live=1 forces the market to be treated as open. */
const FORCE_LIVE =
  typeof location !== 'undefined' && /[?&]live=1(\b|&|$)/.test(location.search)

/** True while the NSE cash market is trading (IST weekdays, 09:15–15:30, non-holiday). */
export function isMarketOpen(date: Date = new Date()): boolean {
  return FORCE_LIVE || isRegularMarketOpen(date)
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
  pricesAsOf?: string,
): string {
  if (!externalEnabled) {
    return fxReady
      ? 'External market data off · showing imported prices'
      : 'External market data off · enable it for USD display'
  }
  const marketLabel = open ? 'Market Open' : 'Market Closed'
  if (isRefreshing) return `${marketLabel} - fetching latest available data`
  if (!fxReady) return 'Waiting for USD/INR rate…'
  return `${marketLabel} - ${pricesAsOf ? `showing prices as of ${pricesAsOf}` : 'showing latest available prices'}`
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
// Equity quotes. The same-origin server endpoint batches and validates symbols,
// then normalizes provider timestamps before anything reaches portfolio state.
// ---------------------------------------------------------------------------

interface YahooResult {
  price: number
  change: number | null
  pct: number | null
  at: number
  fetchedAt: number
  source: EquityQuoteSource
}

function quoteFromPayload(payload: MarketQuotePayload, fetchedAt: number): YahooResult | null {
  const at = Date.parse(payload.marketTime)
  if (
    !Number.isFinite(payload.price) ||
    payload.price <= 0 ||
    !Number.isFinite(at) ||
    (payload.source !== 'yahoo' && payload.source !== 'nse-close')
  ) return null
  return {
    price: payload.price,
    change: payload.change,
    pct: payload.changePct,
    at,
    fetchedAt,
    source: payload.source,
  }
}

const sharedQuoteBatch = createSharedRequest<Map<string, YahooResult>>()
const QUOTE_REQUEST_CONCURRENCY = 4

async function fetchQuoteBatch(batch: string[], signal: AbortSignal): Promise<Map<string, YahooResult>> {
  const quotes = new Map<string, YahooResult>()
  const params = new URLSearchParams({ symbols: batch.join(',') })
  try {
    const response = await fetch(`/api/quotes?${params}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    })
    if (!response.ok) return quotes
    const payload = (await response.json()) as QuotesPayload
    const fetchedAt = Date.parse(payload.fetchedAt)
    if (!Number.isFinite(fetchedAt)) return quotes
    for (const item of payload.quotes ?? []) {
      const quote = quoteFromPayload(item, fetchedAt)
      if (quote && batch.includes(item.symbol)) quotes.set(item.symbol, quote)
    }
  } catch {
    signal.throwIfAborted()
  }
  return quotes
}

async function fetchYahooPrices(symbols: string[], signal?: AbortSignal): Promise<Map<string, YahooResult>> {
  const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()).filter(isMarketSymbol))].sort()
  const quotes = new Map<string, YahooResult>()
  let next = 0
  const worker = async () => {
    while (next < unique.length) {
      signal?.throwIfAborted()
      const start = next
      next += MAX_MARKET_SYMBOLS
      const batch = unique.slice(start, start + MAX_MARKET_SYMBOLS)
      const results = await sharedQuoteBatch(batch.join(','), (requestSignal) => fetchQuoteBatch(batch, requestSignal), signal)
      for (const [symbol, quote] of results) quotes.set(symbol, quote)
    }
  }
  await Promise.all(Array.from({ length: Math.min(QUOTE_REQUEST_CONCURRENCY, Math.ceil(unique.length / MAX_MARKET_SYMBOLS)) }, worker))
  return quotes
}

export async function fetchYahooPrice(symbol: string, signal?: AbortSignal): Promise<YahooResult | null> {
  const normalized = symbol.toUpperCase()
  return (await fetchYahooPrices([normalized], signal)).get(normalized) ?? null
}

// ---------------------------------------------------------------------------
// USD/INR conversion (portfolio imports are INR-denominated)
// ---------------------------------------------------------------------------

/** Fetch a short-lived conversion rate used only for display conversion. */
export async function fetchUsdInrRate(signal?: AbortSignal): Promise<FxRate | null> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR', {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { date?: string; rates?: { INR?: number } }
    const usdInr = json.rates?.INR
    if (usdInr == null || !Number.isFinite(usdInr) || usdInr <= 0) return null
    const publishedAt = json.date ? Date.parse(`${json.date}T00:00:00Z`) : Number.NaN
    return { usdInr, at: Number.isFinite(publishedAt) ? publishedAt : Date.now() }
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
async function resolveScheme(schemeName: string, signal?: AbortSignal): Promise<number | null> {
  const target = normalizeScheme(schemeName)
  if (!target) return null
  try {
    const res = await fetch(
      `https://api.mfapi.in/mf/search?q=${encodeURIComponent(schemeName)}`,
      { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) },
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

const sharedNav = createSharedRequest<LiveQuote | null>()

function fetchNavByName(schemeName: string, signal?: AbortSignal): Promise<LiveQuote | null> {
  return sharedNav(normalizeScheme(schemeName), (requestSignal) => fetchNavUncached(schemeName, requestSignal), signal)
}

async function fetchNavUncached(schemeName: string, signal?: AbortSignal): Promise<LiveQuote | null> {
  const code = await resolveScheme(schemeName, signal)
  if (code == null) return null
  try {
    const navRes = await fetch(`https://api.mfapi.in/mf/${code}/latest`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    })
    if (!navRes.ok) return null
    const data = (await navRes.json()) as { data?: { date?: string; nav?: string }[] }
    const latest = data?.data?.[0]
    const nav = Number(latest?.nav)
    if (!Number.isFinite(nav) || nav <= 0) return null
    const [day, month, year] = latest?.date?.split('-') ?? []
    const navAt = day && month && year
      ? Date.parse(`${year}-${month}-${day}T00:00:00+05:30`)
      : Number.NaN
    const fetchedAt = Date.now()
    return {
      price: nav,
      at: Number.isFinite(navAt) ? navAt : fetchedAt,
      fetchedAt,
      source: 'nav',
    }
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

export function quoteRefreshIssueText(result: LiveQuotesResult | null): string | null {
  if (!result || result.failed === 0) return null
  if (result.updated > 0) {
    return `${result.failed} quote${result.failed === 1 ? '' : 's'} retained from previous or imported values.`
  }
  return 'Latest quotes could not be reached. Showing previous or imported prices.'
}

const NAV_REQUEST_CONCURRENCY = 2
const NAV_REQUEST_GAP_MS = 750

export async function fetchLiveQuotes(
  positions: Position[],
  prev: Record<string, LiveQuote>,
  signal?: AbortSignal,
): Promise<LiveQuotesResult> {
  const quotes: Record<string, LiveQuote> = { ...prev }
  const today = istDate()

  // combinePositions normally makes this unique already, but keeping the
  // network module defensive avoids duplicate provider calls for raw callers.
  const unique = Array.from(new Map(positions.map((p) => [quoteKey(p), p])).values())
  type Outcome = { key: string; quote?: LiveQuote; status: 'updated' | 'failed' | 'skipped' }
  const outcomes: Outcome[] = []

  const equities = unique.flatMap((position) => {
    if (position.type === 'mutual-fund') return []
    const candidates = resolveYahooSymbolCandidates(position)
    return candidates.length > 0 ? [{ position, candidates }] : []
  })
  const primaryQuotes = await fetchYahooPrices(equities.map(({ candidates }) => candidates[0]), signal)
  const retrySymbols = equities.flatMap(({ candidates }) =>
    !primaryQuotes.has(candidates[0]) && candidates[1] ? [candidates[1]] : [],
  )
  const retryQuotes = await fetchYahooPrices(retrySymbols, signal)
  for (const { position, candidates } of equities) {
    const key = quoteKey(position)
    const quote = primaryQuotes.get(candidates[0]) ?? retryQuotes.get(candidates[1])
    outcomes.push(quote
      ? {
          key,
          quote: {
            price: quote.price,
            at: quote.at,
            fetchedAt: quote.fetchedAt,
            source: quote.source,
            change: quote.change,
            changePct: quote.pct,
          },
          status: 'updated',
        }
      : { key, status: 'failed' })
  }
  for (const position of unique) {
    if (position.type !== 'mutual-fund' && !resolveYahooSymbol(position)) {
      outcomes.push({ key: quoteKey(position), status: 'skipped' })
    }
  }

  const funds = unique.filter((position) => position.type === 'mutual-fund')
  let nextFund = 0
  const worker = async () => {
    let requestedFund = false
    while (nextFund < funds.length) {
      signal?.throwIfAborted()
      const position = funds[nextFund++]
      const key = quoteKey(position)
      const existing = prev[key]
      if (
        existing &&
        existing.source === 'nav' &&
        istDate(new Date(existing.fetchedAt ?? existing.at)) === today
      ) {
        outcomes.push({ key, status: 'skipped' })
      } else {
        if (requestedFund) await delay(NAV_REQUEST_GAP_MS, signal)
        const nav = await fetchNavByName(position.name || position.ticker, signal)
        signal?.throwIfAborted()
        requestedFund = true
        outcomes.push(nav
          ? { key, quote: nav, status: 'updated' }
          : { key, status: 'failed' })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(NAV_REQUEST_CONCURRENCY, funds.length) }, () => worker()))

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

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

// ---------------------------------------------------------------------------
// Historical price series (daily) for the price-history chart: equities use
// the constrained same-origin history endpoint, mutual funds use
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
const sharedHistory = createSharedRequest<{ from: string; to: string; points: HistoryPoint[] }>()

interface HistoryCacheEntry {
  from: string
  to: string
  points: HistoryPoint[]
  at: number
}

function historyCacheKey(symbol: string): string {
  return `finverse:history:v2:${symbol}`
}

function readHistoryCache(key: string): HistoryCacheEntry | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as HistoryCacheEntry
    if (!Array.isArray(entry?.points) || !entry.from || !entry.to || !Number.isFinite(entry.at) || Date.now() - entry.at > HISTORY_TTL_MS) return null
    return entry
  } catch {
    return null
  }
}

function writeHistoryCache(key: string, entry: HistoryCacheEntry): void {
  try {
    const legacyPrefix = key.replace('finverse:history:v2:', 'finverse:history:') + ':'
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const storedKey = localStorage.key(index)
      if (storedKey?.startsWith(legacyPrefix)) localStorage.removeItem(storedKey)
    }
    localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    /* storage unavailable or full — refetch next time */
  }
}

function adjacentDay(date: string, offset: number): string {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + offset)
  return day.toISOString().slice(0, 10)
}

function historyInRange(points: HistoryPoint[], from: string, to: string): HistoryPoint[] {
  return points.filter((point) => point.date >= from && point.date <= to)
}

function fetchCachedHistory(
  symbol: string,
  from: Date,
  to: Date,
  fetchRange: (from: string, to: string, signal: AbortSignal) => Promise<HistoryPoint[]>,
  signal?: AbortSignal,
): Promise<HistoryPoint[]> {
  signal?.throwIfAborted()
  const fromS = istDate(from)
  const toS = istDate(to)
  const key = historyCacheKey(symbol)
  const cached = readHistoryCache(key)
  if (cached && cached.from <= fromS && cached.to >= toS) {
    return Promise.resolve(historyInRange(cached.points, fromS, toS))
  }

  return sharedHistory(key, async (requestSignal) => {
    const ranges: [string, string][] = cached
      ? [
          ...(fromS < cached.from ? [[fromS, adjacentDay(cached.from, -1)] as [string, string]] : []),
          ...(toS > cached.to ? [[adjacentDay(cached.to, 1), toS] as [string, string]] : []),
        ]
      : [[fromS, toS]]
    let next = cached ?? { from: fromS, to: toS, points: [], at: Date.now() }
    for (const [rangeFrom, rangeTo] of ranges) {
      const points = await fetchRange(rangeFrom, rangeTo, requestSignal)
      requestSignal.throwIfAborted()
      if (points.length === 0) continue
      next = {
        from: rangeFrom < next.from ? rangeFrom : next.from,
        to: rangeTo > next.to ? rangeTo : next.to,
        points: [...new Map([...next.points, ...points].map((point) => [point.date, point])).values()]
          .sort((a, b) => a.date.localeCompare(b.date)),
        at: Date.now(),
      }
    }
    if (next.points.length > 0) writeHistoryCache(key, next)
    return { from: fromS, to: toS, points: historyInRange(next.points, fromS, toS) }
  }, signal).then((result) => result.from === fromS && result.to === toS
    ? result.points
    : fetchCachedHistory(symbol, from, to, fetchRange, signal))
}

/** Daily close series for an equity/ETF market symbol. */
export function fetchHistory(symbol: string, from: Date, to: Date, signal?: AbortSignal): Promise<HistoryPoint[]> {
  return fetchCachedHistory(symbol, from, to, (rangeFrom, rangeTo, requestSignal) => fetchHistoryUncached(symbol, rangeFrom, rangeTo, requestSignal), signal)
}

async function fetchHistoryUncached(symbol: string, from: string, to: string, signal: AbortSignal): Promise<HistoryPoint[]> {
  const params = new URLSearchParams({
    symbol,
    from,
    to,
  })
  try {
    const res = await fetch(`/api/history?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) })
    if (!res.ok) return []
    const json = (await res.json()) as HistoryPayload
    const points = (json.points ?? []).filter(
      (point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.close) && point.close > 0,
    )
    return points
  } catch {
    return []
  }
}

/** Daily NAV series for a mutual-fund scheme, matched by name via mfapi.in. */
export function fetchNavHistory(
  schemeName: string,
  from: Date,
  to: Date,
  signal?: AbortSignal,
): Promise<HistoryPoint[]> {
  return fetchCachedHistory(`mf:${normalizeScheme(schemeName)}`, from, to, (rangeFrom, rangeTo, requestSignal) =>
    fetchNavHistoryUncached(schemeName, rangeFrom, rangeTo, requestSignal), signal)
}

async function fetchNavHistoryUncached(schemeName: string, from: string, to: string, signal: AbortSignal): Promise<HistoryPoint[]> {
  const code = await resolveScheme(schemeName, signal)
  if (code == null) return []
  try {
    const res = await fetch(
      `https://api.mfapi.in/mf/${code}?startDate=${from}&endDate=${to}`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) },
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
