import {
  MAX_MARKET_SYMBOLS,
  isMarketSymbol,
  type MarketQuotePayload,
  type QuoteErrorPayload,
  type QuotesPayload,
} from '../src/marketDataProtocol'

const UPSTREAM_TIMEOUT_MS = 8_000
const NSE_CLOSE_CACHE_MS = 60 * 60 * 1000
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

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

interface NseClose {
  price: number
  previousClose: number | null
  marketTime: string
}

let nseCloseCache:
  | { expiresAt: number; prices: Map<string, NseClose> }
  | undefined

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

const CACHE_HEADERS = {
  ...RESPONSE_HEADERS,
  'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=240',
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

async function fetchYahooQuotes(
  symbols: string[],
  fetcher: typeof fetch,
): Promise<{ quotes: MarketQuotePayload[]; error?: string }> {
  const url = new URL('https://query1.finance.yahoo.com/v7/finance/spark')
  url.searchParams.set('symbols', symbols.join(','))
  url.searchParams.set('range', '1d')
  url.searchParams.set('interval', '1d')

  try {
    const response = await fetcher(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (!response.ok) return { quotes: [], error: `Quote provider returned HTTP ${response.status}.` }
    const payload = (await response.json()) as YahooSparkResponse
    const quotes: MarketQuotePayload[] = []
    for (const item of payload.spark?.result ?? []) {
      const symbol = item.symbol?.toUpperCase()
      const meta = item.response?.[0]?.meta
      if (!symbol || !symbols.includes(symbol) || !meta) continue
      if (!finitePositive(meta.regularMarketPrice) || !finitePositive(meta.regularMarketTime)) continue
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
        marketTime: new Date(meta.regularMarketTime * 1000).toISOString(),
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

function reportCandidates(now: number): string[] {
  const ist = new Date(now + IST_OFFSET_MS)
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  const firstOffset = minutes >= 17 * 60 ? 0 : 1
  const dates: string[] = []
  for (let offset = firstOffset; offset < firstOffset + 8; offset += 1) {
    const candidate = new Date(ist)
    candidate.setUTCDate(candidate.getUTCDate() - offset)
    if (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) continue
    const yyyy = candidate.getUTCFullYear()
    const mm = String(candidate.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(candidate.getUTCDate()).padStart(2, '0')
    dates.push(`${dd}${mm}${yyyy}`)
  }
  return dates
}

function parseNseDate(value: string): string | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value)
  if (!match) return null
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    .indexOf(match[2].toLowerCase())
  if (month < 0) return null
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

function csvCells(line: string): string[] {
  return line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
}

function parseNseReport(csv: string): Map<string, NseClose> {
  const lines = csv.split(/\r?\n/).filter(Boolean)
  const headers = csvCells(lines[0] ?? '').map((header) => header.toUpperCase())
  const symbolIndex = headers.indexOf('SYMBOL')
  const seriesIndex = headers.indexOf('SERIES')
  const dateIndex = headers.indexOf('DATE1')
  const closeIndex = headers.indexOf('CLOSE_PRICE')
  const previousIndex = headers.indexOf('PREV_CLOSE')
  if ([symbolIndex, seriesIndex, dateIndex, closeIndex, previousIndex].some((index) => index < 0)) {
    return new Map()
  }

  const prices = new Map<string, NseClose>()
  const seriesRanks = new Map<string, number>()
  for (const line of lines.slice(1)) {
    const cells = csvCells(line)
    const symbol = cells[symbolIndex]?.toUpperCase()
    if (!symbol) continue
    const seriesRank = cells[seriesIndex]?.toUpperCase() === 'EQ' ? 2 : 1
    if ((seriesRanks.get(symbol) ?? 0) >= seriesRank) continue
    const price = Number(cells[closeIndex])
    const previousClose = Number(cells[previousIndex])
    const sessionDate = parseNseDate(cells[dateIndex] ?? '')
    if (!finitePositive(price) || !sessionDate) continue
    prices.set(symbol, {
      price,
      previousClose: finitePositive(previousClose) ? previousClose : null,
      marketTime: new Date(`${sessionDate}T15:30:00+05:30`).toISOString(),
    })
    seriesRanks.set(symbol, seriesRank)
  }
  return prices
}

async function fetchLatestNseClose(
  fetcher: typeof fetch,
  now: number,
): Promise<Map<string, NseClose>> {
  if (nseCloseCache && nseCloseCache.expiresAt > now) return nseCloseCache.prices
  for (const date of reportCandidates(now)) {
    try {
      const response = await fetcher(
        `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${date}.csv`,
        {
          headers: { Accept: 'text/csv' },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        },
      )
      if (!response.ok) continue
      const prices = parseNseReport(await response.text())
      if (prices.size === 0) continue
      nseCloseCache = { prices, expiresAt: now + NSE_CLOSE_CACHE_MS }
      return prices
    } catch {
      continue
    }
  }
  return new Map()
}

async function nseFallbackQuotes(
  symbols: string[],
  fetcher: typeof fetch,
  now: number,
): Promise<MarketQuotePayload[]> {
  const nseSymbols = symbols.filter((symbol) => symbol.endsWith('.NS'))
  if (nseSymbols.length === 0) return []
  const closes = await fetchLatestNseClose(fetcher, now)
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

  return async (request: Request) => {
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405)
    const parsed = parseSymbols(request)
    if ('error' in parsed) return json({ error: parsed.error }, 400)

    const fetchedAt = now()
    const yahoo = await fetchYahooQuotes(parsed.symbols, fetcher)
    const quotes = yahoo.error
      ? await nseFallbackQuotes(parsed.symbols, fetcher, fetchedAt)
      : yahoo.quotes
    const returned = new Set(quotes.map((quote) => quote.symbol))
    const errors: QuoteErrorPayload[] = parsed.symbols
      .filter((symbol) => !returned.has(symbol))
      .map((symbol) => ({
        symbol,
        message: yahoo.error ?? 'No quote returned by the provider.',
      }))
    const payload: QuotesPayload = {
      provider: providerFor(quotes),
      fetchedAt: new Date(fetchedAt).toISOString(),
      quotes,
      errors,
    }
    return json(payload, quotes.length > 0 ? 200 : 502, quotes.length > 0)
  }
}

export const handleQuoteRequest = createQuoteHandler()

export default { fetch: handleQuoteRequest }
