import { useEffect, useId, useMemo, useState } from 'react'
import type { LiveQuote, Position } from '../types'
import { marketData } from '../marketData'
import { calculateHoldingMarketMoves, holdingMovePeriod, holdingMoveToday, uniqueMarketHoldings, type HoldingMoveRange, type HoldingPriceHistories, type HoldingMarketMove } from '../holdingMarketMoves'
import { formatCurrency, formatPercent, hasSupportedValuationCurrency, quoteKey } from '../valuation'
import { DitherBar } from './DitherBar'
import './holdingMarketMoves.css'

export function HoldingMarketMoves({ positions, quotes, allowExternalData, range, customFrom }: {
  positions: Position[]
  quotes: Record<string, LiveQuote>
  allowExternalData: boolean
  range: HoldingMoveRange
  customFrom: string
}) {
  const explanationId = useId()
  const [explanationOpen, setExplanationOpen] = useState(false)
  const today = holdingMoveToday()
  const period = holdingMovePeriod(range, customFrom, today)
  const holdings = useMemo(() => uniqueMarketHoldings(positions), [positions])
  const key = JSON.stringify([period?.from, period?.to, holdings.map((holding) => [quoteKey(holding), holding.identityIssue])])
  const [state, setState] = useState<{ key: string; histories: HoldingPriceHistories; loading: boolean }>({ key: '', histories: {}, loading: false })

  useEffect(() => {
    if (!allowExternalData || !period) return
    let alive = true
    const controller = new AbortController()
    const candidates = holdings.filter((holding) => !holding.identityIssue && hasSupportedValuationCurrency(holding))
    setState({ key, histories: {}, loading: true })
    const run = async () => {
      const histories: HoldingPriceHistories = {}
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
        while (cursor < candidates.length && !controller.signal.aborted) {
          const position = candidates[cursor++]
          try {
            histories[quoteKey(position)] = await marketData.history(position, new Date(`${period.historyFrom}T00:00:00Z`), new Date(`${period.to}T23:59:59Z`), controller.signal)
          } catch { histories[quoteKey(position)] = [] }
        }
      }))
      if (alive) setState({ key, histories, loading: false })
    }
    void run()
    return () => { alive = false; controller.abort() }
  }, [allowExternalData, key])

  const active = state.key === key ? state : { histories: {}, loading: true }
  const result = useMemo(() => calculateHoldingMarketMoves(holdings, quotes, active.histories, period?.from ?? '', today), [holdings, quotes, active.histories, period?.from, today])
  if (!allowExternalData) return <p className="hint">Enable external market data in Settings to see period moves.</p>
  if (!period) return <p className="hint">Choose a valid start date through today.</p>
  if (active.loading) return <p className="hint" role="status">Loading market prices…</p>
  if (!result.rows.length) return <p className="hint">Opening and recent market prices are unavailable for this period. Imported statement prices are excluded.</p>
  const maximum = Math.max(...result.rows.map((row) => Math.abs(row.change)), 1)
  const column = (title: string, rows: HoldingMarketMove[], positive: boolean) => <div className="holding-move-column"><span className="score-label">{title}</span>{rows.slice(0, 5).map((row) => <div className="contribution-row" key={row.key}><div><span className="holding-move-identity"><span className="holding-move-name" title={row.label}>{row.label}</span><span className="holding-move-pct">{formatPercent(row.changePct)}</span></span><strong className={positive ? 'up' : 'down'}>{formatCurrency(row.change)}</strong></div><DitherBar className="contribution-track" segments={[{ value: Math.abs(row.change), color: positive ? 'green' : 'red' }]} scale={maximum} /></div>)}{!rows.length && <p className="hint">No {positive ? 'positive' : 'negative'} moves.</p>}</div>
  return <div className="holding-market-moves">
    <div className="holding-move-summary"><strong className={result.totalChange >= 0 ? 'up' : 'down'}>{formatCurrency(result.totalChange)}</strong>
      <button type="button" className="risk-help holding-move-help" aria-label="How market moves are calculated" aria-expanded={explanationOpen} aria-describedby={explanationId} onClick={() => setExplanationOpen(!explanationOpen)} onBlur={() => setExplanationOpen(false)} onKeyDown={(event) => { if (event.key === 'Escape') setExplanationOpen(false) }}>i<span id={explanationId} role="tooltip" className="risk-help-popover">Today's quantities × price change. This shows current holdings at market prices, not your actual past profit. Sales, payments and past quantity changes are excluded.</span></button>
      <span className="hint">{period.from} through latest available market prices</span></div>
    <p className="hint">{result.coveredCount} of {result.totalCount} holdings covered</p>
    <div className="contribution-columns">{column('Positive moves', result.rows.filter((row) => row.change > 0).sort((a, b) => b.change - a.change), true)}{column('Negative moves', result.rows.filter((row) => row.change < 0).sort((a, b) => a.change - b.change), false)}</div>
    <details className="holding-move-details"><summary>All holding moves and price dates</summary><div className="holding-move-table-scroll"><table><thead><tr><th>Holding</th><th>Price dates</th><th>Price change</th><th>Move at current quantity</th></tr></thead><tbody>{[...result.rows].sort((a, b) => b.change - a.change).map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.from} → {row.through}</td><td>{formatPercent(row.changePct)}</td><td className={row.change >= 0 ? 'up' : 'down'}>{formatCurrency(row.change)}</td></tr>)}</tbody></table></div>{result.unavailable.length > 0 && <p className="hint">Unavailable for this period: {result.unavailable.join(', ')}.</p>}<p className="hint">Opening prices use the last available close before the period, within seven days of the previous calendar day. End prices use a provider quote or historical close from the past seven days.</p></details>
  </div>
}
