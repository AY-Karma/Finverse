import { useEffect, useRef, useState } from 'react'
import type { LiveQuote } from './types'
import { watchSecurityKey, type WatchSecurity } from './watchSecurity'
import { fetchWatchQuote } from './watchSecuritySearch'

const STOCK_REFRESH_MS = 5 * 60_000
const FUND_RECHECK_MS = 3 * 60 * 60_000

/** Quotes for watched securities the user does not own, keyed by watchSecurityKey. Previous quotes are kept when a refresh fails. */
export function useWatchQuotes(securities: WatchSecurity[], enabled: boolean, now: number, refreshRevision: number): Record<string, LiveQuote> {
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({})
  const quotesRef = useRef(quotes)
  quotesRef.current = quotes
  const signature = securities.map(watchSecurityKey).sort().join(',')
  const slot = Math.floor(now / STOCK_REFRESH_MS)

  useEffect(() => {
    if (!enabled || !signature || document.visibilityState === 'hidden') return
    const controller = new AbortController()
    const wanted = new Map(securities.map((security) => [watchSecurityKey(security), security]))
    void (async () => {
      const fetched: Record<string, LiveQuote> = {}
      const due = [...wanted].filter(([key, security]) => {
        const known = quotesRef.current[key]
        return security.kind !== 'fund' || !known?.fetchedAt || Date.now() - known.fetchedAt >= FUND_RECHECK_MS
      })
      // Stock requests started together are batched into one call; funds go one at a time.
      await Promise.all(due.filter(([, security]) => security.kind === 'equity').map(async ([key, security]) => {
        const quote = await fetchWatchQuote(security, controller.signal)
        if (quote) fetched[key] = quote
      }))
      for (const [key, security] of due) {
        if (security.kind !== 'fund') continue
        const quote = await fetchWatchQuote(security, controller.signal)
        if (quote) fetched[key] = quote
      }
      setQuotes((current) => Object.fromEntries(Object.entries({ ...current, ...fetched }).filter(([key]) => wanted.has(key))))
    })().catch(() => {})
    return () => controller.abort()
  }, [signature, enabled, slot, refreshRevision])

  return quotes
}
