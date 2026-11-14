import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { dateFormatter, numberFormatter } from '../formatters'
import type { IpoGmpPoint } from '../ipoGmpHistoryProtocol'
import { ActionIcon } from './ActionIcon'
import './ipoGmpTrend.css'

const money = numberFormatter({ style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const day = dateFormatter({ day: 'numeric', month: 'short', timeZone: 'UTC' })
const dateLabel = (date: string) => day.format(new Date(`${date}T00:00:00Z`))
const DAY_MS = 86_400_000

function geometry(points: IpoGmpPoint[], width: number, height: number, inset: number) {
  const start = Date.parse(points[0].date), end = Date.parse(points.at(-1)!.date)
  const amounts = points.map((point) => point.amount)
  const low = Math.min(...amounts), high = Math.max(...amounts)
  const coordinates = points.map((point) => ({
    x: end === start ? width / 2 : inset + (Date.parse(point.date) - start) / (end - start) * (width - 2 * inset),
    y: high === low ? height / 2 : height - inset - (point.amount - low) / (high - low) * (height - 2 * inset),
  }))
  const line = coordinates.map((point, index) => {
    const gap = index > 0 && Date.parse(points[index].date) - Date.parse(points[index - 1].date) > DAY_MS
    return `${index === 0 || gap ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  }).join(' ')
  const difference = points.at(-1)!.amount - points[0].amount
  return { coordinates, line, low, high, tone: difference > 0 ? 'up' : difference < 0 ? 'down' : 'flat' }
}

export function IpoGmpSparkline({ points, status = 'ready' }: { points: IpoGmpPoint[]; status?: 'loading' | 'ready' | 'error' }) {
  if (!points.length) return <span className="mi-trend-placeholder" aria-hidden="true">{status === 'loading' ? '…' : '—'}</span>
  const plot = geometry(points, 48, 22, 3)
  return <svg className="mi-sparkline" viewBox="0 0 48 22" fill="none" data-tone={plot.tone} aria-hidden="true">
    <path d={plot.line} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    {plot.coordinates.map((point, index) => <circle key={points[index].date} cx={point.x} cy={point.y} r={index === points.length - 1 ? 2 : 1} fill="currentColor" />)}
  </svg>
}

export function IpoGmpTrend({ name, points, sourceUrl, status, onRetry, onClose, id }: {
  name: string; points: IpoGmpPoint[]; sourceUrl: string | null
  status: 'loading' | 'ready' | 'error'; onRetry: () => void; onClose: () => void; id: string
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const selectedIndex = points.findIndex((point) => point.date === selected)
  const activeIndex = selectedIndex < 0 ? points.length - 1 : selectedIndex
  const active = points[activeIndex]
  const plot = points.length ? geometry(points, 360, 164, 16) : null
  const selectFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(16, Math.min(344, (event.clientX - rect.left) / rect.width * 360))
    if (!plot) return
    const index = plot.coordinates.reduce((nearest, point, index) => Math.abs(point.x - x) < Math.abs(plot.coordinates[nearest].x - x) ? index : nearest, 0)
    setSelected(points[index].date)
  }
  const selectFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    let index = activeIndex
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') index--
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') index++
    else if (event.key === 'Home') index = 0
    else if (event.key === 'End') index = points.length - 1
    else return
    event.preventDefault()
    setSelected(points[Math.max(0, Math.min(points.length - 1, index))].date)
  }

  return <section className="mi-trend" id={id} aria-label={`${name} daily GMP trend`}>
    <div className="mi-trend-head"><h3>GMP trend</h3><button type="button" className="mi-trend-close" aria-label={`Close ${name} GMP trend`} onClick={onClose}><ActionIcon name="close" /></button></div>
    {plot && active ? <>
      <div className="mi-trend-reading" aria-live="polite"><time dateTime={active.date}>{dateLabel(active.date)}</time><strong>{money.format(active.amount)}</strong></div>
      <div className="mi-trend-chart"><div className="mi-trend-scale" aria-hidden="true"><span>{money.format(plot.high)}</span>{plot.high !== plot.low && <span>{money.format(plot.low)}</span>}</div><div className="mi-trend-series"><div className="mi-trend-plot" role="slider" tabIndex={0} aria-label={`${name} daily GMP`} aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={activeIndex} aria-valuetext={`${dateLabel(active.date)}, GMP ${money.format(active.amount)}`} onKeyDown={selectFromKeyboard} onPointerDown={selectFromPointer} onPointerMove={(event) => { if (event.pointerType === 'mouse' || event.buttons === 1) selectFromPointer(event) }}>
        <svg viewBox="0 0 360 164" preserveAspectRatio="none" fill="none" data-tone={plot.tone} aria-hidden="true">
          <path className="mi-trend-grid" d="M16 16H344M16 82H344M16 148H344" />
          <path d={plot.line} stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          {plot.coordinates.map((point, index) => <circle key={points[index].date} cx={point.x} cy={point.y} r="2.5" fill="currentColor" />)}
          <path className="mi-trend-cursor" d={`M${plot.coordinates[activeIndex].x} 16V148`} />
          <circle cx={plot.coordinates[activeIndex].x} cy={plot.coordinates[activeIndex].y} r="5" fill="var(--surface-1)" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <div className="mi-trend-dates"><time dateTime={points[0].date}>{dateLabel(points[0].date)}</time>{points.length > 1 && <time dateTime={points.at(-1)!.date}>{dateLabel(points.at(-1)!.date)}</time>}</div>
      </div></div>
      <p className="mi-trend-source">{points.length === 1 ? 'One reported day' : 'Reported days only'}{sourceUrl && <> · <a href={sourceUrl} target="_blank" rel="noopener noreferrer">GMP Today <ActionIcon name="external" /></a></>}</p>
      {status === 'error' && <div className="mi-trend-message" role="status"><span>Showing saved history.</span><button className="mp-text-button" type="button" onClick={onRetry}>Retry</button></div>}
    </> : <div className="mi-trend-message" role="status"><p>{status === 'loading' ? 'Loading daily GMP…' : status === 'error' ? 'Daily GMP could not be loaded.' : 'Daily GMP history is unavailable for this IPO.'}</p>{status === 'error' && <button type="button" className="mp-text-button" onClick={onRetry}>Try again</button>}</div>}
  </section>
}
