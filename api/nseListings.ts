import { isIsin, isNsePricingCandidate, MAX_NSE_LOOKUP_ISINS, type NsePricingCandidate } from '../src/nsePricingProtocol.js'
import { createRequestBudget, readBoundedText } from './requestBudget.js'
import { readNseCsv } from './nseReference.js'

const SOURCES = [
  { type: 'stock', url: 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv' },
  { type: 'etf', url: 'https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv' },
] as const
const CACHE_MS = 60 * 60_000
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }

function parseListings(csv: string, type: 'stock' | 'etf'): NsePricingCandidate[] {
  const rows = readNseCsv(csv)
  const header = rows.shift()?.map((column) => column.replace(/^\uFEFF/, '').trim().toUpperCase()) ?? []
  const required = type === 'stock' ? ['SYMBOL', 'SERIES', 'ISIN NUMBER'] : ['SYMBOL', 'ISINNUMBER']
  if (required.some((column) => header.filter((item) => item === column).length !== 1)) throw new Error('The NSE reference columns changed.')
  const symbolColumn = header.indexOf('SYMBOL')
  const isinColumn = header.indexOf(type === 'stock' ? 'ISIN NUMBER' : 'ISINNUMBER')
  const seriesColumn = header.indexOf('SERIES')
  return rows.flatMap((row) => {
    if (row.length !== header.length) throw new Error('Invalid NSE reference row.')
    if (type === 'stock' && row[seriesColumn] !== 'EQ') return []
    const candidate: NsePricingCandidate = { exchange: 'NSE', type, providerSymbol: `${row[symbolColumn]}.NS`, isin: row[isinColumn] }
    return isNsePricingCandidate(candidate) ? [candidate] : []
  })
}

export function createNseListingsHandler(dependencies: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const fetcher = dependencies.fetcher ?? fetch
  const budget = createRequestBudget(dependencies.now)
  const reference = createRequestBudget(dependencies.now)
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: HEADERS })
    const params = new URL(request.url).searchParams
    const raw = params.get('isins')?.split(',') ?? []
    if (!raw.length || raw.length > MAX_NSE_LOOKUP_ISINS || raw.some((isin) => !isIsin(isin))
      || [...params.keys()].some((key) => key !== 'isins')) {
      return Response.json({ error: `Provide up to ${MAX_NSE_LOOKUP_ISINS} valid ISINs.` }, { status: 400, headers: HEADERS })
    }
    const isins = [...new Set(raw)].sort()
    return budget(isins.join(','), CACHE_MS, async () => {
      const responses = await Promise.all(SOURCES.map((source) => reference(source.url, CACHE_MS, async (signal) => {
        try {
          const deadline = AbortSignal.any([signal, AbortSignal.timeout(4_000)])
          const response = await fetcher(source.url, { signal: deadline })
          if (!response.ok) throw new Error('NSE reference unavailable.')
          return Response.json(parseListings(await readBoundedText(response, 2 * 1024 * 1024, deadline), source.type))
        } catch { return Response.json({ error: 'NSE reference unavailable.' }, { status: 502 }) }
      })))
      if (responses.some((response) => !response.ok)) return Response.json({ error: 'The NSE reference could not be verified. Review listings individually.' }, { status: 502, headers: HEADERS })
      const candidates = (await Promise.all(responses.map((response) => response.json() as Promise<NsePricingCandidate[]>))).flat()
      const byIsin = new Map<string, NsePricingCandidate[]>()
      for (const candidate of candidates) {
        const known = byIsin.get(candidate.isin) ?? []
        if (!known.some((item) => item.providerSymbol === candidate.providerSymbol && item.type === candidate.type)) known.push(candidate)
        byIsin.set(candidate.isin, known)
      }
      // A symbol assigned to conflicting securities is unusable even if each ISIN appears once.
      const symbolIsins = new Map<string, Set<string>>()
      for (const candidate of candidates) {
        const known = symbolIsins.get(candidate.providerSymbol) ?? new Set<string>()
        known.add(candidate.isin)
        symbolIsins.set(candidate.providerSymbol, known)
      }
      const matched = isins.flatMap((isin) => {
        const found = byIsin.get(isin) ?? []
        return found.length === 1 && symbolIsins.get(found[0].providerSymbol)?.size === 1 ? found : []
      })
      return Response.json({ candidates: matched }, { headers: HEADERS })
    })
  }
}

export const handleNseListingsRequest = createNseListingsHandler()
export default { fetch: handleNseListingsRequest }
