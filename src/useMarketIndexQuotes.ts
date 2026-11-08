import { useEffect, useState } from 'react'
import { isMarketOpen } from './live'
import { cachedMarketIndexQuotes, INDEX_REFRESH_MS, loadMarketIndexQuotes } from './marketIndexQuotes'

export function useMarketIndexQuotes(allowed: boolean) {
  const [snapshot, setSnapshot] = useState(cachedMarketIndexQuotes)
  const [loading, setLoading] = useState(allowed && !snapshot.checkedAt)

  useEffect(() => {
    if (!allowed) return
    let active = true
    let controller: AbortController | null = null
    const refresh = () => {
      if (document.hidden || controller) return
      const request = new AbortController()
      controller = request
      setLoading(true)
      void loadMarketIndexQuotes(request.signal)
        .then((next) => { if (active && !request.signal.aborted) setSnapshot(next) })
        .catch(() => {})
        .finally(() => {
          if (controller !== request) return
          controller = null
          if (active) setLoading(false)
        })
    }
    const visibility = () => {
      if (document.hidden) { controller?.abort(); controller = null }
      else refresh()
    }
    refresh()
    const timer = window.setInterval(() => { if (isMarketOpen()) refresh() }, INDEX_REFRESH_MS)
    document.addEventListener('visibilitychange', visibility)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); controller?.abort() }
  }, [allowed])

  return { ...snapshot, quotes: allowed ? snapshot.quotes : {}, loading: allowed && loading }
}
