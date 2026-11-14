import { useId } from 'react'
import { dateFormatter } from '../formatters'
import type { MarketStory } from '../marketStories'
import './marketStoryChart.css'

export function MarketStoryChart({ points, label }: { points: MarketStory['marketChart']; label: string }) {
  const gradient = useId()
  if (!points || points.length < 2) return <p className="market-story-chart-empty">Chart unavailable.</p>
  const first = points[0]
  const last = points[points.length - 1]
  const change = last.close - first.close
  const tone = change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral'
  const low = Math.min(...points.map((point) => point.close))
  const high = Math.max(...points.map((point) => point.close))
  const start = Date.parse(first.date)
  const duration = Date.parse(last.date) - start
  const coordinates = points.map((point) => ({
    x: 12 + (Date.parse(point.date) - start) / duration * 336,
    y: high === low ? 70 : 120 - (point.close - low) / (high - low) * 100,
  }))
  const line = coordinates.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  const end = coordinates[coordinates.length - 1]
  const openingY = coordinates[0].y
  const date = (value: string) => dateFormatter({ day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
  return <figure className={`market-story-chart story-tone--${tone}`} aria-label={`${label}, ${date(first.date)} to ${date(last.date)}`}>
    <svg viewBox="0 0 360 144" fill="none" aria-hidden="true" focusable="false">
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".18" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      <path d="M12 20h336M12 70h336M12 120h336" className="market-story-chart-grid" />
      <path d={`M12 ${openingY}h336`} className="market-story-chart-baseline" />
      <path d={`${line} L348 140 L12 140 Z`} fill={`url(#${gradient})`} />
      <path d={line} className="market-story-chart-line" pathLength="1" />
      <circle cx={end.x} cy={end.y} r="8" fill="currentColor" opacity=".12" />
      <circle cx={end.x} cy={end.y} r="3.5" fill="currentColor" />
    </svg>
    <div className="market-story-chart-dates"><time dateTime={first.date}>{date(first.date)}</time><time dateTime={last.date}>{date(last.date)}</time></div>
  </figure>
}
