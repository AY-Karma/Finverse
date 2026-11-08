import { useEffect, useRef, useState } from 'react'
import { loadMarketBriefing, MARKET_BRIEFING_VERSION, type MarketBriefingStory } from '../marketBriefing'
import type { Position } from '../types'
import type { StoryEdition } from '../recapSchedule'

const EMPTY_ITEMS: MarketBriefingStory[] = []
interface BriefingState { items: MarketBriefingStory[]; issues: string[]; loading: boolean; ready: boolean }

export function useMarketBriefing(edition: StoryEdition, positions: Position[], enabled: boolean) {
  const cadence = edition.id === 'weekly' || edition.id === 'monthly' ? edition.id : undefined
  const ranking = cadence ? 'recap' : 'app'
  const identity = ranking === 'app' ? positions.map((position) => [position.ticker, position.name, position.type, position.exchange]) : []
  const key = JSON.stringify([MARKET_BRIEFING_VERSION, ranking, cadence, edition.from, edition.through, identity])
  const [states, setStates] = useState<Record<string, BriefingState>>({})
  const [attempt, setAttempt] = useState(0)
  const completed = useRef(new Map<string, { at: number; attempt: number }>())

  useEffect(() => {
    if (!enabled) return
    const previous = completed.current.get(key)
    if (previous?.attempt === attempt && Date.now() - previous.at < 10 * 60_000) return
    const controller = new AbortController()
    let alive = true
    setStates((current) => ({ ...current, [key]: { ...(current[key] ?? { items: [], issues: [], ready: false }), loading: true } }))
    void loadMarketBriefing({ from: edition.from, through: edition.through, positions, ranking, cadence, signal: controller.signal, forceRefresh: attempt > 0 }).then((result) => {
      if (!alive) return
      completed.current.delete(key)
      completed.current.set(key, { at: Date.now(), attempt })
      if (completed.current.size > 8) completed.current.delete(completed.current.keys().next().value!)
      setStates((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([stored]) => completed.current.has(stored))), [key]: { ...result, loading: false, ready: true } }))
    }).catch(() => {
      if (alive) setStates((current) => ({ ...current, [key]: { items: current[key]?.items ?? [], issues: ['Market news is unavailable.'], loading: false, ready: true } }))
    })
    return () => { alive = false; controller.abort() }
  }, [enabled, key, attempt])

  const state = enabled ? states[key] : undefined
  return { items: state?.items ?? EMPTY_ITEMS, loading: enabled && (!state || state.loading), ready: !enabled || !!state?.ready, failed: !!state?.issues.length, retry: () => setAttempt((value) => value + 1) }
}
