import { isIpoFeed, type IpoFeed } from './ipoProtocol'

const CACHE_MS = 60 * 60_000
const STORAGE_KEY = 'finverse:public-ipos:v2'
const MAX_AGE_MS = 24 * CACHE_MS
let snapshot: IpoFeed | null = null
let pending: Promise<IpoFeed> | null = null
let checkedAt = 0

export function cachedIpos(): IpoFeed | null {
  if (!snapshot && typeof sessionStorage !== 'undefined') {
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
      if (isIpoFeed(value) && value.fetchedAt <= Date.now() + 300_000 && Date.now() - value.fetchedAt < MAX_AGE_MS) snapshot = value
    } catch { /* A blocked or invalid cache must not prevent a fresh request. */ }
  }
  if (!snapshot || Date.now() - snapshot.fetchedAt >= MAX_AGE_MS) return null
  return Date.now() - snapshot.fetchedAt >= CACHE_MS ? { ...snapshot, stale: true } : snapshot
}

export function loadIpos(force = false): Promise<IpoFeed> {
  const cached = cachedIpos()
  const ttl = cached?.stale || cached?.warnings.length ? 60_000 : CACHE_MS
  if (!force && cached && Date.now() - (checkedAt || cached.fetchedAt) < ttl) return Promise.resolve(cached)
  if (pending) return pending
  pending = (async () => {
    try {
      const response = await fetch('/api/ipos', { signal: AbortSignal.timeout(12_000) })
      const body = await response.text()
      if (body.length > 2 * 1024 * 1024) throw new Error('IPO response is too large.')
      const value: unknown = JSON.parse(body)
      if (!response.ok || !isIpoFeed(value) || value.fetchedAt > Date.now() + 300_000) throw new Error('IPO feed unavailable.')
      if (!value.issues.length && cached?.issues.length && value.warnings.length) throw new Error('IPO feed unavailable.')
      snapshot = value
      checkedAt = Date.now()
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* Memory caching still works. */ }
      return value
    } catch {
      checkedAt = Date.now()
      if (cached) {
        snapshot = { ...cached, stale: true }
        return snapshot
      }
      throw new Error('IPOs could not be loaded. Try again shortly.')
    } finally { pending = null }
  })()
  return pending
}
