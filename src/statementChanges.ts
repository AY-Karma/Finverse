import type { Position } from './types'
import { listingIdentity } from './instruments'
import { effectivePrice } from './valuation'

export interface StatementHolding {
  key: string
  label: string
  quantity: number
  invested: number
  currency: string
  value: number | null
  weight: number | null
}

export interface StatementChange {
  key: string
  kind: 'added' | 'removed' | 'quantity' | 'valuation'
  before: StatementHolding | null
  after: StatementHolding | null
  weightChange: number | null
}

export interface StatementComparison {
  changes: StatementChange[]
  beforeComplete: boolean
  afterComplete: boolean
  beforeValue: number
  afterValue: number
}

function holdings(positions: Position[]) {
  const groups = new Map<string, StatementHolding>()
  for (const position of positions) {
    const key = JSON.stringify([listingIdentity(position), position.type === 'mutual-fund' ? position.folio?.trim() ?? '' : ''])
    const price = effectivePrice(position)
    const value = position.quantity === 0 ? 0 : price === null ? null : price * position.quantity
    const existing = groups.get(key)
    if (existing) {
      existing.quantity += position.quantity
      existing.invested += position.invested
      existing.value = existing.value === null || value === null ? null : existing.value + value
    } else groups.set(key, { key, label: position.ticker || position.name, quantity: position.quantity, invested: position.invested, currency: position.reportedCurrency || position.currency || 'INR', value, weight: null })
  }
  const complete = [...groups.values()].every((holding) => holding.value !== null)
  const total = [...groups.values()].reduce((sum, holding) => sum + (holding.value ?? 0), 0)
  if (complete && total > 0) for (const holding of groups.values()) holding.weight = holding.value! / total * 100
  return { groups, complete, total }
}

/** Compares statement balances, not inferred trades or investment returns. */
export function compareStatements(beforePositions: Position[], afterPositions: Position[]): StatementComparison {
  const before = holdings(beforePositions)
  const after = holdings(afterPositions)
  const changes: StatementChange[] = []
  for (const key of new Set([...before.groups.keys(), ...after.groups.keys()])) {
    const previous = before.groups.get(key) ?? null
    const next = after.groups.get(key) ?? null
    const weightChange = previous?.weight != null && next?.weight != null ? next.weight - previous.weight : null
    const kind = !previous ? 'added' : !next ? 'removed' : previous.quantity !== next.quantity ? 'quantity' : 'valuation'
    if (previous && next && previous.quantity === next.quantity && previous.invested === next.invested
      && previous.value === next.value && (weightChange === null || Math.abs(weightChange) < 0.005)) continue
    changes.push({ key, kind, before: previous, after: next, weightChange })
  }
  return { changes, beforeComplete: before.complete, afterComplete: after.complete, beforeValue: before.total, afterValue: after.total }
}
