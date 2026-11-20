import { useEffect, useState } from 'react'
import { CLOSED_QUOTE_RECHECK_MS, isMarketOpen } from './live'
import { cachedMarketIndexQuotes, INDEX_REFRESH_MS, loadMarketIndexQuotes, nextMarketIndexRefreshAt, persistMarketIndexQuotes } from './marketIndexQuotes'
import { normalizeMarketIndexIds, selectedMarketIndices } from './marketIndexSelection'
import { isGlobalIndexSessionOpen } from './marketIndexSessions'
import { livePace, PACE_STEPS } from './livePace'

export function useMarketIndexQuotes(allowed: boolean, indexIds?: readonly string[]) {
  const selection = normalizeMarketIndexIds(indexIds)
  const key = selection.join('|')
  const [current, setCurrent] = useState(() => ({ key, snapshot: cachedMarketIndexQuotes(selection) }))
  const snapshot = current.key === key ? current.snapshot : cachedMarketIndexQuotes(selection)
  const [loading, setLoading] = useState(allowed && !snapshot.checkedAt)

  useEffect(() => {
    if (!allowed) return
    let active = true
    let controller: AbortController | null = null
    const indices = selectedMarketIndices(selection)
    const quoteWindowOpen = () => indices.some((index) => index.region === 'India' ? isMarketOpen() : isGlobalIndexSessionOpen(index.id))
    let marketOpen = quoteWindowOpen()
    let closeRefreshPending = false
    let initialRefreshPending = true
    let lastRefreshAt = 0
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refresh = (force = false) => {
      if (document.hidden || controller) return false
      clearTimeout(refreshTimer)
      initialRefreshPending = false
      lastRefreshAt = Date.now()
      const request = new AbortController()
      controller = request
      // Background polls keep showing the last quotes instead of toggling "Loading" on every poll.
      if (!cachedMarketIndexQuotes(selection).checkedAt) setLoading(true)
      void loadMarketIndexQuotes(request.signal, force, selection)
        .then((next) => { if (active && !request.signal.aborted) setCurrent({ key, snapshot: next }) })
        .catch(() => {})
        .finally(() => {
          if (controller !== request) return
          controller = null
          if (active) {
            setLoading(false)
            if (marketOpen && !document.hidden) refreshTimer = setTimeout(() => {
              if ((updateMarket() || closeRefreshPending) && refresh(closeRefreshPending)) closeRefreshPending = false
            }, Math.max(0, (livePace.nextBeatAt() ?? Date.now() + PACE_STEPS[0]) - Date.now(), nextMarketIndexRefreshAt(selection) - Date.now()))
          }
        })
      return true
    }
    const updateMarket = () => {
      const open = quoteWindowOpen()
      if (marketOpen && !open) closeRefreshPending = true
      marketOpen = open
      if (open) closeRefreshPending = false
      return open
    }
    const visibility = () => {
      if (document.hidden) {
        persistMarketIndexQuotes()
        clearTimeout(refreshTimer)
        if (controller) initialRefreshPending = true
        controller?.abort()
        controller = null
        setLoading(false)
      }
      else {
        const staleEntry = Date.now() - lastRefreshAt >= CLOSED_QUOTE_RECHECK_MS
        if ((updateMarket() || closeRefreshPending || initialRefreshPending || staleEntry) && refresh(closeRefreshPending || staleEntry)) closeRefreshPending = false
      }
    }
    refresh()
    const timer = window.setInterval(() => {
      const wasOpen = marketOpen
      const open = updateMarket()
      if (!open && !closeRefreshPending && !initialRefreshPending) clearTimeout(refreshTimer)
      if (((open && !wasOpen) || closeRefreshPending || initialRefreshPending) && refresh(closeRefreshPending)) closeRefreshPending = false
    }, INDEX_REFRESH_MS)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', persistMarketIndexQuotes)
    // The refresh button restarts the shared beat: indices refresh with holdings instead of waiting for their next poll.
    const unsubscribeRestart = livePace.onRestart(() => { if (!document.hidden && refresh(true)) closeRefreshPending = false })
    return () => { active = false; unsubscribeRestart(); window.clearInterval(timer); clearTimeout(refreshTimer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', persistMarketIndexQuotes); controller?.abort(); persistMarketIndexQuotes() }
  }, [allowed, key])

  return { ...snapshot, quotes: allowed ? snapshot.quotes : {}, loading: allowed && (current.key !== key ? !snapshot.checkedAt : loading) }
}
