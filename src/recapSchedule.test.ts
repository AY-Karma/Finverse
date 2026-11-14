import { afterEach, describe, expect, it, vi } from 'vitest'
import { historyPeriod, storyEditions } from './recapSchedule'

afterEach(() => vi.useRealTimers())

describe('story edition schedule', () => {
  it('always has the current portfolio month without a separate news edition', () => {
    expect(storyEditions('2026-11-06', Date.parse('2026-11-06T12:00:00Z'))).toEqual([
      { id: 'portfolio', key: 'portfolio:2026-11', label: 'Portfolio', from: '2026-11-01', through: '2026-11-06' },
    ])
  })

  it('uses the last completed market month when the new month has no completed session', () => {
    expect(storyEditions('2026-11-01')[0]).toMatchObject({ key: 'portfolio:2026-11', from: '2026-10-01', through: '2026-10-30' })
    expect(storyEditions('2026-11-02', Date.parse('2026-11-02T04:00:00Z'))[0]).toMatchObject({ from: '2026-10-01', through: '2026-10-30' })
    expect(storyEditions('2026-11-02', Date.parse('2026-11-02T12:00:00Z'))[0]).toMatchObject({ from: '2026-11-01', through: '2026-11-02' })
  })

  it('offers the completed Monday-to-Friday week on both weekend days, then removes it Monday', () => {
    const expected = { id: 'weekly', key: 'weekly:2026-11-02', label: 'Weekly', from: '2026-11-02', through: '2026-11-06' }
    expect(storyEditions('2026-11-07').find((edition) => edition.id === 'weekly')).toEqual(expected)
    expect(storyEditions('2026-11-08').find((edition) => edition.id === 'weekly')).toEqual(expected)
    expect(storyEditions('2026-11-09').some((edition) => edition.id === 'weekly')).toBe(false)
  })

  it('keeps monthly and weekly recaps separate when the first falls on a weekend', () => {
    const editions = storyEditions('2026-11-01')
    expect(editions.map((edition) => edition.id)).toEqual(['portfolio', 'weekly', 'monthly'])
    expect(editions.find((edition) => edition.id === 'monthly')).toEqual({ id: 'monthly', key: 'monthly:2026-10', label: 'Monthly', from: '2026-10-01', through: '2026-10-31' })
    expect(editions.find((edition) => edition.id === 'weekly')).toMatchObject({ from: '2026-10-26', through: '2026-10-30' })
    expect(storyEditions('2026-11-02').some((edition) => edition.id === 'monthly')).toBe(false)
  })

  it('handles leap February and the year boundary without local timezone arithmetic', () => {
    expect(storyEditions('2028-03-01').find((edition) => edition.id === 'monthly')).toMatchObject({ from: '2028-02-01', through: '2028-02-29' })
    expect(storyEditions('2027-01-01').find((edition) => edition.id === 'monthly')).toMatchObject({ key: 'monthly:2026-12', from: '2026-12-01', through: '2026-12-31' })
    expect(storyEditions('2027-01-02').find((edition) => edition.id === 'weekly')).toMatchObject({ from: '2026-12-28', through: '2027-01-01' })
  })

  it('uses the full first day in India and switches editions at midnight IST', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T18:29:59Z'))
    expect(storyEditions().some((edition) => edition.id === 'monthly')).toBe(false)
    vi.setSystemTime(new Date('2026-10-31T18:30:00Z'))
    expect(storyEditions().some((edition) => edition.id === 'monthly')).toBe(true)
    vi.setSystemTime(new Date('2026-11-01T18:29:59Z'))
    expect(storyEditions().some((edition) => edition.id === 'monthly')).toBe(true)
    vi.setSystemTime(new Date('2026-11-01T18:30:00Z'))
    expect(storyEditions().some((edition) => edition.id === 'monthly')).toBe(false)
  })

  it('requests opening observations before the exact selected period and rejects invalid dates', () => {
    expect(historyPeriod({ from: '2026-11-02', through: '2026-11-06' })).toEqual({ from: '2026-11-02', to: '2026-11-06', historyFrom: '2026-10-25' })
    expect(storyEditions('2026-02-30')).toEqual([])
    expect(() => historyPeriod({ from: '2026-11-07', through: '2026-11-06' })).toThrow('Choose a valid recap period.')
  })
})
