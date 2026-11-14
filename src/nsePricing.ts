import type { Position } from './types'
import { hasInrDenomination, hasVerifiedNsePricing, normalizePosition } from './instruments'
import { isIsin, isNsePricingCandidate, MAX_NSE_LOOKUP_ISINS, type NsePricingCandidate } from './nsePricingProtocol'
import { createSharedRequest } from './sharedRequest'

export type { NsePricingCandidate } from './nsePricingProtocol'

const REFERENCE_CACHE_MS = 60 * 60_000
const MAX_REFERENCE_ENTRIES = 2_000
const referenceCache = new Map<string, { at: number; candidate: NsePricingCandidate | null }>()
const sharedReference = createSharedRequest<NsePricingCandidate[]>()

export function applyNsePricing(position: Position, candidate: NsePricingCandidate): Position {
  if (!isNsePricingCandidate(candidate) || !hasInrDenomination(position)
    || !['NSE', 'BSE'].includes(position.exchange ?? '') || position.type !== candidate.type
    || position.isin?.trim().toUpperCase() !== candidate.isin) {
    throw new Error('Choose a verified NSE listing with the same ISIN and asset type. Imported details are retained.')
  }
  return normalizePosition({ ...position, pricingListing: { ...candidate, source: 'nse-master', verifiedAt: Date.now() } })
}

function eligibleNsePositions(positions: Position[]): Position[] {
  return positions.filter((position) => (position.type === 'stock' || position.type === 'etf')
    && hasInrDenomination(position) && ['NSE', 'BSE'].includes(position.exchange ?? '') && isIsin(position.isin))
}

/** Exact security matches can establish asset type even when a holdings export omitted it. */
export async function loadNseInstrumentTypes(positions: Position[], signal?: AbortSignal): Promise<NsePricingCandidate[]> {
  const eligible = eligibleNsePositions(positions)
  const isins = [...new Set(eligible.map((position) => position.isin!))].sort()
  const matches: NsePricingCandidate[] = []
  for (let start = 0; start < isins.length; start += MAX_NSE_LOOKUP_ISINS) {
    signal?.throwIfAborted()
    const batch = isins.slice(start, start + MAX_NSE_LOOKUP_ISINS)
    const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12_000)])
    const response = await fetch(`/api/nseListings?${new URLSearchParams({ isins: batch.join(',') })}`, { signal: deadline })
    if (!response.ok) throw new Error('The NSE reference could not be reached. Try again or review listings individually.')
    const payload = await response.json() as { candidates?: unknown }
    if (!Array.isArray(payload.candidates) || payload.candidates.length > batch.length
      || payload.candidates.some((candidate) => !isNsePricingCandidate(candidate) || !batch.includes(candidate.isin))) {
      throw new Error('The NSE reference returned invalid matches. Review listings individually.')
    }
    const candidates = payload.candidates as NsePricingCandidate[]
    if (new Set(candidates.map((candidate) => candidate.isin)).size !== candidates.length) throw new Error('The NSE reference returned ambiguous matches. Review listings individually.')
    matches.push(...candidates)
  }
  return matches
}

export async function loadNsePricingCandidates(positions: Position[], signal?: AbortSignal): Promise<NsePricingCandidate[]> {
  const candidates = await loadNseInstrumentTypes(positions, signal)
  const eligible = eligibleNsePositions(positions)
  return candidates.filter((candidate) => eligible.some((position) => position.isin === candidate.isin && position.type === candidate.type))
}

/** Keep imported financials and venue; only an exact official ISIN match selects NSE pricing. */
export async function preferNsePricing(positions: Position[], signal?: AbortSignal): Promise<Position[]> {
  signal?.throwIfAborted()
  const eligible = eligibleNsePositions(positions).filter((position) => !hasVerifiedNsePricing(position))
  if (!eligible.length) return positions
  const now = Date.now()
  for (const [isin, entry] of referenceCache) if (now - entry.at >= REFERENCE_CACHE_MS || now < entry.at) referenceCache.delete(isin)
  const missing = [...new Map(eligible.filter((position) => !referenceCache.has(position.isin!))
    .map((position) => [position.isin!, position])).values()].sort((left, right) => left.isin!.localeCompare(right.isin!))
  for (let start = 0; start < missing.length; start += MAX_NSE_LOOKUP_ISINS) {
    signal?.throwIfAborted()
    const batch = missing.slice(start, start + MAX_NSE_LOOKUP_ISINS)
    const candidates = await sharedReference(batch.map((position) => position.isin).join(','),
      (requestSignal) => loadNseInstrumentTypes(batch, requestSignal), signal)
    signal?.throwIfAborted()
    const byIsin = new Map(candidates.map((candidate) => [candidate.isin, candidate]))
    for (const position of batch) {
      referenceCache.set(position.isin!, { at: Date.now(), candidate: byIsin.get(position.isin!) ?? null })
      while (referenceCache.size > MAX_REFERENCE_ENTRIES) referenceCache.delete(referenceCache.keys().next().value!)
    }
  }
  const eligibleSet = new Set(eligible)
  let changed = false
  const preferred = positions.map((position) => {
    const candidate = eligibleSet.has(position) ? referenceCache.get(position.isin!)?.candidate : null
    if (!candidate) return position
    changed = true
    return applyNsePricing({ ...position, type: candidate.type }, candidate)
  })
  return changed ? preferred : positions
}
