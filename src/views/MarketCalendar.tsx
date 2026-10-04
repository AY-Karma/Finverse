import { useEffect, useRef, useState } from 'react'
import { getMarketCalendarInfo } from '../marketCalendar'

const HOLIDAY_NOTICE_MS = 6_000
const HOLIDAY_NOTICE_KEY = 'finverse:marketHolidayNotice'

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short',
})
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function MarketCalendar({ now }: { now: Date }) {
  const calendar = getMarketCalendarInfo(now)
  const nextHoliday = calendar.holidays[0]
  const holidayToday = nextHoliday?.daysAway === 0 ? nextHoliday : undefined
  const holidayDate = holidayToday?.date ?? null
  const [display, setDisplay] = useState<'closed' | 'manual' | 'automatic'>('closed')
  const notifiedHoliday = useRef<string | null>(null)

  useEffect(() => {
    if (!holidayDate) {
      setDisplay((current) => current === 'automatic' ? 'closed' : current)
      return
    }
    try {
      if (sessionStorage.getItem(HOLIDAY_NOTICE_KEY) === holidayDate && notifiedHoliday.current !== holidayDate) return
      sessionStorage.setItem(HOLIDAY_NOTICE_KEY, holidayDate)
    } catch {
      // Keep the notice usable when browser storage is unavailable.
    }
    notifiedHoliday.current = holidayDate
    setDisplay((current) => current === 'manual' ? current : 'automatic')
    const timer = window.setTimeout(() => {
      setDisplay((current) => current === 'automatic' ? 'closed' : current)
    }, HOLIDAY_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [holidayDate])

  const keepOpen = () => setDisplay((current) => current === 'automatic' ? 'manual' : current)

  return (
    <section className="market-calendar" aria-label="NSE market calendar">
      <details className="market-calendar-details" open={display !== 'closed'} onPointerDown={keepOpen} onFocusCapture={keepOpen}>
        <summary onClick={(event) => {
          event.preventDefault()
          setDisplay((current) => current === 'closed' ? 'manual' : 'closed')
        }}>
          <span className="market-calendar-label">Market calendar</span>
          <span className={`market-calendar-toggle-hint${holidayToday ? ' market-calendar-toggle-hint--holiday' : ''}`}>
            {holidayToday ? 'Holiday today' : 'Sessions & holidays'}
          </span>
        </summary>
        <div className="market-calendar-expanded">
          {holidayToday && <p className="market-calendar-holiday" role="status">Market closed today · {holidayToday.name}</p>}
          <dl className="market-sessions">
            <Session label="Last regular close" at={calendar.lastSessionClose} />
            <Session label="Next regular open" at={calendar.nextSessionOpen} />
          </dl>
          {nextHoliday ? (
            <p className={holidayToday ? 'market-holiday market-holiday--today' : 'market-holiday'} aria-label="Next market holiday">
              {holidayToday ? 'Holiday Today' : 'Upcoming Holiday'} -{' '}
              <time dateTime={nextHoliday.date}>{dateFormat.format(new Date(`${nextHoliday.date}T00:00:00+05:30`))}</time>,{' '}
              <span className="market-holiday-name">{nextHoliday.name}</span>
              {!holidayToday && <> <span className="market-holiday-countdown">in {nextHoliday.daysAway} {nextHoliday.daysAway === 1 ? 'day' : 'days'}</span></>}
            </p>
          ) : calendar.available && (
            <p className="market-calendar-note">No more weekday holidays in {calendar.year}.</p>
          )}
          {!calendar.available && <p className="market-calendar-note">{calendar.year} holiday calendar unavailable. Check NSE for dates.</p>}
        </div>
      </details>
    </section>
  )
}

function Session({ label, at }: { label: string; at: Date | null }) {
  return (
    <div className="market-session">
      <dt>{label}</dt>
      <dd>
        {at ? (
          <time dateTime={at.toISOString()}>
            {dateFormat.format(at)} <span className="market-session-time">{timeFormat.format(at)} IST</span>
          </time>
        ) : <span className="market-calendar-note">Check NSE calendar</span>}
      </dd>
    </div>
  )
}
