import { useId } from 'react'
import { dateFormatter, numberFormatter } from '../formatters'
import { getMarketCalendarInfo } from '../marketCalendar'
import type { StoryInsight } from '../marketStories'
import { formatCurrency, formatPercent } from '../valuation'
import './personalStoryVisual.css'

const signedAmount = (value: number) => `${value > 0 ? '+' : ''}${formatCurrency(value)}`
const direction = (value: number) => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
const date = (value: string) => new Date(`${value}T00:00:00Z`)

function Coverage({ covered, total }: { covered: number; total: number }) {
  return <p className="personal-story-method">Price moves · current quantities{covered < total && <span>{covered} of {total} holdings covered</span>}</p>
}

export function PersonalStoryVisual({ insight, from, through }: { insight: StoryInsight; from?: string; through?: string }) {
  const holidayPattern = useId().replace(/:/g, '')
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
  const high = Math.max(0, ...days.map((day) => day.changePct))
  const low = Math.min(0, ...days.map((day) => day.changePct))
  const y = (value: number) => 24 + (high - value) / (high - low || 1) * 100
  const baseline = y(0)
  const chartHeight = Math.max(154, baseline + 54)
  const first = Date.parse(`${from ?? days[0]?.date ?? insight.date}T00:00:00Z`)
  const last = Date.parse(`${through ?? days[days.length - 1]?.date ?? insight.date}T00:00:00Z`)
  const calendarDays = Array.from({ length: Math.max(1, Math.round((last - first) / 86_400_000) + 1) }, (_, index) => new Date(first + index * 86_400_000).toISOString().slice(0, 10))
  const observations = new Map(days.map((day) => [day.date, day]))
  const slot = 400 / calendarDays.length
  return <div className={`personal-story personal-story--session personal-story--${direction(insight.change)}`}>
    <div className="personal-session-summary">
      <div className="personal-session-date">
        <strong>{dateFormatter({ day: 'numeric', timeZone: 'UTC' }).format(selected)}</strong>
        <span><b>{dateFormatter({ month: 'long', timeZone: 'UTC' }).format(selected)}</b><span>{dateFormatter({ weekday: 'long', timeZone: 'UTC' }).format(selected)} · {dateFormatter({ year: 'numeric', timeZone: 'UTC' }).format(selected)}</span></span>
      </div>
      <div className="personal-session-result"><strong>{signedAmount(insight.change)}</strong><span>{formatPercent(insight.changePct)}</span></div>
    </div>
    <figure className="personal-session-chart">
      <figcaption>Observed daily moves</figcaption>
      <svg viewBox={`0 0 400 ${chartHeight}`} role="img" aria-label="Daily percentage price moves. Highlighted date is the largest portfolio move.">
        <defs><pattern id={holidayPattern} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="7" stroke="var(--ink-muted)" strokeWidth="2" /></pattern></defs>
        <line x1="0" x2="400" y1={baseline} y2={baseline} className="personal-session-zero" />
        {calendarDays.map((calendarDate, index) => {
          const day = observations.get(calendarDate)
          const center = slot * (index + .5)
          const width = Math.min(40, slot * .65)
          if (!day) {
            const holiday = getMarketCalendarInfo(new Date(`${calendarDate}T12:00:00+05:30`)).holidays.find((item) => item.date === calendarDate)
            return <g key={calendarDate}>
              <title>{`${calendarDate}: ${holiday ? `Holiday · ${holiday.name}` : 'No price observation'}`}</title>
              {holiday && <>
                <rect className="personal-session-holiday" x={center - width / 2} y={baseline - 18} width={width} height="36" rx="3" fill={`url(#${holidayPattern})`} />
                {calendarDays.length <= 7 && <text x={center} y={baseline + 42} textAnchor="middle" className="personal-session-axis">Ø</text>}
              </>}
            </g>
          }
          const selectedDay = day.date === insight.date
          const color = day.changePct > 0 ? 'var(--semantic-success)' : day.changePct < 0 ? 'var(--semantic-danger)' : 'var(--ink)'
          return <g key={day.date}>
            <title>{`${dateFormatter({ day: 'numeric', month: 'long', timeZone: 'UTC' }).format(date(day.date))}: ${formatPercent(day.changePct)}`}</title>
            {day.changePct === 0
              ? <rect className="personal-session-neutral" x={center - width / 2} y={baseline - 6} width={width} height="12" rx="2" fill={color} />
              : <rect className={`personal-session-bar personal-session-bar--${day.changePct < 0 ? 'down' : 'up'}`} style={{ animationDelay: `${Math.min(index * 25, 100)}ms` }} x={center - width / 2} y={Math.min(baseline, y(day.changePct))} width={width} height={Math.abs(y(day.changePct) - baseline)} rx="3" fill={color} />}
            {(calendarDays.length <= 7 || selectedDay) && (day.changePct === 0 ? <>
              <text x={center} y={baseline - 15} textAnchor="middle" fill={color} className="personal-session-reading">Ø</text>
              <text x={center} y={baseline + 30} textAnchor="middle" fill={color} className="personal-session-reading">Ø</text>
            </> : <text x={index === 0 ? 12 : index === calendarDays.length - 1 ? 388 : center} y={y(day.changePct) + (day.changePct < 0 ? 20 : -9)} textAnchor={index === 0 ? 'start' : index === calendarDays.length - 1 ? 'end' : 'middle'} fill={color} className={`personal-session-reading${selectedDay ? ' personal-session-day--selected' : ''}`} aria-current={selectedDay ? 'date' : undefined} aria-label={`${day.date}: ${formatPercent(day.changePct)}`}>{formatPercent(day.changePct)}</text>)}
          </g>
        })}
      </svg>
    </figure>
    <div className="personal-session-driver"><span><small>Largest price impact</small><strong>{insight.leader}</strong></span><b className={`story-tone--${direction(insight.leaderChange)}`}>{signedAmount(insight.leaderChange)}</b></div>
    {insight.weeklyDrag !== undefined && (insight.weeklyDrag ? <div className="personal-session-driver personal-session-week-drag">
      <span><small>Largest drag · week</small><strong>{insight.weeklyDrag.label}</strong></span>
      <b className="story-tone--negative">{signedAmount(insight.weeklyDrag.change)} <small>{formatPercent(insight.weeklyDrag.changePct)}</small></b>
    </div> : <p className="personal-session-no-drag">No holding finished lower this week.</p>)}
  </div>
}
