import { describe, expect, it } from 'vitest'
import { isSipDate, isWeekendSipDate, nextSipDate, normalizeSipAmountInput, parseSipAmount } from './sipTrackingRules'

describe('SIP amount bounds', () => {
  it('accepts eight whole-number digits and up to two decimals, including formatted pastes', () => {
    expect(parseSipAmount('9,99,99,999.99')).toBe(99_999_999.99)
    expect(parseSipAmount('1')).toBe(1)
    expect(normalizeSipAmountInput(' 5,000.50 ')).toBe('5000.50')
    expect(normalizeSipAmountInput('5000.')).toBe('5000.')
    expect(normalizeSipAmountInput('')).toBe('')
  })

  it.each(['100000000', '100000000.00', '123456789', '9,99,99,999.999', '1e7', '-5000', 'Infinity', 'NaN'])('rejects an invalid edit instead of truncating it: %s', (value) => {
    expect(normalizeSipAmountInput(value)).toBeNull()
    expect(parseSipAmount(value)).toBeNull()
  })

  it.each(['', '.', '0', '0.99', '5000.'])('rejects incomplete or below-minimum values on save: %s', (value) => {
    expect(parseSipAmount(value)).toBeNull()
  })
})

describe('SIP calendar dates', () => {
  it('clamps shorter months and handles leap years without changing the recurring day', () => {
    expect(nextSipDate({ start: '2027-01-31', day: 31, skipped: true })).toBe('2027-02-28')
    expect(nextSipDate({ start: '2028-01-31', day: 31, skipped: true })).toBe('2028-02-29')
    expect(nextSipDate({ start: '2027-02-28', day: 31, skipped: true })).toBe('2027-03-31')
  })

  it('keeps the scheduled date on a weekend rather than assigning a NAV date', () => {
    expect(nextSipDate({ start: '2026-12-05', day: 5, skipped: false })).toBe('2026-12-05')
    expect(isWeekendSipDate('2026-12-05')).toBe(true)
    expect(isWeekendSipDate('2026-12-06')).toBe(true)
    expect(isWeekendSipDate('2026-12-07')).toBe(false)
  })

  it('rejects impossible calendar dates before recurrence is evaluated', () => {
    expect(isSipDate('2027-02-29')).toBe(false)
    expect(isSipDate('2026-02-31')).toBe(false)
    expect(isSipDate('2028-02-29')).toBe(true)
    expect(isWeekendSipDate('invalid')).toBe(false)
  })
})
