import { describe, expect, it } from 'vitest'
import { hasDuplicateMonitorRule, type MonitorRule } from './monitor'

const rule: MonitorRule = {
  id: 'existing',
  holding: 'FMCGIETF',
  holdingId: 'holding',
  instrumentIdentity: 'EQ:FMCGIETF|etf|NSE|INR|FMCGIETF.NS|',
  condition: 'price_above',
  threshold: 47.05,
  active: true,
}

describe('watch rule uniqueness', () => {
  it('rejects the same instrument, condition, and numeric level, including paused rules', () => {
    const candidate = { ...rule, holdingId: 'merged-holding', threshold: Number('47.050') }
    expect(hasDuplicateMonitorRule([rule], candidate)).toBe(true)
    expect(hasDuplicateMonitorRule([{ ...rule, active: false }], candidate)).toBe(true)
  })

  it('allows a different instrument, condition, or level', () => {
    expect(hasDuplicateMonitorRule([rule], { ...rule, instrumentIdentity: 'another-instrument' })).toBe(false)
    expect(hasDuplicateMonitorRule([rule], { ...rule, condition: 'price_below' })).toBe(false)
    expect(hasDuplicateMonitorRule([rule], { ...rule, threshold: 47.06 })).toBe(false)
  })

  it('allows saving an unchanged rule but prevents editing it into another existing rule', () => {
    expect(hasDuplicateMonitorRule([rule], rule, rule.id)).toBe(false)
    expect(hasDuplicateMonitorRule([rule, { ...rule, id: 'other', threshold: 50 }], { ...rule, threshold: 50 }, rule.id)).toBe(true)
  })
})
