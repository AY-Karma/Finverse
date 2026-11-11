import { numberFormatter, dateFormatter } from '../formatters'
import { isMarketOpen } from '../live'
import { getMarketCalendarInfo } from '../marketCalendar'
import { MARKET_INDICES } from '../marketIndexQuotes'
import { useMarketIndexQuotes } from '../useMarketIndexQuotes'
import { TickerTape } from './TickerTape'

const level = numberFormatter({ minimumFractionDigits: 2, maximumFractionDigits: 2 })
const move = numberFormatter({ minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' })
const observed = dateFormatter({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

export function MarketIndexTicker({ allowed }: { allowed: boolean }) {
  const { quotes, loading, unavailable } = useMarketIndexQuotes(allowed)
  const now = Date.now()
  const open = isMarketOpen(new Date(now))
  const lastClose = getMarketCalendarInfo(new Date(now)).lastSessionClose?.getTime()
  return <TickerTape>{MARKET_INDICES.map((index) => {
    const quote = quotes[index.symbol]
    const saved = Boolean(quote && unavailable.includes(index.symbol))
    const delayed = Boolean(quote && (open ? now - quote.at > 5 * 60_000 : lastClose && quote.at < lastClose - 5 * 60_000))
    const trend = quote?.change ?? quote?.pct ?? 0
    const direction = trend > 0 ? 'up' : trend < 0 ? 'down' : 'muted'
    return <div className="ticker-item" key={index.id} title={quote ? `${index.label} · As of ${observed.format(quote.at)} IST${saved ? ' · Saved quote' : delayed ? ' · Delayed quote' : ''}` : `${index.label} · Quote unavailable`}>
      <span className="ticker-sym">{index.label}</span>
      <span className="ticker-quote">
        <span className="ticker-val">{quote ? level.format(quote.price) : loading ? 'Loading…' : 'Unavailable'}</span>
        {quote && <span className={`ticker-delta ${direction}`}>{quote.change === null ? '—' : move.format(quote.change)} ({quote.pct === null ? '—' : `${move.format(quote.pct)}%`})</span>}
        {quote && (saved || delayed) && <span className="ticker-status muted">{saved ? 'Saved' : 'Delayed'}</span>}
      </span>
    </div>
  })}</TickerTape>
}
