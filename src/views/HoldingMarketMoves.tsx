import { useEffect, useMemo, useRef, useState } from 'react'
import type { LiveQuote, Position } from '../types'
import { marketData } from '../marketData'
import { calculateHoldingMarketMoves, holdingMovePeriod, holdingMoveToday, uniqueMarketHoldings, type HoldingMoveRange, type HoldingPriceHistories, type HoldingMarketMove } from '../holdingMarketMoves'
import { formatCurrency, formatPercent, hasSupportedValuationCurrency, quoteKey } from '../valuation'
import { DitherBar } from './DitherBar'
import { MovementCalculationHelp } from './MovementCalculationHelp'
import './holdingMarketMoves.css'

export function HoldingMarketMoves({ positions, quotes, allowExternalData, range, customFrom }: {
  positions: Position[]
  quotes: Record<string, LiveQuote>
  allowExternalData: boolean
  range: HoldingMoveRange
  customFrom: string
}) {
  const today = holdingMoveToday()
  const period = holdingMovePeriod(range, customFrom, today)
  const holdings = useMemo(() => uniqueMarketHoldings(positions), [positions])
  const key = JSON.stringify([period?.from, period?.to, holdings.map((holding) => [quoteKey(holding), holding.identityIssue])])
  const [state, setState] = useState<{ key: string; histories: HoldingPriceHistories; loading: boolean }>({ key: '', histories: {}, loading: false })
  const [retryAttempt, setRetryAttempt] = useState(0)
  const loadedRequest = useRef('')
  const requestKey = `${key}:${retryAttempt}`

  useEffect(() => {
    if (!allowExternalData || !period) { loadedRequest.current = ''; return }
    if (loadedRequest.current === requestKey) return
    let alive = true
    const controller = new AbortController()
    const candidates = holdings.filter((holding) => !holding.identityIssue && hasSupportedValuationCurrency(holding))
    setState((current) => ({ key, histories: current.key === key ? current.histories : {}, loading: true }))
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
      if (alive) { loadedRequest.current = requestKey; setState({ key, histories, loading: false }) }
    }
    void run()
    return () => { alive = false; controller.abort() }
  }, [allowExternalData, key, requestKey])

  const active = state.key === key ? state : { histories: {}, loading: true }
  const result = useMemo(() => calculateHoldingMarketMoves(holdings, quotes, active.histories, period?.from ?? '', today), [holdings, quotes, active.histories, period?.from, today])
  if (!allowExternalData) return <p className="hint">Enable external market data in Settings to see period moves.</p>
  if (!period) return <p className="hint">Choose a valid start date through today.</p>
  if (active.loading && !result.rows.length) return <p className="hint" role="status">Loading market prices…</p>
  return <>
    <HoldingMarketMoveResults result={result} from={period.from} />
    {result.coveredCount < result.totalCount && <button type="button" className="benchmark-retry" disabled={active.loading} onClick={() => setRetryAttempt((attempt) => attempt + 1)}>{active.loading ? 'Retrying missing prices…' : 'Retry period prices'}</button>}
  </>
}

export function HoldingMarketMoveResults({ result, from, compact = false }: {
  result: ReturnType<typeof calculateHoldingMarketMoves>
  from: string
  compact?: boolean
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const ranked = useMemo(() => result.rows.filter((row) => row.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)), [result.rows])
  const rowsByChange = useMemo(() => [...result.rows].sort((a, b) => b.change - a.change), [result.rows])
  if (!result.rows.length) return <p className="hint">Opening and recent market prices are unavailable for this period. Imported statement prices are excluded.</p>
  const largest = ranked.slice(0, 5)
  const others = ranked.slice(5)
  const remainingChange = others.reduce((sum, row) => sum + row.change, 0)
  const maximum = Math.max(...result.rows.map((row) => Math.abs(row.change)), 1)
  const column = (title: string, rows: HoldingMarketMove[], positive: boolean) => <div className="holding-move-column"><span className="score-label">{title}</span>{rows.slice(0, 5).map((row) => <div className="contribution-row" key={row.key}><div><span className="holding-move-identity"><span className="holding-move-name" title={row.label}>{row.label}</span><span className="holding-move-pct">{formatPercent(row.changePct)}</span></span><strong className={positive ? 'up' : 'down'}>{formatCurrency(row.change)}</strong></div><DitherBar className="contribution-track" segments={[{ value: Math.abs(row.change), color: positive ? 'green' : 'red' }]} scale={maximum} /></div>)}{!rows.length && <p className="hint">No {positive ? 'positive' : 'negative'} moves.</p>}</div>
  return <div className={`holding-market-moves${compact ? ' holding-market-moves--compact' : ''}`}>
    {compact ? <div className="movement-breakdown-head"><span className="score-label">Largest contributors</span><MovementCalculationHelp /></div> : <>
      <div className="holding-move-summary"><strong className={result.totalChange > 0 ? 'up' : result.totalChange < 0 ? 'down' : undefined}>{formatCurrency(result.totalChange)}</strong><MovementCalculationHelp /><span className="hint">{from} through latest available market prices</span></div>
      <p className="hint">{result.coveredCount} of {result.totalCount} holdings covered</p>
    </>}
    {compact ? <>
      {largest.length > 0 ? <ol className="holding-move-ranked-list" aria-label="Largest period contributions by amount">
        {largest.map((row) => <li className="holding-move-ranked-row" key={row.key}>
          <span className="holding-move-identity"><span className="holding-move-name" title={row.label}>{row.label}</span><span className="holding-move-pct">{formatPercent(row.changePct)}</span></span>
          <strong className={row.change > 0 ? 'up' : 'down'}>{row.change > 0 ? '+' : ''}{formatCurrency(row.change)}</strong>
          <DitherBar className="holding-move-ranked-track" segments={[{ value: Math.abs(row.change), color: row.change > 0 ? 'green' : 'red' }]} scale={maximum} />
        </li>)}
      </ol> : <p className="hint">No rise or fall over this period.</p>}
      {others.length > 0 && <div className="holding-move-remainder"><span>Other holdings <small>{others.length}</small></span><strong className={remainingChange > 0 ? 'up' : remainingChange < 0 ? 'down' : undefined}>{remainingChange > 0 ? '+' : ''}{formatCurrency(remainingChange)}</strong></div>}
    </> : <div className="contribution-columns">{column('Positive moves', result.rows.filter((row) => row.change > 0).sort((a, b) => b.change - a.change), true)}{column('Negative moves', result.rows.filter((row) => row.change < 0).sort((a, b) => a.change - b.change), false)}</div>}
    <details className="holding-move-details" onToggle={(event) => { if (event.target === event.currentTarget) setDetailsOpen(event.currentTarget.open) }}>
      <summary>All holding moves <span>{result.coveredCount}</span></summary>
      {detailsOpen && <div className="holding-move-table-scroll"><table>
        <thead><tr><th scope="col">Holding</th><th scope="col">Price change</th><th scope="col">Impact</th></tr></thead>
        <tbody>{rowsByChange.map((row) => <tr key={row.key}><td title={`Price observations: ${row.from} to ${row.through}`}>{row.label}</td><td>{formatPercent(row.changePct)}</td><td className={row.change > 0 ? 'up' : row.change < 0 ? 'down' : undefined}>{formatCurrency(row.change)}</td></tr>)}</tbody>
      </table></div>}
      {result.unavailable.length > 0 && <details className="holding-move-unavailable"><summary>Unavailable for this period <span>{result.unavailable.length}</span></summary><p className="hint">{result.unavailable.join(', ')}</p></details>}
    </details>
  </div>
}
