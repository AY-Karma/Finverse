import { useEffect, useMemo, useState } from 'react'
import type { LiveQuote, Position } from './types'
import { hasInrDenomination, hasVerifiedNsePricing } from './instruments'
import { loadNseInstrumentTypes, type NsePricingCandidate } from './nsePricing'
import { isIsin, MAX_NSE_LOOKUP_ISINS } from './nsePricingProtocol'
import { createSharedRequest } from './sharedRequest'
import { quoteKey } from './valuation'

const CACHE_MS = 6 * 60 * 60_000
const MAX_CACHE_ENTRIES = 2_000
const cache = new Map<string, { at: number; type: 'stock' | 'etf' | null }>()
const shared = createSharedRequest<NsePricingCandidate[]>()

function eligiblePositions(positions: Position[]): Position[] {
  return positions.filter((position) => position.type === 'stock' && !position.identityIssue
    && !hasVerifiedNsePricing(position) && hasInrDenomination(position)
    && ['NSE', 'BSE'].includes(position.exchange ?? '') && isIsin(position.isin))
}

function cachedType(isin: string) {
  const entry = cache.get(isin)
  return entry && Date.now() - entry.at < CACHE_MS ? entry : undefined
}

async function loadTypes(positions: Position[], signal: AbortSignal): Promise<Map<string, 'stock' | 'etf'>> {
  const now = Date.now()
  for (const [isin, entry] of cache) if (now - entry.at >= CACHE_MS) cache.delete(isin)
  const types = new Map<string, 'stock' | 'etf'>()
  for (const position of positions) {
    const type = cache.get(position.isin!)?.type
    if (type) types.set(position.isin!, type)
  }
  const byIsin = new Map(positions.filter((position) => !cache.has(position.isin!)).map((position) => [position.isin!, position]))
  const missing = [...byIsin.values()].sort((left, right) => left.isin!.localeCompare(right.isin!))
  for (let start = 0; start < missing.length; start += MAX_NSE_LOOKUP_ISINS) {
    signal.throwIfAborted()
    const batch = missing.slice(start, start + MAX_NSE_LOOKUP_ISINS)
    const candidates = await shared(batch.map((position) => position.isin).join(','),
      (requestSignal) => loadNseInstrumentTypes(batch, requestSignal), signal)
    signal.throwIfAborted()
    const actual = new Map(candidates.map((candidate) => [candidate.isin, candidate.type]))
    for (const position of batch) {
      const type = actual.get(position.isin!) ?? null
      if (type) types.set(position.isin!, type)
      cache.set(position.isin!, { at: Date.now(), type })
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
    }
  }
  return types
}

/** Type corrections are view copies; imported holdings and their quote identities stay intact. */
export function useMarketCapPositions(
  positions: Position[], quotes: Record<string, LiveQuote>, allowExternalData: boolean, hideValues = false,
) {
  const [resolved, setResolved] = useState<{ key: string; types: Map<string, 'stock' | 'etf'> }>({ key: '', types: new Map() })
  const [loading, setLoading] = useState(false)
  const eligible = useMemo(() => eligiblePositions(positions), [positions])
  const key = eligible.map((position) => position.isin).sort().join(',')

  useEffect(() => {
    if (!allowExternalData || hideValues || !key) { setLoading(false); return }
    if (eligible.every((position) => cachedType(position.isin!))) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    void loadTypes(eligible, controller.signal).then((types) => {
      if (!controller.signal.aborted) setResolved({ key, types })
    }).catch(() => {
      // A failed reference never turns a guessed symbol into an ETF.
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [allowExternalData, hideValues, key])

  return useMemo(() => {
    if (!allowExternalData || hideValues) return { positions, quotes, loading: false }
    const correctedQuotes = { ...quotes }
    const eligibleSet = new Set(eligible)
    const corrected = positions.map((position) => {
      if (!eligibleSet.has(position)) return position
      const cached = cachedType(position.isin!)
      const type = cached ? cached.type : resolved.key === key ? resolved.types.get(position.isin!) : undefined
      if (type !== 'etf') return position
      const result: Position = { ...position, type: 'etf' }
      const quote = quotes[quoteKey(position)]
      if (quote) correctedQuotes[quoteKey(result)] = quote
      return result
    })
    return { positions: corrected, quotes: correctedQuotes, loading }
  }, [positions, quotes, allowExternalData, hideValues, eligible, resolved, key, loading])
}
