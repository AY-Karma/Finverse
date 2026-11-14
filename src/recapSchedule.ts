import { holdingMovePeriod, holdingMoveToday } from './holdingMarketMoves'
import { getMarketCalendarInfo } from './marketCalendar'

export interface StoryEdition {
  id: 'portfolio' | 'weekly' | 'monthly'
  key: string
  label: string
  from: string
  through: string
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function storyEditions(today = holdingMoveToday(), now = Date.now()): StoryEdition[] {
  const month = holdingMovePeriod('month', '', today)
  if (!month) return []
  const clock = today === holdingMoveToday(now) ? new Date(now) : new Date(`${today}T23:59:59+05:30`)
  const lastClose = getMarketCalendarInfo(clock).lastSessionClose
  const portfolioThrough = lastClose ? holdingMoveToday(lastClose.getTime()) : today
  const editions: StoryEdition[] = [
    { id: 'portfolio', key: `portfolio:${today.slice(0, 7)}`, label: 'Portfolio', from: `${portfolioThrough.slice(0, 7)}-01`, through: portfolioThrough },
  ]
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  if (weekday === 6 || weekday === 0) {
    const friday = shiftDate(today, weekday === 6 ? -1 : -2)
    const monday = shiftDate(friday, -4)
    editions.push({ id: 'weekly', key: `weekly:${monday}`, label: 'Weekly', from: monday, through: friday })
  }
  if (today.endsWith('-01')) {
    const through = shiftDate(today, -1)
    editions.push({ id: 'monthly', key: `monthly:${through.slice(0, 7)}`, label: 'Monthly', from: `${through.slice(0, 7)}-01`, through })
  }
  return editions
}

export function historyPeriod(edition: Pick<StoryEdition, 'from' | 'through'>) {
  const period = holdingMovePeriod('custom', edition.from, edition.through)
  if (!period) throw new Error('Choose a valid recap period.')
  return period
}
