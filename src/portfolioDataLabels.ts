import type { InvestmentSnapshot } from './investmentWorkspace'

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
})

/** Shared dates and coverage wording for the Overview and Insights. */
export function portfolioDataLabels(snapshot: InvestmentSnapshot) {
  const total = snapshot.positions.length
  const date = snapshot.dailyChangeDate
    ? DATE_FORMATTER.format(new Date(`${snapshot.dailyChangeDate}T00:00:00+05:30`)) : null
  const sessionLabel = date ? `Latest session · ${date}` : 'Session move'
  const coverageLabel = snapshot.dailyChangeCount
    ? `${snapshot.dailyChangeCount} of ${total} holdings report changes${snapshot.dailyChange == null ? ' · Portfolio move unavailable' : ''}`
    : 'No change amounts reported'

  if (snapshot.quotedCount === 0) {
    return {
      sessionLabel, coverageLabel,
      healthLabel: snapshot.pricedCount ? 'Imported only' : 'No prices',
      healthDetail: `${snapshot.pricedCount} of ${total} holdings have imported prices · Freshness unknown`,
    }
  }

  const times = Object.values(snapshot.quotes).map((quote) => quote.at)
  const oldest = DATE_FORMATTER.format(new Date(Math.min(...times)))
  const latest = DATE_FORMATTER.format(new Date(Math.max(...times)))
  return {
    sessionLabel, coverageLabel,
    healthLabel: snapshot.quotedCount < total ? 'Partial quotes' : snapshot.staleQuotes > 0 ? 'Older quotes' : 'Quoted',
    healthDetail: `${snapshot.quotedCount} of ${total} holdings quoted · As of ${oldest === latest ? latest : `${oldest} to ${latest}`}${snapshot.staleQuotes ? ` · ${snapshot.staleQuotes} older than 24h` : ''}`,
  }
}
