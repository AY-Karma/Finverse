interface MarketHoliday {
  date: string
  name: string
}

// NSE cash-market closures. Update from the annual circular and any amendments.
// https://nsearchives.nseindia.com/content/circulars/CMTR71775.pdf
// https://nsearchives.nseindia.com/content/circulars/CMTR72260.pdf
const HOLIDAYS_BY_YEAR: Readonly<Record<string, readonly MarketHoliday[]>> = {
  '2026': [
    { date: '2026-01-15', name: 'Maharashtra municipal elections' },
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-03-03', name: 'Holi' },
    { date: '2026-03-26', name: 'Shri Ram Navami' },
    { date: '2026-03-31', name: 'Shri Mahavir Jayanti' },
    { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-04-14', name: 'Dr. Baba Saheb Ambedkar Jayanti' },
    { date: '2026-05-01', name: 'Maharashtra Day' },
    { date: '2026-05-28', name: 'Bakri Id' },
    { date: '2026-06-26', name: 'Muharram' },
    { date: '2026-09-14', name: 'Ganesh Chaturthi' },
    { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti' },
    { date: '2026-10-20', name: 'Dussehra' },
    { date: '2026-11-10', name: 'Diwali-Balipratipada' },
    { date: '2026-11-24', name: 'Guru Nanak Jayanti' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
}

const IST_OFFSET_MS = 330 * 60_000
const DAY_MS = 24 * 60 * 60_000
const MARKET_OPEN_MIN = 9 * 60 + 15
const MARKET_CLOSE_MIN = 15 * 60 + 30

function istClock(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS)
}

function regularTradingDay(day: Date): boolean {
  const weekday = day.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const calendarDate = day.toISOString().slice(0, 10)
  return !HOLIDAYS_BY_YEAR[calendarDate.slice(0, 4)]?.some((holiday) => holiday.date === calendarDate)
}

/** Preserve weekday polling when a future year's exchange calendar is not yet bundled. */
export function isRegularMarketOpen(date: Date): boolean {
  const ist = istClock(date)
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return minutes >= MARKET_OPEN_MIN && minutes < MARKET_CLOSE_MIN && regularTradingDay(ist)
}

function sessionTime(day: Date, minutes: number, direction: -1 | 1): Date | null {
  const candidate = new Date(day)
  while (HOLIDAYS_BY_YEAR[String(candidate.getUTCFullYear())]) {
    if (regularTradingDay(candidate)) {
      return new Date(candidate.getTime() + minutes * 60_000 - IST_OFFSET_MS)
    }
    candidate.setUTCDate(candidate.getUTCDate() + direction)
  }
  return null
}

/** Scheduled regular sessions, independent of quote freshness and the dev live override. */
export function getMarketCalendarInfo(now: Date) {
  const ist = istClock(now)
  const year = ist.getUTCFullYear()
  const today = new Date(Date.UTC(year, ist.getUTCMonth(), ist.getUTCDate()))
  const calendarDate = today.toISOString().slice(0, 10)
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  const calendar = HOLIDAYS_BY_YEAR[String(year)]
  const lastDay = new Date(today.getTime() - (minutes < MARKET_CLOSE_MIN ? DAY_MS : 0))
  const nextDay = new Date(today.getTime() + (minutes >= MARKET_OPEN_MIN ? DAY_MS : 0))

  return {
    year,
    available: Boolean(calendar),
    lastSessionClose: calendar ? sessionTime(lastDay, MARKET_CLOSE_MIN, -1) : null,
    nextSessionOpen: calendar ? sessionTime(nextDay, MARKET_OPEN_MIN, 1) : null,
    holidays: (calendar ?? []).filter((holiday) => holiday.date >= calendarDate).map((holiday) => ({
      ...holiday,
      daysAway: Math.round((Date.parse(`${holiday.date}T00:00:00Z`) - today.getTime()) / DAY_MS),
    })),
  }
}
