import { useEffect, useMemo, useState } from 'react'
import { dateFormatter } from './formatters'
import { marketData } from './marketData'
import { applyPortfolioQuoteOverlay, buildPortfolioBackcast, type PortfolioBackcastHistory } from './portfolioBackcast'
import type { LiveQuote, Position } from './types'

const INITIAL_DAYS = 366
const PAGE_DAYS = 366
const MAX_DAYS = 3 * 366
const EMPTY_HISTORY: PortfolioBackcastHistory['points'] = []

export function usePortfolioBackcast({ positions, quotes, allowExternalData }: {
  positions: Position[]
  quotes: Record<string, LiveQuote>
  allowExternalData: boolean
}) {
  const [historical, setHistorical] = useState<{ key: string; history: PortfolioBackcastHistory } | null>(null)
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(INITIAL_DAYS)
  const key = useMemo(() => JSON.stringify(positions.map((position) => [
    position.id, position.instrumentKey, position.identityIssue, position.ticker, position.type,
    position.quantity, position.invested, position.exchange, position.currency,
    position.reportedCurrency, position.providerSymbol, position.mfScheme?.code,
  ])), [positions])

  useEffect(() => {
    if (!allowExternalData || positions.length === 0) {
      setHistorical(null)
      setLoading(false)
      setDays(INITIAL_DAYS)
      return
    }
    let alive = true
    const controller = new AbortController()
    setLoading(true)
    void buildPortfolioBackcast(positions, marketData, days, controller.signal).then((history) => {
      if (!alive) return
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
  }, [allowExternalData, days, key])

  const backcast = useMemo(() => allowExternalData && historical?.key === key && historical.history
    ? applyPortfolioQuoteOverlay(historical.history, positions, quotes)
    : null, [allowExternalData, historical, key, positions, quotes])
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
