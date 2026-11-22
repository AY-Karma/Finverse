import { readBoundedText } from './_requestBudget.js'
import { readNseCsv } from './_nseReference.js'

const ETF_LIST_URL = 'https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv'
const ETF_LIST_TTL_MS = 6 * 60 * 60_000
const FAILURE_TTL_MS = 5 * 60_000
/** "Underlying Key" values that name a category rather than an index; the underlying asset is more searchable. */
const CATEGORY_KEYS = new Set(['GLOBAL INDICES', 'OVERNIGHT ETFS AND LIQUID ETF', 'GSECS/GILT', 'BOND'])
const TICKER = /^[A-Z][A-Z0-9&-]{1,19}$/

/** "Nasdaq100" → "Nasdaq 100", "Nifty Alpha 50 Total Return Index" → "Nifty Alpha 50", "GOLD" → "Gold". */
export function searchableIndexName(asset: string, key: string): string {
  const source = key && !CATEGORY_KEYS.has(key.trim().toUpperCase()) ? key : asset
  const cleaned = source.replace(/\b(total return index|tri|index)\b/gi, ' ')
    .replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ').trim()
  return /^[A-Z]+$/.test(cleaned) ? cleaned[0] + cleaned.slice(1).toLowerCase() : cleaned
}

/** Splits a run-together ticker at letter/digit boundaries: "MON100" → "MON 100". */
export function splitTicker(value: string): string {
  return value.replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2')
}

function parseEtfIndexes(csv: string): Map<string, string> {
  const rows = readNseCsv(csv)
  const header = rows.shift()?.map((column) => column.replace(/^﻿/, '').trim().toUpperCase()) ?? []
  const symbol = header.indexOf('SYMBOL'), asset = header.indexOf('UNDERLYING ASSET'), key = header.indexOf('UNDERLYING KEY')
  if (symbol < 0 || asset < 0) throw new Error('The NSE ETF list columns changed.')
  const indexes = new Map<string, string>()
  for (const row of rows) {
    const name = searchableIndexName(row[asset] ?? '', key < 0 ? '' : row[key] ?? '')
    if (row[symbol] && name) indexes.set(row[symbol].toUpperCase(), name)
  }
  return indexes
}

/**
 * News never uses ETF tickers (MON100, MOALPHA50 return nothing), so a bare NSE ETF ticker searches its
 * underlying index instead ("Nasdaq 100 ETF"). Other run-together tickers are split; names pass through.
 */
export function createNewsQueryResolver(fetcher: typeof fetch, now: () => number = Date.now) {
  let cache: { until: number; indexes: Map<string, string> } | undefined
  let pending: Promise<Map<string, string>> | undefined

  const loadIndexes = (): Promise<Map<string, string>> => {
    if (cache && cache.until > now()) return Promise.resolve(cache.indexes)
    pending ??= (async () => {
      try {
        const signal = AbortSignal.timeout(4_000)
        const response = await fetcher(ETF_LIST_URL, { signal })
        if (!response.ok) throw new Error('ETF list unavailable')
        const indexes = parseEtfIndexes(await readBoundedText(response, 2 * 1024 * 1024, signal))
        cache = { until: now() + ETF_LIST_TTL_MS, indexes }
      } catch {
        cache = { until: now() + FAILURE_TTL_MS, indexes: cache?.indexes ?? new Map() }
      } finally {
        pending = undefined
      }
      return cache.indexes
    })()
    return pending
  }

  return async (query: string): Promise<string> => {
    const ticker = query.trim().toUpperCase()
    if (!TICKER.test(ticker)) return query
    const index = (await loadIndexes()).get(ticker)
    if (index) return `${index} ETF`
    return /[A-Z]/.test(ticker) && /\d/.test(ticker) ? splitTicker(ticker) : query
  }
}
