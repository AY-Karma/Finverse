import { useEffect, useMemo, useRef, useState } from 'react'
import { dateFormatter } from './formatters'
import { marketData } from './marketData'
import { applyPortfolioQuoteOverlay, buildPortfolioBackcast, type PortfolioBackcastHistory } from './portfolioBackcast'
import type { LiveQuote, Position } from './types'

const INITIAL_DAYS = 366
const PAGE_DAYS = 366
const MAX_DAYS = 3 * 366
const HISTORY_REUSE_MS = 5 * 60_000
const MAX_REUSABLE_SERIES = 9
const EMPTY_HISTORY: PortfolioBackcastHistory['points'] = []
type CachedHistory = { key: string; days: number; at: number; history: PortfolioBackcastHistory }

export function usePortfolioBackcast({ positions, quotes, allowExternalData }: {
  positions: Position[]
  quotes: Record<string, LiveQuote>
  allowExternalData: boolean
}) {
  const [historical, setHistorical] = useState<{ key: string; history: PortfolioBackcastHistory } | null>(null)
  const [reusableHistory, setReusableHistory] = useState(() => new Map<string, CachedHistory>())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const forceRefresh = useRef(false)
  const cancelRequest = useRef<(() => void) | null>(null)
  const [days, setDays] = useState(INITIAL_DAYS)
  const key = useMemo(() => JSON.stringify(positions.map((position) => [
    position.id, position.instrumentKey, position.identityIssue, position.ticker, position.type,
    position.quantity, position.invested, position.exchange, position.currency,
    position.reportedCurrency, position.providerSymbol, position.isin, position.mfScheme?.code, position.mfScheme?.name,
    position.pricingListing?.providerSymbol, position.pricingListing?.isin, position.pricingListing?.type,
  ])), [positions])
  const cacheKey = `${days}:${key}`
  const cached = reusableHistory.get(cacheKey)

  useEffect(() => {
    if (!allowExternalData || positions.length === 0) {
      if (!allowExternalData) {
        setReusableHistory((current) => current.size ? new Map() : current)
        setDays(INITIAL_DAYS)
      }
      setHistorical(null)
      setLoading(false)
      setError(false)
      return
    }
    if (cached && !forceRefresh.current && Date.now() >= cached.at && Date.now() - cached.at < HISTORY_REUSE_MS) {
      setHistorical(cached)
      setLoading(false)
      setError(false)
      return
    }
    forceRefresh.current = false
    let alive = true
    const controller = new AbortController()
    const cancel = () => {
      alive = false
      controller.abort()
      setLoading(false)
    }
    cancelRequest.current = cancel
    setLoading(true)
    setError(false)
    void buildPortfolioBackcast(positions, marketData, days, controller.signal).then((history) => {
      if (!alive) return
      if (history.points.length >= 2) {
        const entry = { key, days, at: Date.now(), history }
        setReusableHistory((current) => {
          const next = new Map(current)
          next.delete(cacheKey)
          next.set(cacheKey, entry)
          if (next.size > MAX_REUSABLE_SERIES) next.delete(next.keys().next().value!)
          return next
        })
      }
      if (history.points.length >= 2) setHistorical({ key, history })
      setError(history.points.length < 2)
      setLoading(false)
    }).catch(() => {
      if (!alive) return
      setError(true)
      setLoading(false)
    })
    return () => {
      alive = false
      controller.abort()
      if (cancelRequest.current === cancel) cancelRequest.current = null
    }
  }, [allowExternalData, days, key, cacheKey, cached, retryAttempt])

  const source = cached?.history ?? (historical?.key === key ? historical.history : null)
  const backcast = useMemo(() => allowExternalData && source
    ? applyPortfolioQuoteOverlay(source, positions, quotes)
    : null, [allowExternalData, source, positions, quotes])
  const history = backcast?.points ?? EMPTY_HISTORY
  const latest = history[history.length - 1]
  const observationDate = latest ? dateFormatter({ day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(latest.at) : null
  const observationLabel = observationDate ? `${backcast?.currentObservation ? 'Provider observations' : 'Historical close'} · ${observationDate} IST` : 'Latest observation'
  const requestMore = () => {
    if (loading || days >= MAX_DAYS) return
    setDays((current) => Math.min(MAX_DAYS, current + PAGE_DAYS))
  }

  const retry = () => {
    if (loading || !allowExternalData || positions.length === 0) return
    forceRefresh.current = true
    setRetryAttempt((current) => current + 1)
  }
  const cancel = () => cancelRequest.current?.()

  return { backcast, history, loading, error, refreshing: loading && history.length >= 2, retry, cancel, days, key, requestMore, observationLabel }
}
