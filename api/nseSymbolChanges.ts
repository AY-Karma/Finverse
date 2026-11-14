import { isMarketSymbol } from '../src/marketDataProtocol.js'
import { isIsin } from '../src/nsePricingProtocol.js'
import { readNseCsv } from './nseReference.js'
import { readBoundedText } from './requestBudget.js'

const EQUITY_URL = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv'
const SME_URL = 'https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv'
const CHANGES_URL = 'https://nsearchives.nseindia.com/content/equities/symbolchange.csv'
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const ACTIVE_SERIES = new Set(['EQ', 'BE', 'BZ', 'SM', 'ST'])
type Reference = { active: Map<string, Set<string>>; changes: Map<string, Set<string>> }

function effectiveDate(value: string): number | undefined {
  const match = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/i.exec(value)
  if (!match) return
  const month = MONTHS.indexOf(match[2].toUpperCase())
  if (month < 0) return
  const date = Date.UTC(Number(match[3]), month, Number(match[1]))
  const actual = new Date(date)
  return actual.getUTCMonth() === month && actual.getUTCDate() === Number(match[1]) ? date : undefined
}

function rows(csv: string) {
  const data = readNseCsv(csv)
  const header = data.shift()?.map((column) => column.replace(/^\uFEFF/, '').trim().toUpperCase()) ?? []
  if (!header.length || data.some((row) => row.length !== header.length)) throw new Error('Invalid NSE reference.')
  return { header, data }
}

/** Recover an obsolete symbol only from NSE's explicit changes and an active unique listing. */
export function createNseSymbolResolver(fetcher: typeof fetch, now: () => number = Date.now) {
  let cached: { until: number; reference: Reference | null } | undefined
  let pending: Promise<Reference | null> | undefined
  async function reference(): Promise<Reference | null> {
    if (cached && cached.until > now()) return cached.reference
    if (pending) return pending
    pending = (async () => {
      try {
        const deadline = AbortSignal.timeout(3_000)
        const csv = await Promise.all([EQUITY_URL, SME_URL, CHANGES_URL].map(async (url) => {
          const response = await fetcher(url, { signal: deadline })
          if (!response.ok) throw new Error('NSE reference unavailable.')
          return readBoundedText(response, 2 * 1024 * 1024, deadline)
        }))
        const active = new Map<string, Set<string>>()
        for (const text of csv.slice(0, 2)) {
          const { header, data } = rows(text)
          const symbolColumn = header.indexOf('SYMBOL')
          const seriesColumn = header.indexOf('SERIES')
          const isinColumn = header.findIndex((column) => column === 'ISIN NUMBER' || column === 'ISIN_NUMBER')
          if ([symbolColumn, seriesColumn, isinColumn].some((index) => index < 0)) throw new Error('NSE listing columns changed.')
          for (const row of data) {
            const symbol = row[symbolColumn]
            const isin = row[isinColumn]
            if (!ACTIVE_SERIES.has(row[seriesColumn]) || !isMarketSymbol(`${symbol}.NS`) || !isIsin(isin)) continue
            const isins = active.get(symbol) ?? new Set<string>()
            isins.add(isin)
            active.set(symbol, isins)
          }
        }
        const { header, data } = rows(csv[2])
        const oldColumn = header.indexOf('OLD SYMBOL')
        const newColumn = header.indexOf('NEW SYMBOL')
        const dateColumn = header.indexOf('EFFECTIVE DATE')
        if ([oldColumn, newColumn, dateColumn].some((index) => index < 0)) throw new Error('NSE change columns changed.')
        const today = Math.floor((now() + 330 * 60_000) / 86_400_000) * 86_400_000
        const changes = new Map<string, Set<string>>()
        for (const row of data) {
          const date = effectiveDate(row[dateColumn])
          const old = row[oldColumn], current = row[newColumn]
          if (date == null || date > today || old === current || !isMarketSymbol(`${old}.NS`) || !isMarketSymbol(`${current}.NS`)) continue
          const targets = changes.get(old) ?? new Set<string>()
          targets.add(current)
          changes.set(old, targets)
        }
        const result = { active, changes }
        cached = { until: now() + 60 * 60_000, reference: result }
        return result
      } catch {
        cached = { until: now() + 60_000, reference: null }
        return null
      }
    })()
    try { return await pending } finally { pending = undefined }
  }
  return async (symbol: string): Promise<string | null> => {
    if (!symbol.endsWith('.NS') || symbol.startsWith('^') || !isMarketSymbol(symbol)) return null
    const known = await reference()
    if (!known) return null
    const original = symbol.slice(0, -3)
    if (known.active.has(original)) return null
    const visited = new Set<string>()
    let current = original
    while (visited.size < 16 && !visited.has(current)) {
      visited.add(current)
      const targets = known.changes.get(current)
      if (targets?.size !== 1) return null
      current = [...targets][0]
      const active = known.active.get(current)
      if (active) return active.size === 1 ? `${current}.NS` : null
    }
    return null
  }
}
