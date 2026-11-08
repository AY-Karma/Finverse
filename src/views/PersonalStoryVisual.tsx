import type { CSSProperties } from 'react'
import { dateFormatter, numberFormatter } from '../formatters'
import type { StoryInsight } from '../marketStories'
import { formatCurrency, formatPercent } from '../valuation'
import './personalStoryVisual.css'

const signedAmount = (value: number) => `${value > 0 ? '+' : ''}${formatCurrency(value)}`
const direction = (value: number) => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
const date = (value: string) => new Date(`${value}T00:00:00Z`)

function Coverage({ covered, total }: { covered: number; total: number }) {
  return <p className="personal-story-method">Price moves · current quantities{covered < total && <span>{covered} of {total} holdings covered</span>}</p>
}

export function PersonalStoryVisual({ insight }: { insight: StoryInsight }) {
  if (insight.kind === 'bridge') {
    const low = Math.min(0, insight.net)
    const high = insight.gains > 0 ? insight.gains : 1
    const y = (value: number) => 42 + (high - value) / (high - low) * 155
    const columns = [
      { label: 'Lift', start: 0, end: insight.gains, amount: insight.gains, x: 35, color: 'var(--semantic-success)' },
      { label: 'Drag', start: insight.gains, end: insight.net, amount: insight.losses, x: 169, color: 'var(--semantic-danger)' },
      { label: 'Net', start: 0, end: insight.net, amount: insight.net, x: 303, color: insight.net < 0 ? 'var(--semantic-danger)' : insight.net > 0 ? 'var(--semantic-success)' : 'var(--ink)' },
    ]
    return <div className="personal-story personal-story--bridge">
      <figure className="personal-bridge-chart" aria-label={`Positive price changes ${signedAmount(insight.gains)}, negative price changes ${signedAmount(insight.losses)}, net movement ${signedAmount(insight.net)}.`}>
        <svg viewBox="0 0 400 270" fill="none" aria-hidden="true" focusable="false">
          <path d={`M20 ${y(0)}H380`} stroke="var(--hairline-strong)" />
          <path d={`M99 ${y(insight.gains)}H169M233 ${y(insight.net)}H303`} stroke="var(--ink-faint)" strokeDasharray="3 5" />
          {columns.map((column, index) => {
            const top = Math.min(y(column.start), y(column.end))
            const bottom = Math.max(y(column.start), y(column.end))
            return <g key={column.label}>
              {column.amount !== 0 ? <rect className={`personal-bridge-column${column.amount < 0 ? ' personal-bridge-column--fall' : ''}`} style={{ animationDelay: `${index * .12}s` }} x={column.x} y={top} width="64" height={Math.max(.5, bottom - top)} rx="3" fill={column.color} fillOpacity={index === 1 ? '.72' : '1'} /> : <path d={`M${column.x} ${top}h64`} stroke={column.color} strokeWidth="2" />}
              <text x={column.x + 32} y={column.amount < 0 && index === 2 ? bottom + 21 : top - 12} textAnchor="middle" fill={column.color}>{signedAmount(column.amount)}</text>
              <text className="personal-bridge-column-label" x={column.x + 32} y="248" textAnchor="middle">{column.label}</text>
            </g>
          })}
        </svg>
      </figure>
      <div className="personal-session-driver"><span><small>Largest drag</small><strong>{insight.leader}</strong></span><b className={`story-tone--${direction(insight.leaderChange)}`}>{signedAmount(insight.leaderChange)}</b></div>
      <Coverage covered={insight.covered} total={insight.total} />
    </div>
  }
  if (insight.kind === 'driver') {
    const share = Math.max(0, Math.min(100, insight.share))
    const negative = insight.change < 0
    const ledger = [
      { label: 'Price gains', amount: insight.gains },
      { label: 'Price losses', amount: insight.losses },
      { label: 'Net movement', amount: insight.net },
    ].filter((row) => row.amount !== 0 || row.label === 'Net movement')
    return <div className={`personal-story personal-story--driver personal-story--${direction(insight.change)}`}>
      <div className="personal-driver-spotlight">
        <div className={`personal-driver-name${insight.symbol.length > 24 ? ' personal-driver-name--long' : ''}`}><strong>{insight.symbol}</strong>{insight.name !== insight.symbol && <span>{insight.name}</span>}</div>
        <div className="personal-driver-share"><strong>{numberFormatter({ maximumFractionDigits: 1 }).format(share)}<span>%</span></strong><span>of {negative ? 'negative' : 'positive'} price moves</span></div>
        <div className="personal-driver-rail" aria-hidden="true"><i style={{ width: `${share}%` }} /></div>
        <p className="personal-driver-amount"><strong>{signedAmount(insight.change)}</strong><span>price contribution</span></p>
      </div>
      <dl className="personal-story-ledger">
        {ledger.map((row) => <div key={row.label} className={row.label === 'Net movement' ? 'personal-story-net' : undefined}><dt>{row.label}</dt><dd className={`story-tone--${direction(row.amount)}`}>{signedAmount(row.amount)}</dd></div>)}
      </dl>
      <Coverage covered={insight.covered} total={insight.total} />
    </div>
  }

  const selected = date(insight.date)
  const days = [...insight.days].sort((a, b) => a.date.localeCompare(b.date))
  const maximum = Math.max(...days.map((day) => Math.abs(day.changePct)), 0.01)
  return <div className={`personal-story personal-story--session personal-story--${direction(insight.change)}`}>
    <div className="personal-session-date">
      <strong>{dateFormatter({ day: 'numeric', timeZone: 'UTC' }).format(selected)}</strong>
      <span><b>{dateFormatter({ month: 'long', timeZone: 'UTC' }).format(selected)}</b><span>{dateFormatter({ weekday: 'long', timeZone: 'UTC' }).format(selected)} · {dateFormatter({ year: 'numeric', timeZone: 'UTC' }).format(selected)}</span></span>
    </div>
    <div className="personal-session-grid" role="list" aria-label="Observed session price movements">
      {days.map((day) => <span key={day.date} role="listitem" className={`personal-session-day personal-session-day--${direction(day.changePct)}${day.date === insight.date ? ' personal-session-day--selected' : ''}`}
        style={{ '--session-strength': Math.max(.12, Math.abs(day.changePct) / maximum) } as CSSProperties}
        aria-current={day.date === insight.date ? 'date' : undefined}
        aria-label={`${dateFormatter({ day: 'numeric', month: 'long', timeZone: 'UTC' }).format(date(day.date))}: ${formatPercent(day.changePct)}`}
        title={`${dateFormatter({ day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date(day.date))} · ${formatPercent(day.changePct)}`}>
        {dateFormatter({ day: 'numeric', timeZone: 'UTC' }).format(date(day.date))}
      </span>)}
    </div>
    <div className="personal-session-result"><strong>{signedAmount(insight.change)}</strong><span>{formatPercent(insight.changePct)}</span></div>
    <div className="personal-session-driver"><span><small>Largest price impact</small><strong>{insight.leader}</strong></span><b className={`story-tone--${direction(insight.leaderChange)}`}>{signedAmount(insight.leaderChange)}</b></div>
    <Coverage covered={insight.covered} total={insight.total} />
  </div>
}
