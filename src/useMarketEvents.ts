import { useEffect, useMemo, useRef, useState } from 'react'
import { holdingIdentity } from './monitor'
import { loadMarketEvents, type MarketEventsFeed } from './marketEvents'
import type { Position } from './types'

const EMPTY_FEED: MarketEventsFeed = { events: [], issues: [], fetchedAt: 0 }

export function useMarketEvents(positions: Position[], allowed: boolean, masked: boolean) {
  const positionsKey = JSON.stringify(positions.map((position) => [position.id, holdingIdentity(position)]).sort())
  const monitoredPositions = useMemo(() => positions, [positionsKey])
  const key = JSON.stringify([positionsKey, allowed, masked])
  const [result, setResult] = useState<{ key: string; feed: MarketEventsFeed } | null>(null)
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const handledRefresh = useRef(0)

  useEffect(() => {
    if (!allowed || masked || monitoredPositions.length === 0) { setLoading(false); return }
    const controller = new AbortController()
    const forceRefresh = handledRefresh.current !== revision
    handledRefresh.current = revision
    setLoading(true)
    const receive = (feed: MarketEventsFeed) => {
      if (controller.signal.aborted) return
      setResult((previous) => ({ key, feed: feed.events.length === 0 && feed.issues.length > 0 && previous?.key === key
        ? { ...previous.feed, issues: feed.issues } : feed }))
    }
    void loadMarketEvents(monitoredPositions, { signal: controller.signal, forceRefresh })
      .then(receive)
      .catch(() => receive({ ...EMPTY_FEED, issues: [{ source: 'Company updates', message: 'Could not load company events. Try again.' }] }))
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [key, monitoredPositions, allowed, masked, revision])

  return { feed: allowed && !masked && result?.key === key ? result.feed : EMPTY_FEED, loading: allowed && !masked && loading, refresh: () => setRevision((value) => value + 1) }
}
