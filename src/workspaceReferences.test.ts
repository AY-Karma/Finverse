import { describe, expect, it } from 'vitest'
import { emptyMonitorState, holdingIdentity, reconcileMonitorRules, type MonitorState } from './monitor'
import { remapMonitorReferences } from './workspaceReferences'
import { combinePositions } from './valuation'
import type { Position } from './types'

function position(id: string, instrumentKey = 'MF:example direct idcw'): Position {
  const code = /^MF:mfapi:(\d+)$/.exec(instrumentKey)?.[1]
  const name = code || instrumentKey === 'MF:example direct idcw' ? 'Example Direct IDCW' : instrumentKey.slice(3)
  return { id, instrumentKey, ticker: name, name, type: 'mutual-fund', quantity: 2, buyPrice: 100, invested: 200, lastPrice: 110, exchange: 'NSE', currency: 'INR', ...(code ? { mfScheme: { code: Number(code), name, source: 'confirmed' as const } } : {}) }
}

function references(positions: Position[]): MonitorState {
  const holding = combinePositions(positions)[0]
  return {
    ...emptyMonitorState(),
    rules: [{ id: 'rule', holdingId: holding.id, holding: holding.name, instrumentIdentity: holdingIdentity(holding), condition: 'price_above', threshold: 120, active: true }],
    events: [{ id: 'reminder', holdingId: holding.id, holding: holding.name, title: 'Review', date: '2030-01-01', kind: 'Reminder', reminder: true }],
  }
}

describe('workspace reference migration', () => {
  it('preserves combined references across two accounts when all members are rekeyed', () => {
    const before = [position('account-a-row'), position('account-b-row')]
    const after = before.map((row) => position(row.id, 'MF:mfapi:2'))
    const state = references(before)
    const result = remapMonitorReferences(state, before, after)
    const holding = combinePositions(after)[0]
    expect(result.rules[0]).toMatchObject({ holdingId: holding.id, instrumentIdentity: holdingIdentity(holding), active: true })
    expect(result.rules[0].unresolved).not.toBe(true)
    expect(result.events[0].holdingId).toBe(holding.id)
    expect(result.events[0].unresolved).not.toBe(true)
    expect(state.rules[0].holdingId).toBe(combinePositions(before)[0].id)
  })

  it('recognizes an old combined ID from stored keys when the current key function recomputes identity', () => {
    const before = [position('a'), position('b')].map((row) => ({ ...row, instrumentKey: 'MF:old stored key' }))
    const state = references(before)
    state.rules[0].holdingId = 'merged:MF:old stored key'
    state.rules[0].instrumentIdentity = 'MF:old stored key|mutual-fund|NSE|INR||'
    state.events[0].holdingId = state.rules[0].holdingId
    const after = before.map((row) => position(row.id, 'MF:mfapi:2'))
    const result = remapMonitorReferences(state, before, after)
    expect(result.rules[0].holdingId).toBe(combinePositions(after)[0].id)
    expect(result.rules[0].unresolved).not.toBe(true)
    expect(result.events[0].holdingId).toBe(combinePositions(after)[0].id)
  })

  it('does not let a legacy combined ID override conflicting rule identity metadata', () => {
    const before = [position('a'), position('b')].map((row) => ({ ...row, instrumentKey: 'MF:old stored key' }))
    const state = references(before)
    state.rules[0].holdingId = 'merged:MF:old stored key'
    state.rules[0].instrumentIdentity = 'MF:old stored key|mutual-fund|BSE|INR||'
    const after = before.map((row) => position(row.id, 'MF:mfapi:2'))
    const result = remapMonitorReferences(state, before, after)
    expect(result.rules[0]).toEqual({ ...state.rules[0], unresolved: true })
  })

  it('keeps removed rules and reminders explicitly unresolved and leaves portfolio reminders alone', () => {
    const before = [position('removed')]
    const state = references(before)
    state.events.push({ id: 'portfolio', holding: 'Portfolio', title: 'Review portfolio', date: '2030-01-01', kind: 'Reminder', reminder: true })
    const result = remapMonitorReferences(state, before, [])
    expect(result.rules).toEqual([{ ...state.rules[0], unresolved: true }])
    expect(result.events[0]).toEqual({ ...state.events[0], unresolved: true })
    expect(result.events[1]).toBe(state.events[1])
  })

  it('does not choose one holding when a previous combined position splits into different schemes', () => {
    const before = [position('first'), position('second')]
    const after = [position('first', 'MF:mfapi:1'), position('second', 'MF:mfapi:2')]
    const state = references(before)
    const result = remapMonitorReferences(state, before, after)
    expect(result.rules[0]).toEqual({ ...state.rules[0], unresolved: true })
    expect(result.events[0]).toEqual({ ...state.events[0], unresolved: true })
  })

  it('keeps a split unresolved even when one resulting holding still has the old identity', () => {
    const before = [position('first'), position('second')]
    const after = [position('first'), position('second', 'MF:mfapi:2')]
    const result = remapMonitorReferences(references(before), before, after)
    expect(result.rules[0].unresolved).toBe(true)
    expect(reconcileMonitorRules(result.rules, combinePositions(after))[0].unresolved).toBe(true)
  })

  it('can relink an equivalent import with new row IDs without substituting another identity', () => {
    const before = [position('old')]
    const state = references(before)
    const after = [position('new')]
    const result = remapMonitorReferences(state, before, after)
    expect(result.rules[0]).toMatchObject({ holdingId: 'new', instrumentIdentity: holdingIdentity(after[0]) })
    expect(result.rules[0].unresolved).not.toBe(true)
    expect(result.events[0].holdingId).toBe('new')
    const missing = remapMonitorReferences(state, before, [position('different', 'MF:another scheme')])
    expect(missing.rules[0].unresolved).toBe(true)
    expect(missing.events[0].unresolved).toBe(true)
  })

  it('clears an unavailable rule when an exact, unambiguous identity is imported again', () => {
    const state = references([position('removed')])
    state.rules[0].unresolved = true
    const after = [position('new')]
    const result = remapMonitorReferences(state, [], after)
    expect(result.rules[0]).toMatchObject({ holdingId: 'new', instrumentIdentity: holdingIdentity(after[0]) })
    expect(result.rules[0].unresolved).not.toBe(true)
  })

  it('does not use a stable row ID to substitute for a conflicting stored rule identity', () => {
    const before = [position('stable-row')]
    const state = references(before)
    state.rules[0].instrumentIdentity = holdingIdentity(position('other', 'MF:another scheme'))
    const result = remapMonitorReferences(state, before, [position('stable-row', 'MF:mfapi:2')])
    expect(result.rules[0]).toEqual({ ...state.rules[0], unresolved: true })
  })

  it('preserves historical alert evidence and observation identity after a mapping correction', () => {
    const before = [position('a'), position('b')]
    const after = before.map((row) => position(row.id, 'MF:mfapi:2'))
    const state = references(before)
    state.alerts = [{ id: 'alert', holdingId: combinePositions(before)[0].id, holding: before[0].name, kind: 'price', title: 'Recorded match', reason: 'At the old mapping', evidence: 'Historical price ₹125', observationKey: 'original|observation', time: '12:00', at: 1, metrics: [{ label: 'Price', value: '₹125' }], state: 'reviewed' }]
    const result = remapMonitorReferences(state, before, after)
    expect(result.alerts[0]).toEqual({ ...state.alerts[0], holdingId: combinePositions(after)[0].id })
  })
})
