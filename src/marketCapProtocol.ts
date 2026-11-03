import type { MarketCapRecord } from './marketCapExposure'

export const AMFI_CLASSIFICATION_PAGE = 'https://www.amfiindia.com/otherdata/categorisation-of-stocks'
export const MARKET_CAP_REFERENCE_TTL = 6 * 60 * 60_000
export interface MarketCapReference {
  asOf: string
  sourceUrl: string
  records: MarketCapRecord[]
}

export function isAmfiClassificationUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ['www.amfiindia.com', 'portal.amfiindia.com'].includes(url.hostname)
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && /^\/(?:spages|Themes\/Theme1\/downloads|uploads)\//i.test(url.pathname)
      && /Average.*Market.*Capital.*\.xlsx$/i.test(decodeURIComponent(url.pathname))
  } catch { return false }
}
