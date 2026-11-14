import { describe, expect, it } from 'vitest'
import { nextNavRefreshAt } from './navRefreshSchedule'

describe('MFAPI publication schedule', () => {
  it.each([
    ['2026-11-08T21:30:00Z', '2026-11-08T21:41:00Z'], // 03:00 -> 03:11 IST
    ['2026-11-08T21:41:00Z', '2026-11-08T23:37:00Z'], // 03:11 -> 05:07 IST
    ['2026-11-08T23:37:00Z', '2026-11-09T04:37:00Z'], // 05:07 -> 10:07 IST
    ['2026-11-09T04:37:00Z', '2026-11-09T08:37:00Z'], // 10:07 -> 14:07 IST
    ['2026-11-09T08:37:00Z', '2026-11-09T12:37:00Z'], // 14:07 -> 18:07 IST
    ['2026-11-09T12:37:00Z', '2026-11-09T15:37:00Z'], // 18:07 -> 21:07 IST
    ['2026-11-09T15:37:00Z', '2026-11-09T21:41:00Z'], // 21:07 -> next day's 03:11 IST
  ])('schedules the next provider run plus settling time after %s', (from, expected) => {
    expect(new Date(nextNavRefreshAt(Date.parse(from))).toISOString()).toBe(new Date(expected).toISOString())
  })

  it('waits for the settling window rather than checking at ingestion start', () => {
    const ingestedAt = Date.parse('2026-11-09T12:35:00Z')
    expect(nextNavRefreshAt(ingestedAt)).toBe(ingestedAt + 120_000)
    expect(nextNavRefreshAt(ingestedAt + 119_999)).toBe(ingestedAt + 120_000)
    expect(nextNavRefreshAt(ingestedAt + 120_000)).toBe(Date.parse('2026-11-09T15:37:00Z'))
  })

  it('keeps overnight weekend publication checks for delayed daily NAVs', () => {
    expect(nextNavRefreshAt(Date.parse('2026-11-07T18:00:00Z'))).toBe(Date.parse('2026-11-07T21:41:00Z'))
    expect(nextNavRefreshAt(Date.parse('2026-11-08T09:00:00Z'))).toBe(Date.parse('2026-11-08T12:37:00Z'))
  })

  it('handles IST day and year boundaries independently of the host timezone', () => {
    expect(nextNavRefreshAt(Date.parse('2026-12-31T18:29:59Z'))).toBe(Date.parse('2026-12-31T21:41:00Z'))
    expect(nextNavRefreshAt(Date.parse('2026-12-31T18:30:00Z'))).toBe(Date.parse('2026-12-31T21:41:00Z'))
  })

  it.each([NaN, Infinity, -Infinity])('rejects an invalid clock value %s', (now) => {
    expect(() => nextNavRefreshAt(now)).toThrow('NAV refresh time must be a finite timestamp.')
  })
})
