import { useEffect, useRef, useState } from 'react'
import type { Position } from '../types'
import { marketData } from '../marketData'
import type { HistoryPoint } from '../live'
import { downsampleSeries } from '../timeSeries'
import { InteractiveTrendChart } from './InteractiveTrendChart'

const DAY_MS = 86400000
type HistoryRow = { at: number; price: number | undefined }

function hasMissingWeekday(previous: number, next: number): boolean {
  if (next - previous >= 7 * DAY_MS) return true
  for (let at = previous + DAY_MS; at < next; at += DAY_MS) {
    const day = new Date(at).getUTCDay()
    if (day !== 0 && day !== 6) return true
  }
  return false
}

function historyRows(history: HistoryPoint[]): HistoryRow[] {
  let breakBefore = false
  const dated = history.flatMap((point) => {
    const at = Date.parse(point?.date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point?.date) || !Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== point.date) {
      breakBefore = true
      return []
    }
    const row = { at, price: Number.isFinite(point.close) && point.close > 0 ? point.close : undefined, breakBefore }
    breakBefore = false
    return [row]
  }).sort((a, b) => a.at - b.at)
  const rows: HistoryRow[] = []
  for (const point of new Map(dated.map((row) => [row.at, row])).values()) {
    const previous = rows[rows.length - 1]
    if (previous && previous.price !== undefined && (point.breakBefore || hasMissingWeekday(previous.at, point.at))) {
      rows.push({ at: previous.at + (point.at - previous.at) / 2, price: undefined })
    }
    rows.push({ at: point.at, price: point.price })
  }
  const valid = rows.flatMap((row, index) => row.price === undefined ? [] : [{ ...row, index }])
  const sampled = downsampleSeries(valid, 180)
  const result: HistoryRow[] = []
  let previousIndex = -1
  for (const row of sampled) {
    if (previousIndex >= 0) {
      const gap = rows.slice(previousIndex + 1, row.index).find((item) => item.price === undefined)
      if (gap) result.push(gap)
    }
    result.push({ at: row.at, price: row.price })
    previousIndex = row.index
  }
  return result
}

export function ResearchHistory({ position, allowed, active, format }: {
  position: Position; allowed: boolean; active: boolean; format: (value: number) => string
}) {
  const [days, setDays] = useState(365)
  const [requested, setRequested] = useState(false)
  const [points, setPoints] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const positionRef = useRef(position)
  positionRef.current = position
  const requestIdentity = JSON.stringify(position.type === 'mutual-fund'
    ? [position.type, position.name || position.ticker]
    : [position.type, position.ticker, position.exchange || '', position.providerSymbol || ''])
  useEffect(() => {
    if (!allowed || !active || !requested) { setPoints([]); setLoading(false); return }
    const controller = new AbortController()
    setPoints([])
    setLoading(true)
    setError(false)
    const to = new Date()
    const from = new Date(to.getTime() - days * DAY_MS)
    void marketData.history(positionRef.current, from, to, controller.signal).then((history) => {
      if (controller.signal.aborted) return
      const rows = historyRows(history)
      setPoints(rows)
      setError(rows.filter((row) => row.price !== undefined).length < 2)
    }).catch(() => { if (!controller.signal.aborted) setError(true) }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [requestIdentity, active, allowed, requested, days, retry])
  const isFund = position.type === 'mutual-fund'
  return <section className="rd-section rd-history">
    <div className="rd-section-head"><div><h3>{isFund ? 'NAV history' : 'Price history'}</h3><p>Daily observations. This is market performance, not your investment return.</p></div></div>
    {!allowed ? <p className="rd-callout">Enable external data in Settings to load history.</p>
      : !requested ? <button type="button" className="btn btn--secondary" onClick={() => setRequested(true)}>Load {isFund ? 'NAV' : 'price'} history</button>
      : <>
        <div className="rd-range" aria-label="History period">{[{ days: 90, label: '3 months' }, { days: 365, label: '1 year' }, { days: 1095, label: '3 years' }].map((range) => <button key={range.days} type="button" aria-pressed={days === range.days} onClick={() => setDays(range.days)}>{range.label}</button>)}</div>
        {loading ? <p className="rd-callout" role="status">Loading daily history...</p> : error ? <div className="rd-callout" role="status">History is unavailable for this investment. Source links are still available. <button type="button" className="btn btn--ghost btn--small" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>
          : allowed && points.length >= 2 && <><InteractiveTrendChart rows={points} lines={[{ key: 'price', label: isFund ? 'NAV' : 'Price', color: 'var(--primary-hover)' }]} valueFormatter={format} yAxisLabel={isFund ? 'NAV' : 'Price'} appearance="price" showArea={false} /><p className="rd-footnote">{isFund ? 'Daily NAV via the current mutual-fund data connection.' : 'Daily closes via the current public market-data connection.'} Missing weekday observations and invalid data break the line; weekends may be connected. Availability is best effort.</p></>}
      </>}
  </section>
}
