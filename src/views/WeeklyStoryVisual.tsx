import { dateFormatter } from '../formatters'
import type { WeeklyStoryContent } from '../weeklyStories'
import { formatCurrency, formatPercent } from '../valuation'
import './weeklyStoryVisual.css'

const amount = (value: number) => `${value > 0 ? '+' : ''}${formatCurrency(value)}`
const tone = (value: number) => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
const asDate = (date: string) => new Date(`${date}T00:00:00Z`)
const shortDate = (date: string) => dateFormatter({ day: 'numeric', month: 'short', timeZone: 'UTC' }).format(asDate(date))
const eventLabels = { results: 'Results', meeting: 'Board meeting', dividend: 'Dividend', 'corporate-action': 'Corporate action', filing: 'Filing' }

export function WeeklyStoryVisual({ content }: { content: WeeklyStoryContent }) {
  if (content.kind === 'sectors') {
    const maximum = Math.max(...content.sectors.map((sector) => Math.abs(sector.change)), 1)
    return <div className="weekly-story weekly-story--sectors">
      <div className="weekly-sector-result"><strong className={`story-tone--${tone(content.net)}`}>{amount(content.net)}</strong><span>Net move in classified stocks</span></div>
      <ol className="weekly-sector-list">
        {content.sectors.map((sector) => <li key={sector.label}>
          <div className="weekly-sector-figures"><strong>{sector.label}</strong><span className={`story-tone--${tone(sector.change)}`}><b>{amount(sector.change)}</b><small>{formatPercent(sector.changePct)}</small></span></div>
          <div className="weekly-sector-rail" aria-hidden="true"><i className={`story-tone--${tone(sector.change)}`} style={{ left: `${sector.change < 0 ? 50 - Math.abs(sector.change) / maximum * 50 : 50}%`, width: `${Math.abs(sector.change) / maximum * 50}%` }} /></div>
        </li>)}
      </ol>
      <p className="weekly-story-scope">Your stocks · current quantities<span>{shortDate(content.from)} → {shortDate(content.through)}{content.covered < content.total ? ` · ${content.covered} of ${content.total} stocks covered` : ''}</span></p>
    </div>
  }
  return <div className="weekly-story weekly-story--events">
    <p className="weekly-watch-range">{shortDate(content.from)} – {shortDate(content.through)}</p>
    <ol className="weekly-event-list">
      {content.events.map((event) => <li key={`${event.id}:${event.instrumentIdentity}`}>
        <time className="weekly-event-date" dateTime={event.date}><strong>{dateFormatter({ day: 'numeric', timeZone: 'UTC' }).format(asDate(event.date))}</strong><span>{dateFormatter({ month: 'short', timeZone: 'UTC' }).format(asDate(event.date))}</span></time>
        <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" title={event.title} aria-label={`${event.holdingName}: ${event.title}. ${event.dateLabel}, ${shortDate(event.date)}. Source NSE.`}>
          <strong>{event.symbol}</strong><span>{eventLabels[event.kind]} · {event.dateLabel}</span>
        </a>
      </li>)}
    </ol>
    <p className="weekly-story-scope">Confirmed by NSE<span>Announced dates for your current holdings</span></p>
  </div>
}
