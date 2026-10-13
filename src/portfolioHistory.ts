import type { PortfolioSnapshot } from './types'
import { workspaceWritesBlocked } from './workspaceStorage'

const KEY = 'finverse:portfolio-snapshots'
const MAX_SNAPSHOTS = 730
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function validSnapshot(value: unknown): value is PortfolioSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PortfolioSnapshot>
  return [item.at, item.value, item.invested, item.pnl, item.holdingCount].every((n) => typeof n === 'number' && Number.isFinite(n))
}

export function loadPortfolioSnapshots(): PortfolioSnapshot[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? compactDailySnapshots(parsed.filter(validSnapshot)) : []
  } catch {
    return []
  }
}

function tradingDay(at: number): string {
  return new Date(at + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** Keep the latest valued snapshot per Indian market day. */
function compactDailySnapshots(snapshots: PortfolioSnapshot[]): PortfolioSnapshot[] {
  const byDay = new Map<string, PortfolioSnapshot>()
  for (const snapshot of [...snapshots].sort((a, b) => a.at - b.at)) {
    const day = tradingDay(snapshot.at)
    const previous = byDay.get(day)
    byDay.set(day, { ...snapshot, ...(snapshot.dataQuality || previous?.dataQuality ? { dataQuality: snapshot.dataQuality ?? previous?.dataQuality } : {}), ...(snapshot.event || previous?.event ? { event: snapshot.event ?? previous?.event } : {}) })
  }
  return Array.from(byDay.values()).slice(-MAX_SNAPSHOTS)
}

export function updatePortfolioSnapshots(snapshot: PortfolioSnapshot, existing: PortfolioSnapshot[]): PortfolioSnapshot[] {
  const current = compactDailySnapshots(existing)
  const next = compactDailySnapshots([...current, snapshot])
  const last = current[current.length - 1]
  const replacement = next[next.length - 1]
  if (last && replacement && tradingDay(last.at) === tradingDay(replacement.at) && last.value === replacement.value && last.invested === replacement.invested && last.pnl === replacement.pnl && last.holdingCount === replacement.holdingCount && last.dataQuality === replacement.dataQuality && JSON.stringify(last.event) === JSON.stringify(replacement.event)) return current
  return next
}

export function appendPortfolioSnapshot(snapshot: PortfolioSnapshot, existing?: PortfolioSnapshot[]): PortfolioSnapshot[] {
  const current = existing ?? loadPortfolioSnapshots()
  const next = updatePortfolioSnapshots(snapshot, current)
  if (JSON.stringify(next) === JSON.stringify(current)) return current
  if (workspaceWritesBlocked()) return current
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* Browser storage may be unavailable or full. */
  }
  return next
}
