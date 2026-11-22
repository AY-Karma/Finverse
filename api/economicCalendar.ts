import { FOREX_FACTORY_URL, parseForexFactory } from '../src/economicCalendarProtocol.js'
import { cdnCache, createRequestBudget, readBoundedText } from './_requestBudget.js'

// The feed is rebuilt hourly at most; one shared copy keeps requests to the provider rare.
const CACHE_MS = 60 * 60_000
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }

export function createEconomicCalendarHandler(dependencies: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const fetcher = dependencies.fetcher ?? fetch
  const now = dependencies.now ?? Date.now
  const budget = createRequestBudget(now)
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: HEADERS })
    if ([...new URL(request.url).searchParams.keys()].length) return Response.json({ error: 'This endpoint takes no parameters.' }, { status: 400, headers: HEADERS })
    return budget('week', CACHE_MS, async (signal) => {
      try {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(6_000)])
        const response = await fetcher(FOREX_FACTORY_URL, { signal: deadline, headers: { Accept: 'application/json' } })
        if (!response.ok) throw new Error('Economic calendar unavailable.')
        const events = parseForexFactory(JSON.parse(await readBoundedText(response, 512 * 1024, deadline)))
        return Response.json({ events, fetchedAt: new Date(now()).toISOString() }, { headers: { ...HEADERS, ...cdnCache(CACHE_MS / 1000, 3600) } })
      } catch {
        return Response.json({ error: 'The global economic calendar could not be reached.' }, { status: 502, headers: HEADERS })
      }
    })
  }
}

export const handleEconomicCalendarRequest = createEconomicCalendarHandler()
export default { fetch: handleEconomicCalendarRequest }
