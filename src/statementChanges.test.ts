import { describe, expect, it } from 'vitest'
import type { Position } from './types'
import { normalizePosition } from './instruments'
import { compareStatements } from './statementChanges'

const holding = (ticker: string, quantity = 10, lastPrice: number | null = 100): Position => normalizePosition({
  id: ticker, ticker, name: ticker, type: 'stock', quantity, lastPrice, invested: quantity * 80, buyPrice: 80,
  currency: 'INR', exchange: 'NSE',
})

describe('statement comparisons', () => {
  it('separates additions, removals and quantity changes without inferring trades', () => {
    const comparison = compareStatements([holding('ABC'), holding('OLD')], [holding('ABC', 8), holding('NEW')])
    expect(comparison.changes.map((row) => row.kind)).toEqual(['quantity', 'removed', 'added'])
    expect(comparison.changes[0].before?.quantity).toBe(10)
    expect(comparison.changes[0].after?.quantity).toBe(8)
  })

  it('compares weights using each statement price and includes price-only changes', () => {
    const comparison = compareStatements([holding('ABC'), holding('XYZ')], [holding('ABC', 10, 300), holding('XYZ')])
    expect(comparison.changes).toHaveLength(2)
    expect(comparison.changes[0]).toMatchObject({ kind: 'valuation', weightChange: 25 })
    expect(comparison.changes[1].weightChange).toBe(-25)
  })

  it('withholds weights on an incomplete statement instead of presenting partial exposure as complete', () => {
    const comparison = compareStatements([holding('ABC'), holding('XYZ', 10, null)], [holding('ABC', 8), holding('XYZ')])
    expect(comparison.beforeComplete).toBe(false)
    expect(comparison.changes[0].before?.weight).toBeNull()
    expect(comparison.changes[0].weightChange).toBeNull()
    expect(comparison.changes[0].after?.weight).toBeCloseTo(44.4444)
  })

  it('aggregates duplicate rows so row splits do not look like new positions', () => {
    const before = [holding('ABC')]
    const after = [holding('ABC', 4), { ...holding('ABC', 6), id: 'second' }]
    expect(compareStatements(before, after).changes).toEqual([])
  })

  it('keeps separate fund folios distinct', () => {
    const fund: Position = { ...holding('FUND'), type: 'mutual-fund', name: 'Example Fund Direct Growth', folio: 'one' }
    const comparison = compareStatements([fund], [{ ...fund, folio: 'two', id: 'new' }])
    expect(comparison.changes.map((row) => row.kind)).toEqual(['removed', 'added'])
  })

  it('does not use unsupported currency amounts in INR weights', () => {
    const foreign = { ...holding('FOREIGN'), reportedCurrency: 'USD' }
    const comparison = compareStatements([holding('ABC'), foreign], [holding('ABC', 9), foreign])
    expect(comparison.beforeValue).toBe(1000)
    expect(comparison.beforeComplete).toBe(false)
    expect(comparison.changes[0].weightChange).toBeNull()
  })
})
