import type { LiveQuote, Position } from './types'
import { quoteKey } from './valuation'
import { createSharedRequest } from './sharedRequest'
import { isRegularMarketOpen } from './marketCalendar'
import { hasCompatibleFundScheme } from './fundSchemes'
import { normalizePosition } from './instruments'
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
  isRefreshing = false,
  pricesAsOf?: string,
): string {
  if (!externalEnabled) {
    return 'External market data off \u00b7 showing imported prices'
  }
  const marketLabel = open ? 'Market Open' : 'Market Closed'
  if (isRefreshing) return `${marketLabel} - fetching latest available data`
  return `${marketLabel} - ${pricesAsOf ? `showing prices as of ${pricesAsOf}` : 'no provider prices yet'}`
}

// ---------------------------------------------------------------------------
// Quote keys + price resolution (single source of truth for live + sheet price)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Symbol resolution: imported ticker -> Yahoo symbol
// ---------------------------------------------------------------------------

/**
 * Only a supported, resolved listing reaches the provider. Names and uncertain
 * venue/currency metadata remain on imported prices until reviewed.
 */
export function resolveYahooSymbol(p: Position): string | null {
  if (p.type === 'mutual-fund') return null
  const normalized = normalizePosition(p)
  return normalized.identityIssue ? null : normalized.providerSymbol ?? null
}

/** An explicit provider mapping never falls back to a guessed different listing. */
export function resolveYahooSymbolCandidates(position: Position): string[] {
  const primary = resolveYahooSymbol(position)
  return primary ? [primary] : []
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
// Mutual-fund NAV (mfapi.in — keyless, CORS-friendly; NAV publishes once daily)
// ---------------------------------------------------------------------------

function navDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parts = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value)
  if (!parts) return null
  const date = `${parts[3]}-${parts[2]}-${parts[1]}`
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null
}

const sharedNav = createSharedRequest<LiveQuote | null>()

function fetchNavByCode(code: number, signal?: AbortSignal): Promise<LiveQuote | null> {
  return sharedNav(String(code), (requestSignal) => fetchNavUncached(code, requestSignal), signal)
}

async function fetchNavUncached(code: number, signal?: AbortSignal): Promise<LiveQuote | null> {
  try {
    const requestSignal = signal ?? AbortSignal.timeout(12000)
    const history = await fetchNavHistoryUncached(code, undefined, undefined, requestSignal)
    requestSignal.throwIfAborted()
    let latest = history.at(-1)
    if (!latest) {
      const response = await fetch(`https://api.mfapi.in/mf/${code}/latest`, {
        signal: AbortSignal.any([requestSignal, AbortSignal.timeout(10000)]),
      })
      if (!response.ok) return null
      const data = (await response.json()) as { data?: { date?: string; nav?: string }[] }
      latest = navPoints(data.data).at(-1)
    }
    if (!latest) return null
    const { close: nav, date } = latest
    const previous = history.at(-2)
    const change = previous ? nav - previous.close : undefined
    const changePct = previous && change != null ? change / previous.close * 100 : undefined
    const fetchedAt = Date.now()
    return {
      price: nav,
      at: Date.parse(`${date}T00:00:00+05:30`),
      fetchedAt,
      source: 'nav',
      ...(change != null ? { change } : {}),
      ...(changePct != null && Number.isFinite(changePct) ? { changePct } : {}),
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Refresh all holdings, retaining previous quotes on failure.
// Complete current-day NAVs are reused; older publications may still update.
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
  const activeKeys = new Set(positions.filter((position) => position.type === 'mutual-fund'
    ? hasCompatibleFundScheme(position) : Boolean(resolveYahooSymbol(position))).map(quoteKey))
  const quotes: Record<string, LiveQuote> = Object.fromEntries(Object.entries(prev).filter(([key]) => activeKeys.has(key)))
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
      if (!hasCompatibleFundScheme(position)) {
        outcomes.push({ key, status: 'failed' })
        continue
      }
      const existing = prev[key]
      if (
        existing &&
        existing.source === 'nav' &&
        Number.isFinite(existing.change) &&
        istDate(new Date(existing.at)) === today &&
        istDate(new Date(existing.fetchedAt ?? existing.at)) === today
      ) {
        outcomes.push({ key, status: 'skipped' })
      } else {
        if (requestedFund) await delay(NAV_REQUEST_GAP_MS, signal)
        const nav = await fetchNavByCode(position.mfScheme!.code, signal)
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

const parsedHistory = new Map<string, { raw: string; entry: HistoryCacheEntry }>()
const cleanedHistoryStores = new WeakSet<Storage>()

function rememberHistory(key: string, raw: string, entry: HistoryCacheEntry): HistoryCacheEntry {
  if (parsedHistory.size >= 128 && !parsedHistory.has(key)) {
    const oldest = parsedHistory.keys().next().value
    if (oldest) parsedHistory.delete(oldest)
  }
  parsedHistory.set(key, { raw, entry })
  return entry
}

function historyCacheKey(symbol: string): string {
  return `finverse:history:v2:${symbol}`
}

function readHistoryCache(key: string): HistoryCacheEntry | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) { parsedHistory.delete(key); return null }
    const cached = parsedHistory.get(key)
    const entry = cached?.raw === raw ? cached.entry : JSON.parse(raw) as HistoryCacheEntry
    if (!Array.isArray(entry?.points) || !entry.from || !entry.to || !Number.isFinite(entry.at) || Date.now() - entry.at > HISTORY_TTL_MS) return null
    return rememberHistory(key, raw, entry)
  } catch {
    return null
  }
}

function writeHistoryCache(key: string, entry: HistoryCacheEntry): void {
  try {
    if (!cleanedHistoryStores.has(localStorage)) {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const storedKey = localStorage.key(index)
        if (storedKey?.startsWith('finverse:history:') && !storedKey.startsWith('finverse:history:v2:')) localStorage.removeItem(storedKey)
      }
      cleanedHistoryStores.add(localStorage)
    }
    const raw = JSON.stringify(entry)
    localStorage.setItem(key, raw)
    rememberHistory(key, raw, entry)
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
  return points.filter((point) => point.date >= from && point.date <= to).map((point) => ({ ...point }))
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
export function fetchHistory(symbol: string, from: Date, to: Date, signal?: AbortSignal, cacheIdentity = symbol): Promise<HistoryPoint[]> {
  return fetchCachedHistory(cacheIdentity, from, to, (rangeFrom, rangeTo, requestSignal) => fetchHistoryUncached(symbol, rangeFrom, rangeTo, requestSignal), signal)
}

let activeHistoryRequests = 0
const historyWaiters = new Set<() => void>()

async function withHistorySlot<T>(signal: AbortSignal, load: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  while (activeHistoryRequests >= 7) {
    await new Promise<void>((resolve, reject) => {
      const ready = () => { historyWaiters.delete(ready); signal.removeEventListener('abort', abort); resolve() }
      const abort = () => { historyWaiters.delete(ready); reject(signal.reason) }
      historyWaiters.add(ready)
      signal.addEventListener('abort', abort, { once: true })
    })
    signal.throwIfAborted()
  }
  activeHistoryRequests += 1
  try { return await load() }
  finally {
    activeHistoryRequests -= 1
    historyWaiters.values().next().value?.()
  }
}

async function fetchHistoryUncached(symbol: string, from: string, to: string, signal: AbortSignal): Promise<HistoryPoint[]> {
  const params = new URLSearchParams({
    symbol,
    from,
    to,
  })
  try {
    return await withHistorySlot(signal, async () => {
      const res = await fetch(`/api/history?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) })
      if (!res.ok) return []
      const json = (await res.json()) as HistoryPayload
      return (json.points ?? []).filter(
        (point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.close) && point.close > 0,
      )
    })
  } catch {
    return []
  }
}

/** Daily NAV series uses the same saved scheme code as latest NAV. */
export function fetchNavHistory(
  position: Position,
  from: Date,
  to: Date,
  signal?: AbortSignal,
): Promise<HistoryPoint[]> {
  signal?.throwIfAborted()
  if (!hasCompatibleFundScheme(position)) return Promise.resolve([])
  const code = position.mfScheme!.code
  return fetchCachedHistory(`mfapi:${code}`, from, to, (rangeFrom, rangeTo, requestSignal) =>
    fetchNavHistoryUncached(code, rangeFrom, rangeTo, requestSignal), signal)
}

function navPoints(rows: { date?: string; nav?: string }[] = []): HistoryPoint[] {
  const points = new Map<string, HistoryPoint>()
  for (const row of rows) {
    const close = Number(row.nav)
    const date = navDate(row.date)
    if (!date || !Number.isFinite(close) || close <= 0 || points.has(date)) continue
    points.set(date, { date, close })
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date))
}

async function fetchNavHistoryUncached(code: number, from: string | undefined, to: string | undefined, signal: AbortSignal): Promise<HistoryPoint[]> {
  try {
    const res = await fetch(
      `https://api.mfapi.in/mf/${code}${from && to ? `?startDate=${from}&endDate=${to}` : ''}`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) },
    )
    if (!res.ok) return []
    const data = (await res.json()) as { data?: { date?: string; nav?: string }[] }
    return navPoints(data.data)
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
