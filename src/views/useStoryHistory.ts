import { useEffect, useMemo, useRef, useState } from 'react'
import { BENCHMARKS, marketData } from '../marketData'
import type { MarketStoryBenchmark } from '../marketStories'
import { calculateHoldingMarketMoves, holdingMovePeriod, uniqueMarketHoldings, type HoldingPriceHistories } from '../holdingMarketMoves'
import type { Position } from '../types'
import { hasSupportedValuationCurrency, quoteKey } from '../valuation'
import { historyPeriod, type StoryEdition } from '../recapSchedule'

const EMPTY_HISTORIES: HoldingPriceHistories = {}
const EMPTY_BENCHMARKS: MarketStoryBenchmark[] = []
const STORY_BENCHMARK_IDS = ['nifty-50', 'sensex', 'nifty-bank', 'nifty-next-50', 'nifty-midcap-50']

interface StoryHistory {
  histories: HoldingPriceHistories
  benchmarks: MarketStoryBenchmark[]
  loading: boolean
  ready: boolean
  failed: boolean
}

export function useStoryHistory(positions: Position[], enabled: boolean, today: string, edition?: StoryEdition) {
  const holdings = useMemo(() => uniqueMarketHoldings(positions).filter((position) => !position.identityIssue && hasSupportedValuationCurrency(position)), [positions])
  const includeBenchmarks = !edition || edition.id === 'portfolio'
  const period = edition ? historyPeriod(edition) : holdingMovePeriod('month', '', today)!
  const key = JSON.stringify([period.from, period.to, includeBenchmarks ? STORY_BENCHMARK_IDS : [], holdings.map((position) => [quoteKey(position), position.mfScheme?.code, position.pricingListing?.providerSymbol])])
  const [attempt, setAttempt] = useState(0)
  const loadedRequests = useRef(new Map<string, { attempt: number; at: number }>())
  const [states, setStates] = useState<Record<string, StoryHistory>>({})

  useEffect(() => {
    if (!enabled) return
    const loaded = loadedRequests.current.get(key)
    if (loaded?.attempt === attempt && Date.now() - loaded.at < 5 * 60_000) return
    const controller = new AbortController()
    let alive = true
    setStates((current) => ({ ...current, [key]: { ...(current[key] ?? { histories: {}, benchmarks: [], ready: false }), loading: true, failed: false } }))
    const run = async () => {
      const histories: HoldingPriceHistories = {}
      const indices = includeBenchmarks ? STORY_BENCHMARK_IDS.flatMap((id) => BENCHMARKS.filter((item) => item.id === id)) : []
      const benchmarks: MarketStoryBenchmark[] = indices.map((item) => ({ label: item.label, points: [] }))
      const from = new Date(`${period.historyFrom}T00:00:00Z`)
      const to = new Date(`${period.to}T23:59:59Z`)
      let cursor = 0
      let failed = false
      const jobs = [
        ...indices.map((item, index) => async () => {
          const points = await marketData.benchmarkHistory(item.symbol!, from, to, controller.signal)
          if (!points.length) failed = true
          benchmarks[index].points = points
        }),
        ...holdings.map((position) => async () => {
          const points = await marketData.history(position, from, to, controller.signal)
          if (!points.length) failed = true
          histories[quoteKey(position)] = points
        }),
      ]
      await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
        while (cursor < jobs.length && !controller.signal.aborted) {
          const job = jobs[cursor++]
          try { await job() } catch { failed = true }
        }
      }))
      if (calculateHoldingMarketMoves(holdings, {}, histories, period.from, period.to).coveredCount < holdings.length) failed = true
      if (alive) {
        loadedRequests.current.delete(key)
        loadedRequests.current.set(key, { attempt, at: Date.now() })
        if (loadedRequests.current.size > 8) loadedRequests.current.delete(loadedRequests.current.keys().next().value!)
        setStates((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([stored]) => loadedRequests.current.has(stored))), [key]: { histories, benchmarks, loading: false, ready: true, failed } }))
      }
    }
    void run()
    return () => { alive = false; controller.abort() }
  }, [enabled, key, attempt, includeBenchmarks])

  const state = enabled ? states[key] : undefined
  return {
    histories: state?.histories ?? EMPTY_HISTORIES,
    benchmarks: state?.benchmarks ?? EMPTY_BENCHMARKS,
    loading: enabled && (!state || state.loading),
    ready: !enabled || !!state?.ready,
    failed: state?.failed ?? false,
    retry: () => setAttempt((current) => current + 1),
  }
}
