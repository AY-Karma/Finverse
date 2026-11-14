import { fetchLatestNseClose, type NseCloseState } from './nseClosingPrices.js'
import {
  MAX_MARKET_SYMBOLS,
  isMarketSymbol,
  type MarketQuotePayload,
  type QuoteErrorPayload,
  type QuotesPayload,
} from '../src/marketDataProtocol.js'
import { createRequestBudget, readBoundedText } from './requestBudget.js'
import { createNseSymbolResolver } from './nseSymbolChanges.js'
import { getMarketCalendarInfo } from '../src/marketCalendar.js'

const UPSTREAM_TIMEOUT_MS = 4_000
const YAHOO_SYMBOL_LIMIT = 20
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
const BSE_QUOTES_DISABLED = 'Delayed BSE quotes are disabled. Use a verified NSE pricing mapping.'

interface QuoteHandlerDependencies {
  fetcher: typeof fetch
  now: () => number
}

interface YahooSparkResponse {
  spark?: {
    result?: {
      symbol?: string
      response?: {
        meta?: {
          regularMarketPrice?: number
          regularMarketTime?: number
          chartPreviousClose?: number
          previousClose?: number
        }
      }[]
    }[]
  }
}

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

const CACHE_HEADERS = {
  ...RESPONSE_HEADERS,
  'Vercel-CDN-Cache-Control': 'public, s-maxage=1, must-revalidate',
}

function json(data: unknown, status: number, cache = false): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: cache ? CACHE_HEADERS : RESPONSE_HEADERS,
  })
}

function parseSymbols(request: Request): { symbols: string[] } | { error: string } {
  const raw = new URL(request.url).searchParams.get('symbols')
  if (!raw?.trim()) return { error: 'Provide at least one market symbol.' }
  const requested = raw.split(',').map((symbol) => symbol.trim().toUpperCase())
  if (requested.length > MAX_MARKET_SYMBOLS) {
    return { error: `Request at most ${MAX_MARKET_SYMBOLS} symbols.` }
  }
  if (requested.some((symbol) => !isMarketSymbol(symbol))) {
    return { error: 'Symbols must use a supported market symbol format.' }
  }
  if (requested.every((symbol) => symbol.endsWith('.BO'))) return { error: BSE_QUOTES_DISABLED }
  return { symbols: [...new Set(requested)].sort() }
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function rounded(value: number): number {
  return Number(value.toFixed(10))
}

function movement(price: number, previousClose: number | null) {
  if (!finitePositive(previousClose)) return { change: null, changePct: null }
  const change = rounded(price - previousClose)
  return { change, changePct: rounded((change / previousClose) * 100) }
}

async function fetchYahooQuoteChunk(
  symbols: string[],
  fetcher: typeof fetch,
  signal: AbortSignal,
  now: number,
): Promise<{ quotes: MarketQuotePayload[]; error?: string }> {
  const url = new URL('https://query1.finance.yahoo.com/v7/finance/spark')
  url.searchParams.set('symbols', symbols.join(','))
  url.searchParams.set('range', '1d')
  url.searchParams.set('interval', '1d')

  try {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)])
    const response = await fetcher(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
      },
      signal: deadline,
    })
    if (!response.ok) return { quotes: [], error: `Quote provider returned HTTP ${response.status}.` }
    const payload = JSON.parse(await readBoundedText(response, 1024 * 1024, deadline)) as YahooSparkResponse
    const quotes: MarketQuotePayload[] = []
    for (const item of payload.spark?.result ?? []) {
      const symbol = item.symbol?.toUpperCase()
      const meta = item.response?.[0]?.meta
      if (!symbol || !symbols.includes(symbol) || !meta) continue
      if (!finitePositive(meta.regularMarketPrice) || !finitePositive(meta.regularMarketTime)) continue
      const marketTime = meta.regularMarketTime * 1000
      if (!Number.isFinite(marketTime) || marketTime > now + 300_000) continue
      const previousClose = finitePositive(meta.chartPreviousClose)
        ? meta.chartPreviousClose
        : finitePositive(meta.previousClose)
          ? meta.previousClose
          : null
      quotes.push({
        symbol,
        price: meta.regularMarketPrice,
        previousClose,
        ...movement(meta.regularMarketPrice, previousClose),
        marketTime: new Date(marketTime).toISOString(),
        source: 'yahoo',
      })
    }
    return quotes.length > 0
      ? { quotes }
      : { quotes, error: 'Quote provider returned no usable prices.' }
  } catch {
    return { quotes: [], error: 'Quote provider could not be reached.' }
  }
}

async function fetchYahooQuotes(symbols: string[], fetcher: typeof fetch, signal: AbortSignal, now: number): Promise<{ quotes: MarketQuotePayload[]; error?: string }> {
  const chunks: string[][] = []
  for (let start = 0; start < symbols.length; start += YAHOO_SYMBOL_LIMIT) chunks.push(symbols.slice(start, start + YAHOO_SYMBOL_LIMIT))
  const results: Awaited<ReturnType<typeof fetchYahooQuoteChunk>>[] = []
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(2, chunks.length) }, async () => {
    while (cursor < chunks.length && !signal.aborted) {
      const index = cursor++
      results[index] = await fetchYahooQuoteChunk(chunks[index], fetcher, signal, now)
    }
  }))
  const errors = [...new Set(results.flatMap((result) => result.error ? [result.error] : []))]
  return { quotes: results.flatMap((result) => result.quotes), ...(errors.length ? { error: errors.join(' ') } : {}) }
}

async function nseFallbackQuotes(
  symbols: string[],
  fetcher: typeof fetch,
  now: number,
  state: NseCloseState,
): Promise<MarketQuotePayload[]> {
  const nseSymbols = symbols.filter((symbol) => symbol.endsWith('.NS'))
  if (nseSymbols.length === 0) return []
  const closes = await fetchLatestNseClose(fetcher, now, state)
  return nseSymbols.flatMap((symbol) => {
    const close = closes.get(symbol.slice(0, -3))
    if (!close) return []
    return [{
      symbol,
      price: close.price,
      previousClose: close.previousClose,
      ...movement(close.price, close.previousClose),
      marketTime: close.marketTime,
      source: 'nse-close' as const,
    }]
  })
}

function providerFor(quotes: MarketQuotePayload[]): QuotesPayload['provider'] {
  const sources = new Set(quotes.map((quote) => quote.source))
  if (sources.size > 1) return 'mixed'
  return sources.has('nse-close') ? 'nse-official-close' : 'yahoo-unofficial'
}

export function createQuoteHandler(
  dependencies: Partial<QuoteHandlerDependencies> = {},
): (request: Request) => Promise<Response> {
  const fetcher = dependencies.fetcher ?? fetch
  const now = dependencies.now ?? Date.now
  const budget = createRequestBudget(now)
  const nseState: NseCloseState = {}
  const resolveNseSymbol = createNseSymbolResolver(fetcher, now)

  return async (request: Request) => {
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405)
    const parsed = parseSymbols(request)
    if ('error' in parsed) return json({ error: parsed.error }, 400)

    return budget(parsed.symbols.join(','), 1_000, async (signal) => {
      const started = Date.now()
      const fetchedAt = now()
      const yahoo = await fetchYahooQuotes(parsed.symbols.filter((symbol) => !symbol.endsWith('.BO')), fetcher, signal, fetchedAt)
      const calendar = getMarketCalendarInfo(new Date(fetchedAt))
      const completedDate = calendar.available && calendar.lastSessionClose
        ? new Date(calendar.lastSessionClose.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10) : null
      const isCurrent = (quote: MarketQuotePayload) => !quote.symbol.endsWith('.NS') || !completedDate
        || new Date(Date.parse(quote.marketTime) + IST_OFFSET_MS).toISOString().slice(0, 10) >= completedDate
      const stale = new Set(yahoo.quotes.filter((quote) => !isCurrent(quote)).map((quote) => quote.symbol))
      const available = new Map<string, MarketQuotePayload & { resolvedSymbol?: string }>(yahoo.quotes.filter(isCurrent).map((quote) => [quote.symbol, quote]))
      const missing = parsed.symbols.filter((symbol) => symbol.endsWith('.NS') && !available.has(symbol))
      if (missing.length && available.size === 0) {
        const controller = new AbortController()
        const recoverySignal = AbortSignal.any([signal, controller.signal])
        const recover = async () => {
          const renames = Promise.all(missing.map(async (symbol) => ({ symbol, current: await resolveNseSymbol(symbol).catch(() => null) })))
          const fallback = await nseFallbackQuotes(missing, fetcher, fetchedAt, nseState)
          if (recoverySignal.aborted) return
          for (const quote of fallback) if (isCurrent(quote) && !available.has(quote.symbol)) available.set(quote.symbol, quote)
          const changed = (await renames).filter((item): item is { symbol: string; current: string } => !!item.current && !available.has(item.symbol))
          if (recoverySignal.aborted || !changed.length) return
          const currentSymbols = [...new Set(changed.map((item) => item.current))]
          const retried = await fetchYahooQuotes(currentSymbols, fetcher, recoverySignal, fetchedAt)
          if (recoverySignal.aborted) return
          const currentQuotes = new Map(retried.quotes.filter(isCurrent).map((quote) => [quote.symbol, quote]))
          const recordResolved = () => {
            for (const { symbol, current } of changed) {
              const quote = currentQuotes.get(current)
              if (quote && !available.has(symbol)) available.set(symbol, { ...quote, symbol, resolvedSymbol: current })
            }
          }
          recordResolved()
          const stillMissing = currentSymbols.filter((symbol) => !currentQuotes.has(symbol))
          if (stillMissing.length) {
            const currentFallback = await nseFallbackQuotes(stillMissing, fetcher, fetchedAt, nseState)
            if (recoverySignal.aborted) return
            for (const quote of currentFallback) if (isCurrent(quote)) currentQuotes.set(quote.symbol, quote)
            recordResolved()
          }
        }
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            recover().catch(() => {}),
            new Promise<void>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve() }, Math.max(0, 8_000 - (Date.now() - started))) }),
          ])
        } finally {
          clearTimeout(timer)
          controller.abort()
        }
      }
      const quotes = [...available.values()]
      const returned = new Set(quotes.map((quote) => quote.symbol))
      const errors: QuoteErrorPayload[] = parsed.symbols
        .filter((symbol) => !returned.has(symbol))
        .map((symbol) => ({
          symbol,
          message: symbol.endsWith('.BO') ? BSE_QUOTES_DISABLED : stale.has(symbol) ? `The provider quote is older than the last completed NSE session (${completedDate}).` : yahoo.error ?? 'No quote returned by the provider.',
        }))
      const payload: QuotesPayload = {
        provider: providerFor(quotes),
        fetchedAt: new Date(fetchedAt).toISOString(),
        quotes,
        errors,
      }
      return json(payload, quotes.length > 0 ? 200 : 502, quotes.length > 0)
    })
  }
}

export const handleQuoteRequest = createQuoteHandler()

export default { fetch: handleQuoteRequest }
