import type { InvestmentSnapshot } from '../investmentWorkspace'
import { assetTypeLabel, instrumentLabel } from '../instruments'
import './SessionContributors.css'

export function SessionContributors({ snapshot, formatValue }: {
  snapshot: InvestmentSnapshot
  formatValue: (amount: number) => string
}) {
  const reported = snapshot.contributions.filter((item): item is typeof item & { dailyContribution: number } =>
    item.dailyContribution != null && Number.isFinite(item.dailyContribution),
  )
  const occurrences = new Map<string, number>()
  const ranked = reported.map((item) => {
    const identity = JSON.stringify([item.type, item.symbol])
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    return { ...item, key: `${identity}:${occurrence}` }
  }).filter((item) => item.dailyContribution !== 0)
    .sort((a, b) => Math.abs(b.dailyContribution) - Math.abs(a.dailyContribution))
  const topFive = ranked.slice(0, 5)
  const complete = snapshot.dailyChange != null && Number.isFinite(snapshot.dailyChange)
    && reported.length === snapshot.positions.length
  const reportedTotal = reported.reduce((sum, item) => sum + item.dailyContribution, 0)
  const total = complete ? snapshot.dailyChange ?? reportedTotal : reportedTotal
  const otherCount = reported.length - topFive.length
  const remainder = ranked.slice(5).reduce((sum, item) => sum + item.dailyContribution, 0)
  const largest = Math.max(...topFive.map((item) => Math.abs(item.dailyContribution)), 1)
  const signed = (amount: number) => `${amount > 0 ? '+' : amount < 0 ? '\u2212' : ''}${formatValue(Math.abs(amount))}`

  if (!reported.length) {
    return <div className="session-contributors-empty" role="status">
      <strong>Change amounts unavailable</strong>
      <p>Refresh prices on Overview to see what moved your holdings. If external market data is off, enable it in Settings first.</p>
    </div>
  }

  return <div className="session-contributors">
    <p className="session-contributors-note">{complete
      ? 'The card adds the change across all your holdings. The list shows up to five of the largest impacts, including rises and falls.'
      : 'Only holdings reporting a change for this session are shown. The whole-portfolio move is unavailable until every holding reports.'}</p>
    {topFive.length > 0 && <ol className="session-contributors-list" aria-label="Largest session contributions by amount">
      {topFive.map((item) => {
        const position = snapshot.positions.find((holding) => holding.type === item.type && instrumentLabel(holding) === item.symbol)
        const name = position?.name.trim() || item.symbol
        const direction = item.dailyContribution > 0 ? 'up' : 'down'
        return <li className={`session-contributors-row session-contributors-row--${direction}`} key={item.key}>
          <span className="session-contributors-name">
            <span title={name}>{name}</span>
            <small>{name !== item.symbol ? `${item.symbol} · ` : ''}{assetTypeLabel(item.type)}</small>
          </span>
          <span className="session-contributors-track" aria-hidden="true">
            <i style={{ width: `${Math.abs(item.dailyContribution) / largest * 100}%` }} />
          </span>
          <strong className={direction}>{signed(item.dailyContribution)}</strong>
        </li>
      })}
    </ol>}
    {!topFive.length && <div className="session-contributors-empty">
      <strong>No rise or fall reported</strong>
      <p>The {reported.length} reporting holding{reported.length === 1 ? '' : 's'} had no change in this session.</p>
    </div>}
    {topFive.length > 0 && otherCount > 0 && <div className="session-contributors-remainder">
      <span>Other reporting holdings <small>{otherCount} holding{otherCount === 1 ? '' : 's'}</small></span>
      <strong className={remainder > 0 ? 'up' : remainder < 0 ? 'down' : ''}>{signed(remainder)}</strong>
    </div>}
    <div className="session-contributors-total">
      <span>{complete ? 'All holdings combined' : 'Reported holdings combined'}</span>
      <strong className={total > 0 ? 'up' : total < 0 ? 'down' : ''}>{signed(total)}</strong>
    </div>
  </div>
}
