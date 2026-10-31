import { isMarketSymbol } from './marketDataProtocol.js'
import type { NsePricingListing } from './types'

export type NsePricingCandidate = Omit<NsePricingListing, 'source' | 'verifiedAt'>
export const MAX_NSE_LOOKUP_ISINS = 100
export const isIsin = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value)

export function isNsePricingCandidate(value: unknown): value is NsePricingCandidate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.exchange === 'NSE' && isIsin(candidate.isin)
    && (candidate.type === 'stock' || candidate.type === 'etf')
    && typeof candidate.providerSymbol === 'string' && /\.NS$/.test(candidate.providerSymbol)
    && isMarketSymbol(candidate.providerSymbol) && !candidate.providerSymbol.startsWith('^')
}

export function isNsePricingListing(value: unknown): value is NsePricingListing {
  if (!isNsePricingCandidate(value)) return false
  const mapping = value as NsePricingListing
  return mapping.source === 'nse-master' && Number.isSafeInteger(mapping.verifiedAt) && mapping.verifiedAt > 0
    && mapping.verifiedAt <= Date.now() + 300_000
}
