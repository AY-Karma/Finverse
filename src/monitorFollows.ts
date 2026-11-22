import { isCalendarDate } from './fundBusinessDays'

/** Things the user asked to be notified about: new filings from a company, and economic-calendar days. */
export interface MonitorFollows {
  /** Companies by holding identity; filings published after `since` become notifications. */
  companies: { identity: string; name: string; since: number }[]
  /** IST dates whose economic-calendar events become notifications on that day. */
  days: string[]
  /** Notifications marked done. */
  dismissed: string[]
}

export const EMPTY_FOLLOWS: MonitorFollows = { companies: [], days: [], dismissed: [] }
const MAX_FOLLOWS = 200
const MAX_DISMISSED = 500

const text = (value: unknown, limit: number) => typeof value === 'string' && value.trim() && value.length <= limit ? value.trim() : null

/** Returns null when the saved value is malformed, so storage and backups can reject it. */
export function parseMonitorFollows(value: unknown): MonitorFollows | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.companies) || !Array.isArray(row.days) || !Array.isArray(row.dismissed)
    || row.companies.length > MAX_FOLLOWS || row.days.length > MAX_FOLLOWS || row.dismissed.length > MAX_DISMISSED) return null
  const companies = row.companies.map((item) => {
    const company = item as Record<string, unknown> | null
    const identity = text(company?.identity, 2000)
    const name = text(company?.name, 200)
    const since = company?.since
    return identity && name && typeof since === 'number' && Number.isFinite(since) && since > 0 ? { identity, name, since } : null
  })
  const days = row.days.filter((day): day is string => typeof day === 'string' && isCalendarDate(day))
  const dismissed = row.dismissed.map((id) => text(id, 300))
  if (companies.some((item) => !item) || days.length !== row.days.length || dismissed.some((id) => !id)) return null
  return { companies: companies as MonitorFollows['companies'], days: [...new Set(days)], dismissed: [...new Set(dismissed as string[])] }
}

export function toggleCompanyFollow(follows: MonitorFollows, company: { identity: string; name: string }, now: number): MonitorFollows {
  const following = follows.companies.some((item) => item.identity === company.identity)
  return { ...follows, companies: following ? follows.companies.filter((item) => item.identity !== company.identity)
    : [...follows.companies, { ...company, since: now }].slice(-MAX_FOLLOWS) }
}

export function toggleFollowedDay(follows: MonitorFollows, day: string, today: string): MonitorFollows {
  const days = follows.days.filter((item) => item >= today)
  return { ...follows, days: days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort().slice(-MAX_FOLLOWS) }
}

export function dismissFollowNotice(follows: MonitorFollows, id: string): MonitorFollows {
  return follows.dismissed.includes(id) ? follows : { ...follows, dismissed: [...follows.dismissed, id].slice(-MAX_DISMISSED) }
}
