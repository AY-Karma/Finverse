import { isMarketSymbol, type HistoryPayload } from '../src/marketDataProtocol'

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

export function createHistoryHandler(
  dependencies: Partial<HistoryHandlerDependencies> = {},
): (request: Request) => Promise<Response> {
  const fetcher = dependencies.fetcher ?? fetch

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

    const upstream = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
    upstream.searchParams.set('period1', String(Math.floor(from / 1000)))
    upstream.searchParams.set('period2', String(Math.floor((to + 24 * 60 * 60 * 1000) / 1000)))
    upstream.searchParams.set('interval', '1d')

    try {
      const response = await fetcher(upstream, {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      if (!response.ok) return json({ error: `History provider returned HTTP ${response.status}.` }, 502)
      const data = (await response.json()) as YahooHistoryResponse
      const result = data.chart?.result?.[0]
      const timestamps = result?.timestamp
      const closes = result?.indicators?.quote?.[0]?.close
      if (!Array.isArray(timestamps) || !Array.isArray(closes)) {
        return json({ error: 'History provider returned no usable series.' }, 502)
      }
      const points: HistoryPayload['points'] = []
      for (let index = 0; index < timestamps.length; index += 1) {
        const close = closes[index]
        if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue
        points.push({
          date: new Date(timestamps[index] * 1000).toISOString().slice(0, 10),
          close,
        })
      }
      return json({ symbol, points } satisfies HistoryPayload, 200, true)
    } catch {
      return json({ error: 'History provider could not be reached.' }, 502)
    }
  }
}

export const handleHistoryRequest = createHistoryHandler()

export default { fetch: handleHistoryRequest }
