import { parseMarketCapRecords } from './marketCapExposure'
import { MARKET_CAP_REFERENCE_TTL, isAmfiClassificationUrl, type MarketCapReference } from './marketCapProtocol'
import { createSharedRequest } from './sharedRequest'

const shared = createSharedRequest<MarketCapReference>()
const SESSION_KEY = 'finverse:amfi-classifications:v1'
const MAX_REFERENCE_LENGTH = 6_000_000
let cached: { at: number; reference: MarketCapReference } | null = null
let restored = false

function parseReference(value: unknown): MarketCapReference {
  if (!value || typeof value !== 'object') throw new Error('The classification reference could not be verified.')
  const row = value as Partial<MarketCapReference>
  if (!isAmfiClassificationUrl(row.sourceUrl) || typeof row.asOf !== 'string') throw new Error('The classification reference could not be verified.')
  const records = parseMarketCapRecords(row.records)
  if (records.length < 250 || records.some((record) => record.asOf !== row.asOf || record.parentIsin || record.source !== row.sourceUrl || record.band === 'other')) throw new Error('The classification reference could not be verified.')
  return { asOf: row.asOf, sourceUrl: row.sourceUrl, records }
}

/** Only the public AMFI reference is stored, without holdings or account identifiers. */
export function getCachedMarketCapReference(): MarketCapReference | null {
  if (!restored) {
    restored = true
    try {
      const text = sessionStorage.getItem(SESSION_KEY)
      if (text && text.length <= MAX_REFERENCE_LENGTH) {
        const stored = JSON.parse(text)
        if (typeof stored.at === 'number' && stored.at <= Date.now() && Date.now() - stored.at < MARKET_CAP_REFERENCE_TTL) {
          cached = { at: stored.at, reference: parseReference(stored.reference) }
        }
      }
    } catch { /* Storage is optional; fetch a fresh reference when unavailable or invalid. */ }
  }
  return cached && Date.now() >= cached.at && Date.now() - cached.at < MARKET_CAP_REFERENCE_TTL ? cached.reference : null
}

/** The common reference request sends no holdings or account identifiers. */
export function loadMarketCapReference(signal?: AbortSignal): Promise<MarketCapReference> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  const existing = getCachedMarketCapReference()
  if (existing) return Promise.resolve(existing)
  return shared('amfi-classifications', async (requestSignal) => {
    const deadline = AbortSignal.any([requestSignal, AbortSignal.timeout(12_000)])
    const response = await fetch('/api/marketCap', { signal: deadline })
    if (!response.ok) throw new Error('AMFI classifications are temporarily unavailable.')
    const text = await response.text()
    if (text.length > MAX_REFERENCE_LENGTH) throw new Error('The classification reference was too large.')
    const reference = parseReference(JSON.parse(text))
    cached = { at: Date.now(), reference }
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(cached)) } catch { /* In-memory reuse still works when storage is full. */ }
    return reference
  }, signal)
}
