import { isMarketSymbol, type HistoryPayload } from '../src/marketDataProtocol.js'
import { createRequestBudget, readBoundedText } from './requestBudget.js'
import { createNseSymbolResolver } from './nseSymbolChanges.js'
import { fetchLatestNseClose, type NseCloseState } from './nseClosingPrices.js'
import { getMarketCalendarInfo } from '../src/marketCalendar.js'

const UPSTREAM_TIMEOUT_MS = 8_000
const MAX_RANGE_MS = 5 * 366 * 24 * 60 * 60 * 1000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

interface HistoryHandlerDependencies {
  fetcher: typeof fetch
}

interface YahooHistoryResponse {
  chart?: {
    result?: {
      timestamp?: number[]
      indicators?: { quote?: { close?: (number | null)[] }[] }
    }[]
  }
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

function json(data: unknown, status: number, cache = false): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: cache
      ? { ...HEADERS, 'Vercel-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
      : HEADERS,
  })
}

function parseDate(value: string | null): number | null {
  if (!value || !ISO_DATE.test(value)) return null
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null
}

async function fetchSeries(symbol: string, from: number, to: number, fetcher: typeof fetch, signal: AbortSignal) {
  const upstream = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
  upstream.searchParams.set('period1', String(Math.floor(from / 1000)))
  upstream.searchParams.set('period2', String(Math.floor((to + 24 * 60 * 60 * 1000) / 1000)))
  upstream.searchParams.set('interval', '1d')
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)])
  const response = await fetcher(upstream, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' },
    signal: deadline,
  })
  if (!response.ok) return { error: `History provider returned HTTP ${response.status}.`, recoverable: response.status === 404 || response.status === 400 }
  const data = JSON.parse(await readBoundedText(response, 2 * 1024 * 1024, deadline)) as YahooHistoryResponse
  const result = data.chart?.result?.[0]
  const timestamps = result?.timestamp
  const closes = result?.indicators?.quote?.[0]?.close
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return { error: 'History provider returned no usable series.', recoverable: true }
  const points: HistoryPayload['points'] = []
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index]
    if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8_640_000_000_000) continue
    const close = closes[index]
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue
    points.push({ date: new Date(timestamp * 1000).toISOString().slice(0, 10), close })
  }
  return points.length ? { points } : { error: 'History provider returned no usable series.', recoverable: true }
}

export function createHistoryHandler(
  dependencies: Partial<HistoryHandlerDependencies> = {},
): (request: Request) => Promise<Response> {
  const fetcher = dependencies.fetcher ?? fetch
  const budget = createRequestBudget()
  const resolveSymbol = createNseSymbolResolver(fetcher)
  const nseState: NseCloseState = {}

  return async (request: Request) => {
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405)
    const params = new URL(request.url).searchParams
    const symbol = params.get('symbol')?.trim().toUpperCase() ?? ''
    if (!isMarketSymbol(symbol)) return json({ error: 'Use a supported market symbol.' }, 400)
    const from = parseDate(params.get('from'))
    const to = parseDate(params.get('to'))
    if (from == null || to == null || from >= to || to - from > MAX_RANGE_MS) {
      return json({ error: 'Use a valid date range of five years or less.' }, 400)
    }

    return budget(`${symbol}:${from}:${to}`, 3_600_000, async (signal) => {
      try {
        const started = Date.now()
        let series = await fetchSeries(symbol, from, to, fetcher, signal)
        let resolvedSymbol: string | null = null
        if (!series.points && series.recoverable) {
          resolvedSymbol = await resolveSymbol(symbol)
          signal.throwIfAborted()
          if (resolvedSymbol) series = await fetchSeries(resolvedSymbol, from, to, fetcher, signal)
        }
        if (!series.points) return json({ error: series.error }, 502)
        let supplementalClose: HistoryPayload['supplementalClose']
        const calendar = getMarketCalendarInfo(new Date())
        const completed = calendar.available && calendar.lastSessionClose
          ? new Date(calendar.lastSessionClose.getTime() + 330 * 60_000).toISOString().slice(0, 10) : null
        if (symbol.endsWith('.NS') && completed && Date.parse(completed) >= from && Date.parse(completed) <= to
          && series.points.every((point) => point.date < completed) && Date.now() - started < 3_500) {
          const [closes, current] = await Promise.all([fetchLatestNseClose(fetcher, Date.now(), nseState), resolveSymbol(symbol)])
          signal.throwIfAborted()
          const pricingSymbol = resolvedSymbol ?? current ?? symbol
          const close = closes.get(pricingSymbol.slice(0, -3))
          if (close && new Date(Date.parse(close.marketTime) + 330 * 60_000).toISOString().slice(0, 10) === completed) {
            series = { points: [...series.points, { date: completed, close: close.price }] }
            resolvedSymbol = pricingSymbol === symbol ? null : pricingSymbol
            supplementalClose = { date: completed, source: 'nse-close' }
          }
        }
        return json({ symbol, ...(resolvedSymbol ? { resolvedSymbol } : {}), ...(supplementalClose ? { supplementalClose } : {}), points: series.points } satisfies HistoryPayload, 200, true)
      } catch {
        return json({ error: 'History provider could not be reached.' }, 502)
      }
    })
  }
}

export const handleHistoryRequest = createHistoryHandler()

export default { fetch: handleHistoryRequest }
