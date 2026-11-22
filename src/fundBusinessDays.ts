export interface FundBusinessCalendar {
  from: string
  through: string
  holidays: readonly string[]
  source: { label: string; url: string; amendments?: readonly string[] }
}

// Exchange-calendar estimate for non-ETF domestic equity SIPs, not an AMC allotment guarantee.
export const EQUITY_MF_MARKET_CALENDAR_2026: FundBusinessCalendar = {
  from: '2026-01-01', through: '2026-12-31',
  holidays: [
    '2026-01-15', '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31',
    '2026-04-03', '2026-04-14', '2026-05-01', '2026-05-28', '2026-06-26',
    '2026-09-14', '2026-10-02', '2026-10-20', '2026-11-10', '2026-11-24', '2026-12-25',
  ],
  source: {
    label: 'NSE MF Invest 2026',
    url: 'https://nsearchives.nseindia.com/content/circulars/NMF71897.pdf',
    amendments: ['https://nsearchives.nseindia.com/content/circulars/NMF72281.pdf'],
  },
}

type FundBusinessDate =
  | { status: 'available'; date: string; rolledForward: boolean }
  | { status: 'invalid-date' }
  | { status: 'calendar-unavailable' }

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T12:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

/** Calendar projection only: fund receipt and cut-off eligibility are separate. */
export function nextFundBusinessDate(scheduledDate: string, calendar?: FundBusinessCalendar): FundBusinessDate {
  if (!isCalendarDate(scheduledDate)) return { status: 'invalid-date' }
  if (!calendar || scheduledDate < calendar.from || scheduledDate > calendar.through) return { status: 'calendar-unavailable' }
  const candidate = new Date(`${scheduledDate}T12:00:00Z`)
  const holidays = new Set(calendar.holidays)
  while (candidate.toISOString().slice(0, 10) >= calendar.from && candidate.toISOString().slice(0, 10) <= calendar.through) {
    const date = candidate.toISOString().slice(0, 10)
    if (![0, 6].includes(candidate.getUTCDay()) && !holidays.has(date)) {
      return { status: 'available', date, rolledForward: date !== scheduledDate }
    }
    candidate.setUTCDate(candidate.getUTCDate() + 1)
  }
  return { status: 'calendar-unavailable' }
}
