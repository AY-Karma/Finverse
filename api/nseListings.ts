import { isIsin, isNsePricingCandidate, MAX_NSE_LOOKUP_ISINS, type NsePricingCandidate } from '../src/nsePricingProtocol.js'
import { cdnCache, createRequestBudget, readBoundedText } from './_requestBudget.js'
import { readNseCsv } from './_nseReference.js'

const SOURCES = [
  { type: 'stock', url: 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv' },
  { type: 'etf', url: 'https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv' },
] as const
const CACHE_MS = 60 * 60_000
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }

type NseListing = NsePricingCandidate & { name: string; search: string }

const MAX_RESULTS = 12
const SEARCH_PATTERN = /^[A-Za-z0-9 &.'()-]{2,40}$/

function parseListings(csv: string, type: 'stock' | 'etf'): NseListing[] {
  const rows = readNseCsv(csv)
  const header = rows.shift()?.map((column) => column.replace(/^\uFEFF/, '').trim().toUpperCase()) ?? []
  const required = type === 'stock' ? ['SYMBOL', 'SERIES', 'ISIN NUMBER'] : ['SYMBOL', 'ISINNUMBER']
  if (required.some((column) => header.filter((item) => item === column).length !== 1)) throw new Error('The NSE reference columns changed.')
  const symbolColumn = header.indexOf('SYMBOL')
  const isinColumn = header.indexOf(type === 'stock' ? 'ISIN NUMBER' : 'ISINNUMBER')
  const seriesColumn = header.indexOf('SERIES')
  const nameColumn = header.indexOf(type === 'stock' ? 'NAME OF COMPANY' : 'SECURITYNAME')
  const underlyingColumn = header.indexOf('UNDERLYING ASSET')
  return rows.flatMap((row) => {
    if (row.length !== header.length) throw new Error('Invalid NSE reference row.')
    if (type === 'stock' && row[seriesColumn] !== 'EQ') return []
    const candidate: NsePricingCandidate = { exchange: 'NSE', type, providerSymbol: `${row[symbolColumn]}.NS`, isin: row[isinColumn] }
    if (!isNsePricingCandidate(candidate)) return []
    const name = (nameColumn >= 0 && row[nameColumn]) || row[symbolColumn]
    return [{ ...candidate, name, search: [row[symbolColumn], name, underlyingColumn >= 0 ? row[underlyingColumn] : ''].join(' ').toLowerCase() }]
  })
}

const withoutSearchText = ({ name: _name, search: _search, ...candidate }: NseListing): NsePricingCandidate => candidate

/** A symbol assigned to conflicting securities is unusable even if each ISIN appears once. */
function symbolIsinSets(listings: NseListing[]): Map<string, Set<string>> {
  const symbolIsins = new Map<string, Set<string>>()
  for (const { providerSymbol, isin } of listings) symbolIsins.set(providerSymbol, (symbolIsins.get(providerSymbol) ?? new Set<string>()).add(isin))
  return symbolIsins
}

function searchListings(listings: NseListing[], query: string) {
  const symbolIsins = symbolIsinSets(listings)
  const terms = query.split(' ')
  const rank = ({ providerSymbol, name }: NseListing) => {
    const symbol = providerSymbol.slice(0, -3).toLowerCase()
    return symbol === query ? 0 : symbol.startsWith(query) ? 1 : name.toLowerCase().startsWith(query) ? 2 : 3
  }
  const matches = listings
    .filter((listing) => symbolIsins.get(listing.providerSymbol)?.size === 1 && terms.every((term) => listing.search.includes(term)))
    .sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name))
  const unique = [...new Map(matches.map((listing) => [listing.providerSymbol, listing])).values()]
  return unique.slice(0, MAX_RESULTS).map(({ providerSymbol, isin, type, name }) => ({ providerSymbol, isin, type, name }))
}

export function createNseListingsHandler(dependencies: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const fetcher = dependencies.fetcher ?? fetch
  const budget = createRequestBudget(dependencies.now)
  const reference = createRequestBudget(dependencies.now)
  const unavailable = () => Response.json({ error: 'The NSE reference could not be verified. Review listings individually.' }, { status: 502, headers: HEADERS })
  const loadListings = async (): Promise<NseListing[] | null> => {
    const responses = await Promise.all(SOURCES.map((source) => reference(source.url, CACHE_MS, async (signal) => {
      try {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(4_000)])
        const response = await fetcher(source.url, { signal: deadline })
        if (!response.ok) throw new Error('NSE reference unavailable.')
        return Response.json(parseListings(await readBoundedText(response, 2 * 1024 * 1024, deadline), source.type))
      } catch { return Response.json({ error: 'NSE reference unavailable.' }, { status: 502 }) }
    })))
    if (responses.some((response) => !response.ok)) return null
    return (await Promise.all(responses.map((response) => response.json() as Promise<NseListing[]>))).flat()
  }
  const cached = (body: unknown) => Response.json(body, { headers: { ...HEADERS, ...cdnCache(CACHE_MS / 1000, 86_400) } })

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: HEADERS })
    const params = new URL(request.url).searchParams
    const rawQuery = params.get('q')
    if (rawQuery !== null) {
      const query = rawQuery.trim().replace(/\s+/g, ' ').toLowerCase()
      if (!SEARCH_PATTERN.test(query) || [...params.keys()].some((key) => key !== 'q')) {
        return Response.json({ error: 'Search by company name or symbol (2 to 40 characters).' }, { status: 400, headers: HEADERS })
      }
      return budget(`q:${query}`, CACHE_MS, async () => {
        const listings = await loadListings()
        return listings ? cached({ results: searchListings(listings, query) }) : unavailable()
      })
    }
    const raw = params.get('isins')?.split(',') ?? []
    if (!raw.length || raw.length > MAX_NSE_LOOKUP_ISINS || raw.some((isin) => !isIsin(isin))
      || [...params.keys()].some((key) => key !== 'isins')) {
      return Response.json({ error: `Provide up to ${MAX_NSE_LOOKUP_ISINS} valid ISINs.` }, { status: 400, headers: HEADERS })
    }
    const isins = [...new Set(raw)].sort()
    return budget(isins.join(','), CACHE_MS, async () => {
      const listings = await loadListings()
      if (!listings) return unavailable()
      const byIsin = new Map<string, NseListing[]>()
      for (const listing of listings) {
        const known = byIsin.get(listing.isin) ?? []
        if (!known.some((item) => item.providerSymbol === listing.providerSymbol && item.type === listing.type)) known.push(listing)
        byIsin.set(listing.isin, known)
      }
      const symbolIsins = symbolIsinSets(listings)
      const matched = isins.flatMap((isin) => {
        const found = byIsin.get(isin) ?? []
        return found.length === 1 && symbolIsins.get(found[0].providerSymbol)?.size === 1 ? [withoutSearchText(found[0])] : []
      })
      return cached({ candidates: matched })
    })
  }
}

export const handleNseListingsRequest = createNseListingsHandler()
export default { fetch: handleNseListingsRequest }
