import { describe, expect, it, vi } from 'vitest'
import { emptyMonitorState, evaluateMonitorRules, hasDuplicateMonitorRule, holdingIdentity, monitorRuleObservation, monitorRuleObservations, reconcileMonitorRules, sanitizeMonitorState, type MonitorAlert, type MonitorRule } from './monitor'
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

describe('watch observations', () => {
  const now = Date.now()
  const quotes = { [valuation.quoteKey(position)]: { price: 45, at: now, source: 'yahoo' as const } }

  it.each(['current', 'stale', 'missing'] as const)('indexes holdings once for %s rule references across batch operations', (reference) => {
    const positions = Array.from({ length: 200 }, (_, index) => ({ ...position, id: `holding-${index}`, ticker: `STOCK${index}`, providerSymbol: `STOCK${index}.NS` }))
    const rules = positions.slice(-20).map((holding, index) => ({
      ...rule, id: String(index), holdingId: reference === 'current' ? holding.id : `old-${index}`,
      instrumentIdentity: reference === 'missing' ? `missing-${index}` : holdingIdentity(holding),
    }))
    const state = { ...emptyMonitorState(), rules }
    const keys = vi.spyOn(valuation, 'quoteKey')
    try {
      const reconciled = reconcileMonitorRules(rules, positions)
      expect(reconciled.map((item) => item.unresolved ?? false)).toEqual(rules.map(() => reference === 'missing'))
      if (reference !== 'missing') expect(reconciled.map((item) => item.holdingId)).toEqual(positions.slice(-20).map((item) => item.id))
      const observations = monitorRuleObservations(rules, positions, {}, now, true)
      expect([...observations.values()]).toEqual(rules.map(() => ({ state: reference === 'missing' ? 'Unavailable' : 'Waiting' })))
      expect(evaluateMonitorRules(state, positions, {}, now, true)).toBe(state)
      expect(keys.mock.calls.length).toBeLessThanOrEqual(3 * (positions.length * 2 + rules.length * 4))
    } finally { keys.mockRestore() }
  })

  it('prefers the matching holding ID and otherwise the first matching identity', () => {
    const duplicate = { ...position, id: 'duplicate', name: 'Second account' }
    const rules = [{ ...rule, holdingId: duplicate.id }, { ...rule, id: 'stale', holdingId: 'old' }]
    expect(reconcileMonitorRules(rules, [position, duplicate]).map((item) => item.holdingId)).toEqual([duplicate.id, position.id])
    const conflictingId = { ...position, ticker: 'OTHER', providerSymbol: 'OTHER.NS' }
    expect(reconcileMonitorRules([rule], [conflictingId, duplicate])[0].holdingId).toBe(duplicate.id)
  })

  it('shares listing verification across a batch of rules without changing their states', () => {
    const positions = Array.from({ length: 200 }, (_, index) => ({ ...position, id: `holding-${index}`, ticker: `STOCK${index}`, providerSymbol: `STOCK${index}.NS` }))
    const rules = positions.slice(0, 20).map((holding, index) => ({ ...rule, id: String(index), holdingId: holding.id, instrumentIdentity: holdingIdentity(holding), active: index !== 0 }))
    const keys = vi.spyOn(valuation, 'quoteKey')
    try {
      const observations = monitorRuleObservations(rules, positions, {}, now, true)
      expect(observations.size).toBe(rules.length)
      expect(observations.get('0')).toEqual({ state: 'Paused' })
      expect(observations.get('1')).toEqual({ state: 'Waiting' })
      expect(keys.mock.calls.length).toBeLessThanOrEqual(positions.length * 2 + rules.length * 4)
    } finally { keys.mockRestore() }
  })

  it('keeps conflicting quote identities unavailable in batch observations', () => {
    const otherVenue = { ...position, id: 'other', exchange: 'BSE' as const, providerSymbol: 'FMCGIETF.BO' }
    const keys = vi.spyOn(valuation, 'quoteKey').mockReturnValue('legacy-shared-key')
    try {
      const watch = { ...rule, instrumentIdentity: holdingIdentity(position) }
      const observations = monitorRuleObservations([watch], [position, otherVenue], { 'legacy-shared-key': { price: 45, at: now, source: 'yahoo' } }, now, true)
      expect(observations.get(watch.id)).toEqual({ state: 'Unavailable' })
    } finally { keys.mockRestore() }
  })

  it('shows distance only for a recent, compatible observation', () => {
    expect(monitorRuleObservation(rule, [position], quotes, now, true)).toMatchObject({ state: 'Active', matched: false, distance: (47.05 - 45) / 45 * 100 })
    expect(monitorRuleObservation(rule, [position], quotes, now, false)).toEqual({ state: 'Waiting' })
    expect(monitorRuleObservation(rule, [position], quotes, now + 2 * 86_400_000, true)).toEqual({ state: 'Waiting' })
    expect(monitorRuleObservation(rule, [position], { [valuation.quoteKey(position)]: { ...quotes[valuation.quoteKey(position)], source: 'nav' } }, now, true)).toEqual({ state: 'Waiting' })
  })

  it('distinguishes paused rules, unavailable listings and missing daily changes', () => {
    expect(monitorRuleObservation({ ...rule, active: false }, [position], quotes, now, true)).toEqual({ state: 'Paused' })
    expect(monitorRuleObservation({ ...rule, unresolved: true }, [position], quotes, now, true)).toEqual({ state: 'Unavailable' })
    expect(monitorRuleObservation({ ...rule, condition: 'daily_move' }, [position], quotes, now, true)).toEqual({ state: 'Waiting' })
    const foreign = { ...position, exchange: 'NASDAQ' as const }
    expect(monitorRuleObservation({ ...rule, instrumentIdentity: holdingIdentity(foreign) }, [foreign], quotes, now, true)).toEqual({ state: 'Unavailable' })
  })

  it('expresses daily-move distance in percentage points and recognizes a negative match', () => {
    const daily = { ...rule, condition: 'daily_move' as const, threshold: 3 }
    const key = valuation.quoteKey(position)
    expect(monitorRuleObservation(daily, [position], { [key]: { ...quotes[key], changePct: -2 } }, now, true)).toMatchObject({ distance: 1, matched: false })
    expect(monitorRuleObservation(daily, [position], { [key]: { ...quotes[key], changePct: -4 } }, now, true)).toMatchObject({ matched: true })
  })
})

describe('snoozed alert persistence', () => {
  const now = Date.now()
  const alert: MonitorAlert = { id: 'alert', holdingId: position.id, holding: position.name, kind: 'price', state: 'snoozed', observationKey: 'observation', at: now, time: '', title: '', reason: '', evidence: '', metrics: [], snoozedUntil: now + 60_000 }

  it('reopens a due snooze with external data off and preserves reading preferences', () => {
    const state = { ...emptyMonitorState(), alerts: [alert], reading: { articles: [], follows: [{ id: 'banks', query: 'Banks', region: 'IN' as const }] } }
    expect(evaluateMonitorRules(state, [], {}, now, false)).toBe(state)
    const resumed = evaluateMonitorRules(state, [], {}, now + 60_000, false)
    expect(resumed.alerts[0].state).toBe('open')
    expect(resumed.alerts[0].snoozedUntil).toBeUndefined()
    expect(resumed.reading).toBe(state.reading)
  })

  it('preserves deadlines and reading in version-one storage while keeping legacy snoozes manual', () => {
    const reading = { articles: [], follows: [{ id: 'banks', query: 'Banks', region: 'IN' as const }] }
    const loaded = sanitizeMonitorState({ version: 1, alerts: [alert], rules: [], events: [], reading })
    expect(loaded.alerts[0].snoozedUntil).toBe(alert.snoozedUntil)
    expect(loaded.reading).toEqual(reading)
    const { snoozedUntil: _deadline, ...legacy } = alert
    const legacyState = { ...emptyMonitorState(), alerts: [legacy] }
    expect(evaluateMonitorRules(legacyState, [], {}, now + 86_400_000, false)).toBe(legacyState)
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
