import { numberFormatter, dateFormatter } from '../formatters'
import { isMarketOpen } from '../live'
import { getMarketCalendarInfo } from '../marketCalendar'
import { selectedMarketIndices } from '../marketIndexSelection'
import { useMarketIndexQuotes } from '../useMarketIndexQuotes'
import { TickerTape } from './TickerTape'

const level = numberFormatter({ minimumFractionDigits: 2, maximumFractionDigits: 2 })
const move = numberFormatter({ minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' })
const observed = dateFormatter({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

export function MarketIndexTicker({ allowed, indexIds }: { allowed: boolean; indexIds?: readonly string[] }) {
  const { quotes, loading, unavailable } = useMarketIndexQuotes(allowed, indexIds)
  const now = Date.now()
  const open = isMarketOpen(new Date(now))
  const lastClose = getMarketCalendarInfo(new Date(now)).lastSessionClose?.getTime()
  return <TickerTape>{selectedMarketIndices(indexIds).map((index) => {
    const quote = quotes[index.symbol]
    const saved = Boolean(quote && unavailable.includes(index.symbol))
    const delayed = Boolean(index.region === 'India' && quote && (open ? now - quote.at > 5 * 60_000 : lastClose && quote.at < lastClose - 5 * 60_000))
    const trend = quote?.change ?? quote?.pct ?? 0
    const direction = trend > 0 ? 'up' : trend < 0 ? 'down' : 'muted'
    return <div className="ticker-item" key={index.id} title={quote ? `${index.label} · As of ${observed.format(quote.at)} IST${saved ? ' · Saved quote' : delayed ? ' · Delayed quote' : ''}` : `${index.label} · Quote unavailable`}>
      <span className="ticker-sym">{index.label}</span>
      <span className="ticker-quote">
        <span className="ticker-val">{quote ? level.format(quote.price) : '—'}</span>
        {quote ? <span className={`ticker-delta ${direction}`}><span>{quote.change === null ? '—' : move.format(quote.change)}</span>{' '}<span>({quote.pct === null ? '—' : `${move.format(quote.pct)}%`})</span></span> : <span className="ticker-status muted">{loading ? 'Loading' : 'Unavailable'}</span>}
        {quote && (saved || delayed) && <span className="ticker-status muted">{saved ? 'Saved' : 'Delayed'}</span>}
      </span>
    </div>
  })}</TickerTape>
}
