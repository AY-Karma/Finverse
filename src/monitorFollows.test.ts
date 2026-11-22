import { describe, expect, it } from 'vitest'
import { dismissFollowNotice, EMPTY_FOLLOWS, parseMonitorFollows, toggleCompanyFollow, toggleFollowedDay } from './monitorFollows'
import { sanitizeMonitorState } from './monitor'

describe('notification follows', () => {
  it('follows a company from now and unfollows it again', () => {
    const followed = toggleCompanyFollow(EMPTY_FOLLOWS, { identity: 'NSE:KRN', name: 'KRN' }, 1000)
    expect(followed.companies).toEqual([{ identity: 'NSE:KRN', name: 'KRN', since: 1000 }])
    expect(toggleCompanyFollow(followed, { identity: 'NSE:KRN', name: 'KRN' }, 2000).companies).toEqual([])
  })

  it('toggles calendar days and drops days that have passed', () => {
    const days = toggleFollowedDay({ ...EMPTY_FOLLOWS, days: ['2026-11-01'] }, '2026-11-25', '2026-11-22')
    expect(days.days).toEqual(['2026-11-25'])
    expect(toggleFollowedDay(days, '2026-11-25', '2026-11-22').days).toEqual([])
  })

  it('remembers dismissed notifications once', () => {
    const dismissed = dismissFollowNotice(dismissFollowNotice(EMPTY_FOLLOWS, 'filing:1'), 'filing:1')
    expect(dismissed.dismissed).toEqual(['filing:1'])
  })

  it('keeps valid saved follows and rejects malformed ones', () => {
    const follows = { companies: [{ identity: 'NSE:KRN', name: 'KRN', since: 1000 }], days: ['2026-11-25'], dismissed: ['filing:1'] }
    expect(parseMonitorFollows(follows)).toEqual(follows)
    for (const value of [null, [], { ...follows, days: ['2026-02-31'] }, { ...follows, companies: [{ identity: '', name: 'KRN', since: 1 }] }, { ...follows, dismissed: [5] }]) expect(parseMonitorFollows(value)).toBeNull()
    expect(sanitizeMonitorState({ version: 1, rules: [], events: [], alerts: [], follows }).follows).toEqual(follows)
    expect(sanitizeMonitorState({ version: 1, rules: [], events: [], alerts: [], follows: { bad: true } }).follows).toBeUndefined()
  })
})
