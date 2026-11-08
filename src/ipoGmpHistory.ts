import { isIpoGmpHistoryResponse, isIpoGmpHistorySlug, type IpoGmpHistoryResponse } from './ipoGmpHistoryProtocol'

const STORAGE_KEY = 'finverse:ipo-gmp-history:v4'
const CACHE_MS = 60 * 60_000
const MAX_ENTRIES = 100
const cache = new Map<string, IpoGmpHistoryResponse>()
const pending = new Map<string, Promise<IpoGmpHistoryResponse>>()
let restored = false

function recent(value: IpoGmpHistoryResponse): boolean {
  const age = Date.now() - value.checkedAt
  return age >= -300_000 && age < CACHE_MS
}

export function cachedIpoGmpHistory(slug: string): IpoGmpHistoryResponse | null {
  if (!restored) {
    restored = true
    try {
      const values: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]')
      if (Array.isArray(values)) for (const value of values.slice(0, MAX_ENTRIES)) {
        if (isIpoGmpHistoryResponse(value) && recent(value)) cache.set(value.slug, value)
      }
    } catch { /* An unavailable cache does not block public data. */ }
  }
  const value = cache.get(slug)
  return value && recent(value) ? value : null
}

export function loadIpoGmpHistory(slug: string, force = false): Promise<IpoGmpHistoryResponse> {
  if (!isIpoGmpHistorySlug(slug)) return Promise.reject(new Error('Invalid IPO identity.'))
  const existing = pending.get(slug)
  if (existing) return existing
  const saved = cachedIpoGmpHistory(slug)
  if (saved && !force) return Promise.resolve(saved)
  const task = (async () => {
    try {
      const response = await fetch(`/api/ipoGmpHistory?slug=${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(12_000) })
      const body = await response.text()
      if (body.length > 200_000) throw new Error('Historical GMP response is too large.')
      const value: unknown = JSON.parse(body)
      if (!response.ok || !isIpoGmpHistoryResponse(value) || value.slug !== slug || !recent(value)) throw new Error('Historical GMP unavailable.')
      cache.set(slug, value)
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...cache.values()])) } catch { /* Memory caching remains available. */ }
      return value
    } catch {
      throw new Error('Historical GMP could not be loaded.')
    } finally { pending.delete(slug) }
  })()
  pending.set(slug, task)
  return task
}
