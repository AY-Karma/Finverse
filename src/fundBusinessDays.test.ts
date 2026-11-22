import { describe, expect, it } from 'vitest'
import { EQUITY_MF_MARKET_CALENDAR_2026, nextFundBusinessDate, type FundBusinessCalendar } from './fundBusinessDays'

const calendar: FundBusinessCalendar = {
  from: '2026-01-01', through: '2026-12-31',
  holidays: ['2026-01-26', '2026-11-24', '2026-12-25'],
  source: { label: 'Test calendar', url: 'https://example.com/calendar' },
}

describe('mutual-fund next-business-day projection', () => {
  it('keeps an open business day unchanged', () => {
    expect(nextFundBusinessDate('2026-12-10', calendar)).toEqual({ status: 'available', date: '2026-12-10', rolledForward: false })
  })
  it.each(['2026-12-05', '2026-12-06'])('rolls weekend %s to Monday', (date) => {
    expect(nextFundBusinessDate(date, calendar)).toEqual({ status: 'available', date: '2026-12-07', rolledForward: true })
  })
  it('skips a holiday followed by the weekend', () => {
    expect(nextFundBusinessDate('2026-12-25', calendar)).toEqual({ status: 'available', date: '2026-12-28', rolledForward: true })
  })
  it('skips a Monday holiday after the weekend', () => {
    expect(nextFundBusinessDate('2026-01-24', calendar)).toEqual({ status: 'available', date: '2026-01-27', rolledForward: true })
  })
  it('continues past consecutive weekday holidays', () => {
    expect(nextFundBusinessDate('2026-11-21', { ...calendar, holidays: ['2026-11-23', '2026-11-24'] })).toEqual({ status: 'available', date: '2026-11-25', rolledForward: true })
  })
  it('does not infer a calendar for an unsupported year or scheme', () => {
    expect(nextFundBusinessDate('2027-01-04', calendar)).toEqual({ status: 'calendar-unavailable' })
    expect(nextFundBusinessDate('2026-12-05')).toEqual({ status: 'calendar-unavailable' })
    expect(nextFundBusinessDate('2026-12-31', { ...calendar, holidays: ['2026-12-31'] })).toEqual({ status: 'calendar-unavailable' })
  })
  it('crosses month and year boundaries only within supplied coverage', () => {
    expect(nextFundBusinessDate('2026-01-31', calendar)).toEqual({ status: 'available', date: '2026-02-02', rolledForward: true })
    expect(nextFundBusinessDate('2026-12-31', { ...calendar, through: '2027-12-31', holidays: ['2026-12-31', '2027-01-01'] })).toEqual({ status: 'available', date: '2027-01-04', rolledForward: true })
  })
  it.each(['', '2026-02-30', '2026-13-01', '2026-2-03'])('rejects invalid date %s', (date) => {
    expect(nextFundBusinessDate(date, calendar)).toEqual({ status: 'invalid-date' })
  })
})

it('includes the official January amendment without treating settlement-only bank holidays as equity closures', () => {
  expect(nextFundBusinessDate('2026-01-15', EQUITY_MF_MARKET_CALENDAR_2026)).toEqual({ status: 'available', date: '2026-01-16', rolledForward: true })
  expect(nextFundBusinessDate('2026-02-19', EQUITY_MF_MARKET_CALENDAR_2026)).toEqual({ status: 'available', date: '2026-02-19', rolledForward: false })
  expect(nextFundBusinessDate('2026-04-01', EQUITY_MF_MARKET_CALENDAR_2026)).toEqual({ status: 'available', date: '2026-04-01', rolledForward: false })
  expect(nextFundBusinessDate('2026-11-08', EQUITY_MF_MARKET_CALENDAR_2026)).toEqual({ status: 'available', date: '2026-11-09', rolledForward: true })
})
