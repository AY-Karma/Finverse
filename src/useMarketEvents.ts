import { useEffect, useMemo, useRef, useState } from 'react'
import { holdingIdentity } from './monitor'
import { EVENTS_REFRESH_MS, loadMarketEvents, type MarketEventsFeed } from './marketEvents'
import type { Position } from './types'

const EMPTY_FEED: MarketEventsFeed = { events: [], issues: [], fetchedAt: 0 }

export function useMarketEvents(positions: Position[], allowed: boolean, masked: boolean, autoRefresh = false) {
  const positionsKey = JSON.stringify(positions.map((position) => [position.id, holdingIdentity(position), position.name, position.exchangeSource, position.identityIssue]).sort())
  const monitoredPositions = useMemo(() => positions, [positionsKey])
  const key = JSON.stringify([positionsKey, allowed, masked])
  const [result, setResult] = useState<{ key: string; feed: MarketEventsFeed } | null>(null)
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const handledRefresh = useRef(0)

  useEffect(() => {
    if (!allowed || masked || monitoredPositions.length === 0) { setLoading(false); return }
    let active = true
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let nextCheckAt = 0
    let attempted = false
    const forceRefresh = handledRefresh.current !== revision
    handledRefresh.current = revision
    const receive = (feed: MarketEventsFeed, signal: AbortSignal) => {
      if (!active || signal.aborted) return
      setResult((previous) => ({ key, feed: feed.events.length === 0 && feed.sourceFailed && previous?.key === key
        ? { ...previous.feed, issues: feed.issues, sourceFailed: true } : feed }))
    }
    const refresh = (force = false) => {
      if (!active || document.hidden || controller) return
      clearTimeout(timer)
      const request = new AbortController()
      controller = request
      attempted = true
      setLoading(true)
      let failed = false
      void loadMarketEvents(monitoredPositions, { signal: request.signal, forceRefresh: force })
        .then((feed) => { failed = Boolean(feed.sourceFailed); receive(feed, request.signal) })
        .catch(() => {
          failed = true
          receive({ ...EMPTY_FEED, sourceFailed: true, issues: [{ source: 'Company updates', message: 'Could not load company events. Try again.' }] }, request.signal)
        }).finally(() => {
          if (!active || controller !== request) return
          request.abort()
          controller = null
          setLoading(false)
          const wait = failed ? 5 * 60_000 : EVENTS_REFRESH_MS
          nextCheckAt = Date.now() + wait
          if (autoRefresh && !document.hidden) timer = setTimeout(() => refresh(), wait)
        })
    }
    const visibility = () => {
      clearTimeout(timer)
      if (document.hidden) {
        if (controller) attempted = false
        controller?.abort()
        controller = null
        setLoading(false)
      } else if (!attempted || (autoRefresh && Date.now() >= nextCheckAt)) refresh()
      else if (autoRefresh) timer = setTimeout(() => refresh(), nextCheckAt - Date.now())
    }
    refresh(forceRefresh)
    document.addEventListener('visibilitychange', visibility)
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); controller?.abort() }
  }, [key, monitoredPositions, allowed, masked, revision, autoRefresh])

  return { feed: allowed && !masked && result?.key === key ? result.feed : EMPTY_FEED, loading: allowed && !masked && loading, ready: !allowed || masked || monitoredPositions.length === 0 || result?.key === key, refresh: () => setRevision((value) => value + 1) }
}
