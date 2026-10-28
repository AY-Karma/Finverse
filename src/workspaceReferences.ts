import { holdingIdentity, type MonitorState } from './monitor'
import type { Position } from './types'
import { combinedPositionMembers, combinePositions, quoteKey } from './valuation'

const IDENTITY_FIELDS = ['type', 'exchange', 'currency', 'providerSymbol', 'isin'] as const

function storedIdentity(position: Position): string {
  return [position.instrumentKey ?? quoteKey(position), ...IDENTITY_FIELDS.map((field) => position[field] ?? '')].join('|')
}

/** Keep references attached to their original raw rows when an instrument key changes. */
export function remapMonitorReferences(state: MonitorState, beforeRawPositions: Position[], afterRawPositions: Position[]): MonitorState {
  const beforeMembers = combinedPositionMembers(beforeRawPositions)
  const beforePositions = new Map(combinePositions(beforeRawPositions).map((position) => [position.id, position]))
  const afterMembers = combinedPositionMembers(afterRawPositions)
  const afterPositions = combinePositions(afterRawPositions)
  const priorGroups = [...beforeMembers].map(([id, rows]) => {
    const position = beforePositions.get(id)!
    return { id, rows, position: { ...position, instrumentKey: rows[0].instrumentKey ?? position.instrumentKey } }
  })
  const legacyGroupCounts = new Map<string, number>()
  for (const group of priorGroups) {
    const key = group.rows[0].instrumentKey ?? quoteKey(group.rows[0])
    legacyGroupCounts.set(key, (legacyGroupCounts.get(key) ?? 0) + 1)
  }

  function previousGroup(id: string) {
    const raw = beforeRawPositions.filter((position) => position.id === id)
    if (raw.length === 1) return { rows: raw, position: raw[0] }
    if (raw.length > 1) return null
    const candidates = priorGroups.filter((group) => {
      if (group.id === id) return true
      if (group.rows.length < 2) return false
      const key = group.rows[0].instrumentKey ?? quoteKey(group.rows[0])
      const suffix = (legacyGroupCounts.get(key) ?? 0) > 1
        ? ':' + IDENTITY_FIELDS.map((field) => group.rows.find((position) => position[field])?.[field] ?? '').join(':') : ''
      return id === `merged:${key}${suffix}`
    })
    return candidates.length > 1 ? null : candidates[0]
  }

  function resolve(id: string, identity?: string): Position | null {
    const previous = previousGroup(id)
    if (previous === null) return null
    if (previous && identity && identity !== holdingIdentity(previous.position) && identity !== storedIdentity(previous.position)) return null
    const previousIds = new Set(previous?.rows.map((position) => position.id))
    const linkedIds = new Set([...afterMembers].flatMap(([combinedId, rows]) => rows.some((row) => previousIds.has(row.id) || (!previous && row.id === id)) || (!previous && combinedId === id) ? [combinedId] : []))
    if (linkedIds.size > 1) return null
    const expectedIdentity = identity ?? (previous ? storedIdentity(previous.position) : undefined)
    const candidates = linkedIds.size === 1
      ? afterPositions.filter((position) => linkedIds.has(position.id))
      : afterPositions.filter((position) => holdingIdentity(position) === expectedIdentity)
    if (candidates.length !== 1) return null
    const candidate = candidates[0]
    if (!previous && identity && holdingIdentity(candidate) !== identity) return null
    const identities = new Set(afterPositions.filter((position) => quoteKey(position) === quoteKey(candidate)).map(holdingIdentity))
    return identities.size === 1 ? candidate : null
  }

  return {
    ...state,
    rules: state.rules.map((rule) => {
      const position = resolve(rule.holdingId, rule.instrumentIdentity)
      if (!position) return { ...rule, unresolved: true }
      const resolved = { ...rule, holdingId: position.id, holding: position.name || position.ticker, instrumentIdentity: holdingIdentity(position) }
      delete resolved.unresolved
      return resolved
    }),
    events: state.events.map((event) => {
      if (!event.holdingId) return event
      const position = resolve(event.holdingId)
      if (!position) return { ...event, unresolved: true }
      const resolved = { ...event, holdingId: position.id, holding: position.name || position.ticker }
      delete resolved.unresolved
      return resolved
    }),
    alerts: state.alerts.map((alert) => {
      const position = resolve(alert.holdingId)
      return position && position.id !== alert.holdingId ? { ...alert, holdingId: position.id } : alert
    }),
  }
}
