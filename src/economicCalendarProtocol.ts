/** Market-moving macro events: central-bank decisions and major data releases. */
export type EconomicRegion = 'IN' | 'US' | 'EU' | 'GB' | 'JP' | 'CN'

export interface EconomicEvent {
  id: string
  title: string
  region: EconomicRegion
  /** ISO instant; for an all-day event, midday IST on that date. */
  at: string
  allDay: boolean
  forecast?: string
  previous?: string
  source: string
  sourceUrl: string
}

export const FOREX_FACTORY_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
const FOREX_FACTORY_PAGE = 'https://www.forexfactory.com/calendar'
const REGIONS: Record<string, EconomicRegion> = { USD: 'US', EUR: 'EU', GBP: 'GB', JPY: 'JP', CNY: 'CN' }
const MAX_EVENTS = 80

const text = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : ''

/** High-impact releases for the major economies that move Indian markets, from Forex Factory's weekly feed. */
export function parseForexFactory(payload: unknown): EconomicEvent[] {
  if (!Array.isArray(payload)) throw new Error('Invalid economic calendar feed.')
  return payload.slice(0, 500).flatMap((row: Record<string, unknown>) => {
    const region = REGIONS[text(row?.country, 8)]
    const title = text(row?.title, 160)
    const at = Date.parse(text(row?.date, 40))
    if (!region || !title || row?.impact !== 'High' || !Number.isFinite(at)) return []
    const forecast = text(row.forecast, 24)
    const previous = text(row.previous, 24)
    return [{
      id: `ff:${region}:${new Date(at).toISOString()}:${title}`, title, region, at: new Date(at).toISOString(), allDay: false,
      ...(forecast ? { forecast } : {}), ...(previous ? { previous } : {}), source: 'Forex Factory', sourceUrl: FOREX_FACTORY_PAGE,
    }]
  }).slice(0, MAX_EVENTS)
}

export function isEconomicEvent(value: unknown): value is EconomicEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return typeof event.id === 'string' && typeof event.title === 'string' && event.title.length > 0 && event.title.length <= 160
    && typeof event.region === 'string' && ['IN', 'US', 'EU', 'GB', 'JP', 'CN'].includes(event.region)
    && typeof event.at === 'string' && Number.isFinite(Date.parse(event.at)) && typeof event.allDay === 'boolean'
    && (event.forecast === undefined || typeof event.forecast === 'string') && (event.previous === undefined || typeof event.previous === 'string')
    && typeof event.source === 'string' && typeof event.sourceUrl === 'string' && /^https:\/\//.test(event.sourceUrl)
}

const RBI_SCHEDULE = 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=62422'
const MOSPI_CALENDAR = 'https://www.mospi.gov.in/uploads/documents/releaseCalender/1793948871564-ARC%202026-27%20updated%20till%20October%202026.pdf'
const FOMC_CALENDAR = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
const FOMC_2027 = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261112a.htm'

const day = (date: string, title: string, source: string, sourceUrl: string): EconomicEvent =>
  ({ id: `in:${date}:${title}`, title, region: 'IN', at: `${date}T06:30:00.000Z`, allDay: true, source, sourceUrl })
// FOMC statements are released at 2:00 p.m. US Eastern time on the meeting's last day.
const fomc = (instant: string, sourceUrl: string): EconomicEvent =>
  ({ id: `fomc:${instant}`, title: 'Fed interest rate decision (FOMC)', region: 'US', at: new Date(instant).toISOString(), allDay: false, source: 'Federal Reserve', sourceUrl })

/**
 * Officially scheduled events beyond the weekly feed: RBI MPC decisions (RBI, 23 Mar 2026), MoSPI's CPI, IIP and GDP
 * releases (Advance Release Calendar 2026-27, updated October 2026) and FOMC decisions (Federal Reserve, incl. the
 * revised 2027 schedule of 12 Nov 2026). Dates are as published; agencies may revise them.
 */
export const SCHEDULED_EVENTS: readonly EconomicEvent[] = [
  day('2026-11-28', 'India IIP (industrial production)', 'MoSPI', MOSPI_CALENDAR),
  day('2026-11-30', 'India GDP, Q2 FY 2026-27', 'MoSPI', MOSPI_CALENDAR),
  day('2026-12-04', 'RBI monetary policy decision', 'RBI', RBI_SCHEDULE),
  fomc('2026-12-09T14:00:00-05:00', FOMC_CALENDAR),
  day('2026-12-12', 'India CPI inflation', 'MoSPI', MOSPI_CALENDAR),
  day('2026-12-28', 'India IIP (industrial production)', 'MoSPI', MOSPI_CALENDAR),
  day('2027-01-07', 'India GDP, first advance estimates FY 2026-27', 'MoSPI', MOSPI_CALENDAR),
  day('2027-01-12', 'India CPI inflation', 'MoSPI', MOSPI_CALENDAR),
  fomc('2027-01-27T14:00:00-05:00', FOMC_2027),
  day('2027-01-28', 'India IIP (industrial production)', 'MoSPI', MOSPI_CALENDAR),
  day('2027-02-05', 'RBI monetary policy decision', 'RBI', RBI_SCHEDULE),
  day('2027-02-12', 'India CPI inflation', 'MoSPI', MOSPI_CALENDAR),
  day('2027-02-26', 'India GDP, Q3 FY 2026-27 and second advance estimates', 'MoSPI', MOSPI_CALENDAR),
  day('2027-02-28', 'India IIP (industrial production)', 'MoSPI', MOSPI_CALENDAR),
  day('2027-03-12', 'India CPI inflation', 'MoSPI', MOSPI_CALENDAR),
  fomc('2027-03-17T14:00:00-04:00', FOMC_2027),
]

const DAY = 86_400_000
const istDate = (instant: number) => new Date(instant + 19_800_000).toISOString().slice(0, 10)

/**
 * Upcoming events from the start of today (IST) through the window, earliest first. Scheduled events win over a
 * feed duplicate on the same IST day (the feed lists Fed decisions too).
 */
export function upcomingEconomicEvents(feed: readonly EconomicEvent[], now: number, windowDays = 45): EconomicEvent[] {
  const from = istDate(now)
  const through = istDate(now + windowDays * DAY)
  const inWindow = (event: EconomicEvent) => {
    const date = istDate(Date.parse(event.at))
    return date >= from && date <= through
  }
  const scheduled = SCHEDULED_EVENTS.filter(inWindow)
  const fedDays = new Set(scheduled.filter((event) => event.id.startsWith('fomc:')).map((event) => istDate(Date.parse(event.at))))
  const global = feed.filter((event) => inWindow(event) && !(event.region === 'US' && /\b(FOMC|Federal Funds Rate)\b/i.test(event.title) && fedDays.has(istDate(Date.parse(event.at)))))
  return [...global, ...scheduled].sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.title.localeCompare(right.title))
}
