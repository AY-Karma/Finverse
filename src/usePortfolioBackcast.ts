import { useEffect, useMemo, useState } from 'react'
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
      return
    }
    if (cached && Date.now() >= cached.at && Date.now() - cached.at < HISTORY_REUSE_MS) {
      setHistorical(cached)
      setLoading(false)
      return
    }
    let alive = true
    const controller = new AbortController()
    setLoading(true)
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
      setHistorical({ key, history })
      setLoading(false)
    }).catch(() => {
      if (!alive) return
      setHistorical(null)
      setLoading(false)
    })
    return () => {
      alive = false
      controller.abort()
    }
  }, [allowExternalData, days, key, cacheKey, cached])

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

  return { backcast, history, loading, days, key, requestMore, observationLabel }
}
