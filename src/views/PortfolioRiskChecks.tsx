import { useMemo, useState, type ReactNode } from 'react'
import { calculatePortfolioRisk } from '../portfolioRisk'
import type { PortfolioBackcastHistory } from '../portfolioBackcast'
import { dateFormatter, numberFormatter } from '../formatters'
import type { DitherColor } from '../components/dither-kit/palette'
import { RiskHelp } from './RiskHelp'
import { DitherBar } from './DitherBar'
import './portfolioRiskChecks.css'

export function PortfolioRiskChecks({ history, hideValues, pricedCount, loading, coverage }: {
  history: PortfolioBackcastHistory['points']
  hideValues: boolean
  pricedCount: number
  loading: boolean
  coverage: string | null
}) {
  const risk = useMemo(() => calculatePortfolioRisk(history), [history])
  return <section className="portfolio-risk-checks" aria-label="Portfolio risk checks">
    <div className="panel-head"><div className="panel-head-titles"><span className="panel-title">Portfolio risk checks</span><span className="section-index">At a glance</span></div></div>
    {history.length >= 2 && pricedCount > 0 ? <RiskProfile risk={risk} history={history} hideValues={hideValues}
      historyStart={history[0].at} historyEnd={history[history.length - 1].at} coverage={coverage} />
      : <div className="chart-empty">{pricedCount === 0 ? 'Current prices are unavailable. Risk checks need priced holdings.' : loading ? 'Historical prices are loading to build your risk profile.' : 'Historical risk is unavailable. Tracked balance changes include account changes and cash flows.'}</div>}
  </section>
}

type RiskStatus = 'lower' | 'watch' | 'high'
const RISK_COLORS: Record<RiskStatus | 'hidden', DitherColor> = { lower: 'green', watch: 'orange', high: 'red', hidden: 'grey' }

function riskStatus(value: number, watchAt: number, highAt: number): RiskStatus {
  if (value >= highAt) return 'high'
  if (value >= watchAt) return 'watch'
  return 'lower'
}

function RiskProfile({ risk, history, hideValues, coverage, historyStart, historyEnd }: { risk: ReturnType<typeof calculatePortfolioRisk>; history: PortfolioBackcastHistory['points']; hideValues: boolean; coverage: string | null; historyStart: number; historyEnd: number }) {
  const [openDefinition, setOpenDefinition] = useState<string | null>(null)
  const { current, volatility } = risk
  const mask = (text: string) => hideValues ? '••••' : text
  const amount = (value: number) => mask(numberFormatter({ style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value))
  const date = (at: number) => dateFormatter({ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(at)
  const historyBasis = "Today's holdings at past prices. Uses every historical observation."
  const riskRows = [
    {
      id: 'below-high',
      label: 'Current drop from peak',
      value: Math.abs(current),
      scaleMax: 30,
      watchAt: 10,
      highAt: 20,
      formula: 'Value = (latest high - latest value) ÷ latest high × 100.',
      definition: 'Compares the latest value with the highest value reached before it. 0% means it is back at that high.',
      basis: historyBasis,
    },
    {
      id: 'time-below-peak',
      label: 'Time below peak',
      value: risk.daysBelowPeak,
      scaleMax: 180,
      unit: ' days',
      watchAt: 30,
      highAt: 90,
      reading: risk.daysBelowPeak == null ? 'Unavailable' : risk.daysBelowPeak === 0 && current < 0 ? 'Less than 1 day' : `${risk.daysBelowPeak} ${risk.daysBelowPeak === 1 ? 'day' : 'days'}`,
      formula: 'Value = latest observation date − most recent peak date, in calendar days.',
      definition: 'Shows how long the latest value has been below its high within the loaded history. Equal highs reset the date; recovery shows 0 days. Earlier unseen peaks are not included.',
      basis: `${historyBasis} Meter scale: 0 to 180 days; longer periods fill the meter.`,
    },
    {
      id: 'yearly-movement',
      label: 'Yearly swings',
      value: volatility,
      summary: volatility == null ? 'Daily closes are required for a yearly estimate.' : 'Variation in daily returns, annualised.',
      scaleMax: 40,
      watchAt: 15,
      highAt: 25,
      formula: 'Value = daily return standard deviation × √252 × 100.',
      definition: 'Estimates the size of return swings. Gains and losses both count; this is not a loss probability.',
      basis: "Today's holdings at past prices. Longer gaps and the latest app valuation are excluded.",
    },
    {
      id: 'down-sessions',
      label: 'Down sessions',
      value: risk.downSessionPct,
      reading: `${risk.downSessions} of ${risk.observedSessions}`,
      detail: risk.downSessionPct == null ? undefined : `${risk.downSessionPct.toFixed(1)}%`,
      summary: 'Observed sessions that closed lower.',
      scaleMax: 100,
      watchAt: 45,
      highAt: 55,
      formula: 'Share = falling close changes ÷ all eligible close changes × 100.',
      definition: 'Counts falls between consecutive market closes. Gains and flat sessions stay in the total. Missing-session gaps and the current live valuation are excluded. This is observed frequency, not a forecast.',
      basis: "Today's holdings at past prices. Uses eligible close changes within the loaded history.",
    },
  ].map((row) => ({
    ...row,
    status: row.value == null ? null : riskStatus(row.value, row.watchAt, row.highAt),
  }))

  return (
    <div className="risk-profile">
      <div className="risk-bars">
        {riskRows.map((row) => {
          const tooltipId = `risk-definition-${row.id}`
          const isOpen = openDefinition === row.id
          const statusLabel = row.status == null ? 'Unavailable' : row.status === 'lower' ? 'Good' : row.status === 'watch' ? 'To watch' : 'High'
          const displayedStatus = hideValues || row.status == null ? 'hidden' : row.status
          const reading = row.value == null ? 'Unavailable' : row.reading ?? `${row.value.toFixed(1)}%`
          const unit = row.unit ?? '%'
          const readingContent = <div className="risk-reading">
            <strong>{mask(row.value == null ? '—' : reading)}</strong>
            <div className="risk-reading-meta">
              {!hideValues && row.detail && <span className="risk-observation">{row.detail}</span>}
              <span className={`risk-status risk-status--${displayedStatus}`}>{hideValues ? 'Hidden' : statusLabel}</span>
            </div>
          </div>
          return (
            <article className={`risk-bar risk-bar--${displayedStatus}`} key={row.id} data-risk={row.id}>
              <div className="risk-bar-head">
                <div>
                  <span className="risk-label">
                    {row.label}
                    <RiskHelp id={tooltipId} label={row.label} open={isOpen} onOpenChange={open => setOpenDefinition(open ? row.id : null)}>
                        <strong>{row.label}</strong>
                        <span>{row.definition}</span>
                        <span><b>Formula</b> {row.formula}</span>
                        <span><b>App guide</b> Good below {row.watchAt}{unit} · To watch from {row.watchAt}{unit} · High from {row.highAt}{unit}</span>
                        <small>{row.basis} App-defined screening bands.</small>
                    </RiskHelp>
                  </span>
                  {row.id !== 'below-high' && row.id !== 'time-below-peak' && <span className="risk-summary">{row.summary}</span>}
                </div>
                {row.id === 'below-high' && readingContent}
              </div>

              {row.id === 'below-high' && <div className="risk-breakdown">
                <dl className="risk-calculation" aria-label="Current drop calculation">
                  <div className="risk-calculation-stat"><dt>Peak value</dt><dd><strong>{amount(risk.peakValue)}</strong></dd></div>
                  <div className={`risk-calculation-stat risk-calculation-result${!hideValues && risk.peakValue > risk.currentValue ? ' risk-calculation-result--loss' : ''}`}>
                    <dt><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 4 8 8M6 12h6V6" /></svg>Below peak</dt>
                    <dd><strong>{amount(risk.peakValue - risk.currentValue)}</strong></dd>
                  </div>
                  <div className="risk-calculation-stat"><dt>Latest value</dt><dd><strong>{amount(risk.currentValue)}</strong></dd></div>
                </dl>
                {!hideValues && coverage && <small className="risk-calculation-basis">{coverage}</small>}
              </div>}

              {row.id === 'below-high' && !hideValues && risk.peakAt != null && risk.peakValue > 0 && <DrawdownChart history={history} peakAt={risk.peakAt} peakValue={risk.peakValue} formatDate={date} />}

              {row.id === 'time-below-peak' && <div className="risk-time-breakdown">
                <div className="risk-timeline" role="group" aria-label="Time below peak calculation">
                  <dl className="risk-timeline-date">
                    <dt>Last observed peak</dt>
                    <dd><strong>{hideValues ? mask('') : risk.peakAt == null ? 'Unavailable' : <time dateTime={new Date(risk.peakAt).toISOString()}>{date(risk.peakAt)}</time>}</strong></dd>
                  </dl>
                  <div className="risk-timeline-reading">{readingContent}</div>
                  <dl className="risk-timeline-date">
                    <dt>Latest reading</dt>
                    <dd><strong>{hideValues ? mask('') : <time dateTime={new Date(historyEnd).toISOString()}>{date(historyEnd)}</time>}</strong></dd>
                  </dl>
                </div>
                {!hideValues && risk.daysBelowPeak === 0 && <p className="risk-summary risk-recovery-note">{current < 0 ? 'Below peak since today.' : 'Latest value is at its observed peak.'}</p>}
              </div>}

              {row.id === 'yearly-movement' && (!hideValues && volatility != null
                ? <DailyReturnSpread returns={risk.dailyReturns} reading={readingContent} />
                : <div className="risk-centered-reading">{readingContent}</div>)}

              {row.id === 'down-sessions' && (!hideValues && risk.observedSessions > 0 ? <div className="risk-session-split">
                <div className="risk-session-counts">
                  <div className="risk-session-outcome"><span><i className="risk-session-dot risk-session-dot--down" />Lower closes</span><strong>{risk.downSessions}</strong></div>
                  {readingContent}
                  <div className="risk-session-outcome"><span><i className="risk-session-dot" />Higher or flat</span><strong>{risk.observedSessions - risk.downSessions}</strong></div>
                </div>
                <div className="risk-session-ratio" role="img" aria-label={`${risk.downSessions} lower closes and ${risk.observedSessions - risk.downSessions} higher or unchanged closes`}>
                  <span style={{ flexGrow: risk.downSessions }} />
                  <span style={{ flexGrow: risk.observedSessions - risk.downSessions }} />
                </div>
              </div> : <div className="risk-centered-reading">{readingContent}</div>)}

              {row.id !== 'down-sessions' && row.id !== 'below-high' && <div className="risk-track" role="img" aria-label={hideValues ? `${row.label}: hidden` : `${row.label}: ${reading}, ${statusLabel}. Bar scale 0 to ${row.scaleMax}${unit}.`}>
                <span className="risk-track-zone risk-track-zone--lower" style={{ width: `${row.watchAt / row.scaleMax * 100}%` }} />
                <span className="risk-track-zone risk-track-zone--watch" style={{ width: `${(row.highAt - row.watchAt) / row.scaleMax * 100}%` }} />
                <span className="risk-track-zone risk-track-zone--high" style={{ width: `${(row.scaleMax - row.highAt) / row.scaleMax * 100}%` }} />
                <DitherBar segments={[{ value: hideValues ? 0 : row.value ?? 0, color: RISK_COLORS[displayedStatus] }]} scale={row.scaleMax} />
              </div>}

            </article>
          )
        })}
      </div>
      {!hideValues && <small className="risk-history-basis">Current holdings at past prices · {date(historyStart)} to {date(historyEnd)}</small>}
    </div>
  )
}

function DrawdownChart({ history, peakAt, peakValue, formatDate }: {
  history: PortfolioBackcastHistory['points']
  peakAt: number
  peakValue: number
  formatDate: (at: number) => string
}) {
  const points = history.filter(point => point.at >= peakAt)
  const latest = points[points.length - 1]
  if (!latest) return null
  const floor = Math.min(...points.map(point => point.value))
  const range = Math.max(peakValue - floor, peakValue * .01)
  const duration = latest.at - peakAt
  const coordinates = points.map(point => ({
    x: duration > 0 ? 8 + (point.at - peakAt) / duration * 464 : 472,
    y: 10 + (peakValue - point.value) / range * 88,
  }))
  const path = coordinates.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
  const last = coordinates[coordinates.length - 1]
  const belowPeak = latest.value < peakValue
  return <div className={`risk-drawdown-chart${belowPeak ? ' is-below-peak' : ''}`}>
    <div className="risk-drawdown-chart-head"><span>Since the last peak</span><span>{belowPeak ? 'Below peak' : 'At peak'}</span></div>
    <svg viewBox="0 0 480 110" preserveAspectRatio="none" role="img" aria-label="Portfolio value from its last observed peak to the latest reading. The shaded gap shows the drop from that peak.">
      <path className="risk-drawdown-reference" d="M8 10H472" />
      {belowPeak && <path className="risk-drawdown-area" d={`${path} L${last.x} 10 L${coordinates[0].x} 10 Z`} />}
      <path className="risk-drawdown-path" d={path} />
      <circle cx={last.x} cy={last.y} r="3.5" />
    </svg>
    <div className="risk-drawdown-dates"><time dateTime={new Date(peakAt).toISOString()}>{formatDate(peakAt)}</time><time dateTime={new Date(latest.at).toISOString()}>{formatDate(latest.at)}</time></div>
  </div>
}

function DailyReturnSpread({ returns, reading }: { returns: number[]; reading: ReactNode }) {
  const recent = returns.slice(-30)
  const largest = Math.max(...recent.map(Math.abs), 0.001)
  return <div className="risk-daily-spread">
    <div className="risk-daily-spread-head"><span>Recent daily moves</span><small>Last {recent.length} eligible sessions</small></div>
    <div className="risk-daily-columns" role="img" aria-label={`Daily percentage changes across the last ${recent.length} eligible sessions. Bars above zero are gains; bars below zero are falls.`}>
      <span className="risk-daily-zero">0</span>
      <span className="risk-daily-limit risk-daily-limit--high">+{(largest * 100).toFixed(1)}%</span>
      <span className="risk-daily-limit risk-daily-limit--low">−{(largest * 100).toFixed(1)}%</span>
      {recent.map((change, index) => <span className="risk-daily-column" key={index} title={`${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`} aria-hidden="true">
        <i className={change < 0 ? 'is-negative' : change === 0 ? 'is-flat' : ''} style={{ height: `${Math.abs(change) / largest * 50}%`, top: change < 0 ? '50%' : undefined, bottom: change >= 0 ? '50%' : undefined }} />
      </span>)}
    </div>
    <div className="risk-daily-scale"><span>Earlier</span>{reading}<span>Latest</span></div>
  </div>
}
