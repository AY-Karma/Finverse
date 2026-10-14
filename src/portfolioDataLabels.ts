import type { InvestmentSnapshot } from './investmentWorkspace'
import { hasSupportedValuationCurrency } from './valuation'

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
})

/** Shared dates and coverage wording for the Overview and Insights. */
export function portfolioDataLabels(snapshot: InvestmentSnapshot) {
  const total = snapshot.positions.length
  const supportedPositions = snapshot.positions.filter(hasSupportedValuationCurrency)
  const sessionTotal = supportedPositions.length
  const sessionHoldings = sessionTotal < total ? 'INR holdings' : 'holdings'
  const date = snapshot.dailyChangeDate
    ? DATE_FORMATTER.format(new Date(`${snapshot.dailyChangeDate}T00:00:00+05:30`)) : null
  const sessionValue = snapshot.dailyChange ?? snapshot.reportedDailyChange
  const isPartialSession = snapshot.dailyChange == null && sessionValue != null
  const sessionLabel = `${date ? `Latest session · ${date}` : 'Session move'}${isPartialSession ? ' · Partial' : ''}`
  const pendingFunds = supportedPositions.filter((holding) => holding.type === 'mutual-fund').length
    - snapshot.contributions.filter((holding) => holding.type === 'mutual-fund' && holding.dailyChange != null).length
  const coverageLabel = snapshot.dailyChangeCount
    ? isPartialSession
      ? `${snapshot.dailyChangeCount} of ${sessionTotal} ${sessionHoldings} included${pendingFunds ? ` · ${pendingFunds} fund${pendingFunds === 1 ? '' : 's'} awaiting session updates` : ' · Remaining updates pending'}`
      : `${snapshot.dailyChangeCount} of ${sessionTotal} ${sessionHoldings} report changes`
    : 'No change amounts reported'

  if (snapshot.quotedCount === 0) {
    return {
      sessionLabel, coverageLabel, sessionValue, isPartialSession,
      healthLabel: snapshot.pricedCount ? 'Imported only' : 'No prices',
      healthDetail: `${snapshot.pricedCount} of ${total} holdings have imported prices · Freshness unknown`,
    }
  }

  const times = Object.values(snapshot.quotes).map((quote) => quote.at)
  const oldest = DATE_FORMATTER.format(new Date(Math.min(...times)))
  const latest = DATE_FORMATTER.format(new Date(Math.max(...times)))
  return {
    sessionLabel, coverageLabel, sessionValue, isPartialSession,
    healthLabel: snapshot.quotedCount < total ? 'Partial quotes' : snapshot.staleQuotes > 0 ? 'Older quotes' : 'Quoted',
    healthDetail: `${snapshot.quotedCount} of ${total} holdings quoted · As of ${oldest === latest ? latest : `${oldest} to ${latest}`}${snapshot.staleQuotes ? ` · ${snapshot.staleQuotes} older than 24h` : ''}`,
  }
}
