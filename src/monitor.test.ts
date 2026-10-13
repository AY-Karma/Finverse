import { describe, expect, it, vi } from 'vitest'
import { emptyMonitorState, evaluateMonitorRules, hasDuplicateMonitorRule, holdingIdentity, reconcileMonitorRules, sanitizeMonitorState, type MonitorRule } from './monitor'
import type { Position } from './types'
import * as valuation from './valuation'

const position: Position = { id: 'holding', ticker: 'FMCGIETF', name: 'FMCGIETF', type: 'etf', quantity: 1, buyPrice: 40, invested: 40, lastPrice: 48, exchange: 'NSE', currency: 'INR', providerSymbol: 'FMCGIETF.NS' }

const rule: MonitorRule = {
  id: 'existing',
  holding: 'FMCGIETF',
  holdingId: 'holding',
  instrumentIdentity: holdingIdentity(position),
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

describe('unavailable watch references', () => {
  it('retains missing rules until an explicit reference resolution occurs', () => {
    const unavailable = reconcileMonitorRules([rule], [])
    expect(unavailable).toEqual([{ ...rule, unresolved: true }])
    const replacement = { ...position, id: 'replacement' }
    const resolved = reconcileMonitorRules(unavailable, [replacement])
    expect(resolved).toEqual(unavailable)
  })

  it('does not resolve or evaluate ambiguous listing identities sharing a quote key', () => {
    const otherVenue = { ...position, id: 'other', exchange: 'BSE' as const, providerSymbol: 'FMCGIETF.BO' }
    const key = vi.spyOn(valuation, 'quoteKey').mockReturnValue('legacy-shared-key')
    try {
      const unresolved = reconcileMonitorRules([{ ...rule, instrumentIdentity: holdingIdentity(position) }], [position, otherVenue])
      expect(unresolved[0].unresolved).toBe(true)
      const now = Date.now()
      const state = { ...emptyMonitorState(), rules: unresolved }
      expect(evaluateMonitorRules(state, [position, otherVenue], { [valuation.quoteKey(position)]: { price: 100, at: now, source: 'yahoo' } }, now, true)).toBe(state)
    } finally { key.mockRestore() }
  })

  it('never evaluates a rule still marked unresolved even when its holding ID exists', () => {
    const state = { ...emptyMonitorState(), rules: [{ ...rule, unresolved: true }] }
    const now = Date.now()
    expect(evaluateMonitorRules(state, [position], { [valuation.quoteKey(position)]: { price: 100, at: now, source: 'yahoo' } }, now, true)).toBe(state)
  })

  it('preserves explicit unresolved flags across monitor storage sanitation', () => {
    const state = sanitizeMonitorState({ version: 1, rules: [{ ...rule, unresolved: true }], events: [{ id: 'reminder', holdingId: 'missing', holding: 'Missing', title: 'Review', date: '2030-01-01', kind: 'Reminder', reminder: true, unresolved: true }], alerts: [] })
    expect(state.rules[0].unresolved).toBe(true)
    expect(state.events[0].unresolved).toBe(true)
  })
})
