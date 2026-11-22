import { describe, expect, it } from 'vitest'
import { sipUnits, usesEquityCalendar, dueSipDates, isSipDate, istToday, pendingSipDate, settleSipPlan, normalizeSipAmountInput, parseSipAmount, parseSipPlan, sipDateOnOrAfter, sipDueToday, sipSchedule, type SipPlan } from './sipPlans'

const plan: SipPlan = { id: 'p1', schemeCode: 122639, schemeName: 'Parag Parikh Flexi Cap Fund Direct Growth', amount: 5000, day: 5, start: '2026-12-05', provider: 'groww', method: 'Provider AutoPay', paused: false }

describe('SIP amount bounds', () => {
  it('accepts eight whole-number digits and up to two decimals, including formatted pastes', () => {
    expect(parseSipAmount('9,99,99,999.99')).toBe(99_999_999.99)
    expect(parseSipAmount('1')).toBe(1)
    expect(normalizeSipAmountInput(' 5,000.50 ')).toBe('5000.50')
    expect(normalizeSipAmountInput('5000.')).toBe('5000.')
  })

  it.each(['100000000', '9,99,99,999.999', '1e7', '-5000', 'Infinity', '', '.', '0', '0.99'])('rejects %s', (value) => {
    expect(parseSipAmount(value)).toBeNull()
  })
})

describe('SIP schedule', () => {
  it('starts at the first instalment and then follows today, clamping short months', () => {
    expect(sipDateOnOrAfter(plan, '2026-11-22')).toBe('2026-12-05')
    expect(sipDateOnOrAfter(plan, '2027-01-05')).toBe('2027-01-05')
    expect(sipDateOnOrAfter(plan, '2027-01-06')).toBe('2027-02-05')
    expect(sipDateOnOrAfter({ start: '2027-01-31', day: 31 }, '2027-02-01')).toBe('2027-02-28')
    expect(sipDateOnOrAfter({ start: '2028-01-31', day: 31 }, '2028-02-01')).toBe('2028-02-29')
    expect(sipDateOnOrAfter({ start: '2026-12-31', day: 31 }, '2026-12-31')).toBe('2026-12-31')
  })

  it('skips only the chosen instalment and forgets the skip once it passes', () => {
    const skipped = { ...plan, skipDate: '2026-12-05' }
    expect(sipSchedule(skipped, '2026-11-22')).toEqual({ next: '2027-01-05', skipped: '2026-12-05' })
    expect(sipSchedule(skipped, '2026-12-06')).toEqual({ next: '2027-01-05' })
    expect(sipSchedule(plan, '2026-11-22')).toEqual({ next: '2026-12-05' })
  })

  it('is due on its date in India unless paused or skipped', () => {
    expect(istToday(Date.parse('2026-12-04T18:30:00Z'))).toBe('2026-12-05')
    expect(sipDueToday(plan, '2026-12-05')).toBe(true)
    expect(sipDueToday({ ...plan, paused: true }, '2026-12-05')).toBe(false)
    expect(sipDueToday({ ...plan, skipDate: '2026-12-05' }, '2026-12-05')).toBe(false)
    expect(sipDueToday(plan, '2026-12-04')).toBe(false)
  })

  it('rejects impossible calendar dates', () => {
    expect(isSipDate('2027-02-29')).toBe(false)
    expect(isSipDate('2028-02-29')).toBe(true)
  })
})

describe('saved SIP plans', () => {
  it('keeps valid plans and rejects tampered fields', () => {
    expect(parseSipPlan(plan)).toEqual(plan)
    expect(parseSipPlan({ ...plan, skipDate: '2026-12-05' })?.skipDate).toBe('2026-12-05')
    for (const value of [null, { ...plan, amount: 0 }, { ...plan, amount: 1.234 }, { ...plan, day: 32 }, { ...plan, start: '2026-02-31' }, { ...plan, provider: 'bank' },
      { ...plan, method: 'Cash' }, { ...plan, schemeCode: -1 }, { ...plan, schemeName: '' }, { ...plan, paused: 'no' }, { ...plan, skipDate: 'soon' }]) expect(parseSipPlan(value)).toBeNull()
  })
})

describe('SIP instalment registration', () => {
  const live = { ...plan, start: '2026-10-05' }
  const navs = [{ date: '2026-10-05', close: 80 }, { date: '2026-11-06', close: 100 }, { date: '2026-12-07', close: 125 }]

  it('records each due instalment against the first NAV published on or after its date', () => {
    expect(dueSipDates(live, '2026-11-22')).toEqual(['2026-10-05', '2026-11-05'])
    const settled = settleSipPlan(live, '2026-11-22', navs)
    expect(settled.instalments).toEqual([
      { date: '2026-10-05', status: 'recorded', amount: 5000, navDate: '2026-10-05', nav: 80, units: 62.497 },
      { date: '2026-11-05', status: 'recorded', amount: 5000, navDate: '2026-11-06', nav: 100, units: 49.998 },
    ])
    expect(settled.start).toBe('2026-12-05')
    expect(settleSipPlan(settled, '2026-11-22', navs)).toBe(settled)
  })

  it('waits for an unpublished NAV, never uses a NAV dated after today, and keeps the order', () => {
    const due = { ...plan, start: '2026-12-05' }
    expect(settleSipPlan(due, '2026-12-05', navs)).toBe(due)
    expect(pendingSipDate(due, '2026-12-05')).toBe('2026-12-05')
    expect(settleSipPlan(due, '2026-12-07', navs).instalments).toEqual([{ date: '2026-12-05', status: 'recorded', amount: 5000, navDate: '2026-12-07', nav: 125, units: 39.998 }])
    expect(settleSipPlan(live, '2026-11-22', [{ date: '2026-11-06', close: 100 }]).instalments![0]).toMatchObject({ date: '2026-10-05', navDate: '2026-11-06' })
  })

  it('settles a skipped instalment without units and leaves paused plans alone', () => {
    const skipped = settleSipPlan({ ...live, skipDate: '2026-11-05' }, '2026-11-22', navs)
    expect(skipped.instalments!.map((item) => item.status)).toEqual(['recorded', 'skipped'])
    expect(skipped.skipDate).toBeUndefined()
    const paused = { ...live, paused: true }
    expect(settleSipPlan(paused, '2026-11-22', navs)).toBe(paused)
    expect(pendingSipDate(paused, '2026-11-22')).toBeUndefined()
  })

  it('keeps recorded history through storage and rejects altered entries', () => {
    const settled = settleSipPlan(live, '2026-11-22', navs)
    expect(parseSipPlan(JSON.parse(JSON.stringify(settled)))).toEqual(settled)
    expect(parseSipPlan({ ...settled, instalments: [{ date: '2026-10-05', status: 'recorded', amount: 5000, navDate: '2026-10-04', nav: 80, units: 62.5 }] })).toBeNull()
    expect(parseSipPlan({ ...settled, instalments: [{ date: '2026-10-05', status: 'recorded', amount: 5000, navDate: '2026-10-05', nav: -1, units: 62.5 }] })).toBeNull()
  })
})

describe('SIP allotment precision', () => {
  it('deducts 0.005% stamp duty and rounds units to three decimals', () => {
    expect(sipUnits(5000, 88.762)).toBe(56.328)
    expect(sipUnits(1_00_000, 100)).toBe(999.95)
  })

  it('uses the expected business-day NAV for equity schemes, skipping weekends and listed holidays', () => {
    const holiday = { ...plan, start: '2026-11-24', day: 24 }
    const navs = [{ date: '2026-11-24', close: 90 }, { date: '2026-11-25', close: 91 }]
    // 24 Nov 2026 is a listed holiday, so the 25 Nov NAV applies even if a provider publishes a 24 Nov figure.
    expect(settleSipPlan(holiday, '2026-11-25', navs).instalments![0]).toMatchObject({ navDate: '2026-11-25', nav: 91 })
    expect(settleSipPlan(holiday, '2026-11-24', navs)).toBe(holiday)
    expect(settleSipPlan(holiday, '2026-11-25', navs, false).instalments![0]).toMatchObject({ navDate: '2026-11-24', nav: 90 })
    expect(usesEquityCalendar('ICICI Prudential Liquid Fund Direct Growth')).toBe(false)
    expect(usesEquityCalendar('Example Fund', 'Overnight')).toBe(false)
    expect(usesEquityCalendar('Parag Parikh Flexi Cap Fund')).toBe(true)
  })
})
