import { describe, expect, it } from 'vitest'
import { getMarketCalendarInfo, isRegularMarketOpen } from './marketCalendar'

describe('NSE regular-session calendar', () => {
  it('skips the Friday holiday and weekend when finding the last close and next open', () => {
    const calendar = getMarketCalendarInfo(new Date('2026-10-04T06:00:00Z'))
    expect(calendar.lastSessionClose?.toISOString()).toBe('2026-10-01T10:00:00.000Z')
    expect(calendar.nextSessionOpen?.toISOString()).toBe('2026-10-05T03:45:00.000Z')
    expect(calendar.holidays.slice(0, 2)).toEqual([
      { date: '2026-10-20', name: 'Dussehra', daysAway: 16 },
      { date: '2026-11-10', name: 'Diwali-Balipratipada', daysAway: 37 },
    ])
  })

  it.each([
    ['2026-09-23T03:44:59Z', false, '2026-09-22T10:00:00.000Z', '2026-09-23T03:45:00.000Z'],
    ['2026-09-23T03:45:00Z', true, '2026-09-22T10:00:00.000Z', '2026-09-24T03:45:00.000Z'],
    ['2026-09-23T09:59:59Z', true, '2026-09-22T10:00:00.000Z', '2026-09-24T03:45:00.000Z'],
    ['2026-09-23T10:00:00Z', false, '2026-09-23T10:00:00.000Z', '2026-09-24T03:45:00.000Z'],
  ])('uses the correct completed session at %s', (now, open, lastClose, nextOpen) => {
    const date = new Date(now)
    const calendar = getMarketCalendarInfo(date)
    expect(isRegularMarketOpen(date)).toBe(open)
    expect(calendar.lastSessionClose?.toISOString()).toBe(lastClose)
    expect(calendar.nextSessionOpen?.toISOString()).toBe(nextOpen)
  })

  it('keeps a holiday visible for the whole IST day and rolls it off at midnight', () => {
    const start = getMarketCalendarInfo(new Date('2026-10-19T18:30:00Z'))
    expect(start.holidays[0]).toEqual({ date: '2026-10-20', name: 'Dussehra', daysAway: 0 })
    expect(start.nextSessionOpen?.toISOString()).toBe('2026-10-21T03:45:00.000Z')
    expect(getMarketCalendarInfo(new Date('2026-10-20T18:29:59Z')).holidays[0].daysAway).toBe(0)
    expect(getMarketCalendarInfo(new Date('2026-10-20T18:30:00Z')).holidays[0].date).toBe('2026-11-10')
    expect(isRegularMarketOpen(new Date('2026-10-20T04:00:00Z'))).toBe(false)
  })

  it('uses the amended election closure for both sessions and polling', () => {
    const date = new Date('2026-01-15T04:00:00Z')
    const calendar = getMarketCalendarInfo(date)
    expect(isRegularMarketOpen(date)).toBe(false)
    expect(calendar.lastSessionClose?.toISOString()).toBe('2026-01-14T10:00:00.000Z')
    expect(calendar.nextSessionOpen?.toISOString()).toBe('2026-01-16T03:45:00.000Z')
  })

  it('does not invent sessions in unverified years, while preserving the polling fallback', () => {
    const future = new Date('2027-01-04T04:00:00Z')
    expect(getMarketCalendarInfo(future)).toMatchObject({
      year: 2027, available: false, lastSessionClose: null, nextSessionOpen: null, holidays: [],
    })
    expect(isRegularMarketOpen(future)).toBe(true)
    expect(getMarketCalendarInfo(new Date('2026-12-31T10:00:00Z')).nextSessionOpen).toBeNull()
    expect(getMarketCalendarInfo(new Date('2026-01-01T03:00:00Z')).lastSessionClose).toBeNull()
  })

  it('separates Muhurat trading from full-day weekday closures and regular sessions', () => {
    const calendar = getMarketCalendarInfo(new Date('2026-11-08T12:00:00Z'))
    expect(calendar.holidays[0].date).toBe('2026-11-10')
    expect(calendar.lastSessionClose?.toISOString()).toBe('2026-11-06T10:00:00.000Z')
    expect(calendar.nextSessionOpen?.toISOString()).toBe('2026-11-09T03:45:00.000Z')
  })
})
