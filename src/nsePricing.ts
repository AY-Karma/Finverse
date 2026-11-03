import type { Position } from './types'
import { hasInrDenomination, normalizePosition } from './instruments'
import { isIsin, isNsePricingCandidate, MAX_NSE_LOOKUP_ISINS, type NsePricingCandidate } from './nsePricingProtocol'

export type { NsePricingCandidate } from './nsePricingProtocol'

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
