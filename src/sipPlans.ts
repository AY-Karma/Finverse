import { EQUITY_MF_MARKET_CALENDAR_2026, isCalendarDate, nextFundBusinessDate } from './fundBusinessDays'

/** A later import that already contains an instalment. Units and NAV are set only when the import pins them down exactly. */
export interface SipImportMatch { statementDate: string; units?: number; nav?: number }

/** One settled instalment: recorded against its expected NAV, or skipped by the user. */
export type SipInstalment =
  | { date: string; status: 'recorded'; amount: number; navDate: string; nav: number; units: number; imported?: SipImportMatch; added?: true }
  | { date: string; status: 'skipped' }

/** A SIP the user already runs with a provider; Finverse tracks its schedule and estimates units from published NAVs. */
export interface SipPlan {
  id: string
  schemeCode: number
  schemeName: string
  amount: number
  /** Day of the month, 1–31; shorter months use their last day. */
  day: number
  /** Next instalment not yet settled; moves forward as instalments are recorded. */
  start: string
  provider: string
  method: string
  paused: boolean
  /** One upcoming instalment the user skipped; stops applying once that date passes. */
  skipDate?: string
  /** Settled instalments, oldest first. Estimates only: imported holdings are never changed. */
  instalments?: SipInstalment[]
}

export const SIP_PROVIDERS = [
  { id: 'groww', name: 'Groww' },
  { id: 'zerodha', name: 'Zerodha Coin' },
  { id: 'angel', name: 'Angel One' },
  { id: 'indmoney', name: 'INDmoney' },
  { id: 'amc', name: 'Direct with AMC' },
  { id: 'other', name: 'Other provider' },
] as const
export const SIP_PAYMENT_METHODS = ['Provider AutoPay', 'UPI mandate (AutoPay)', 'Bank mandate (e-NACH)', 'BSE mandate', 'Bank standing instruction', 'Manual payment', 'Other / Not sure'] as const
const MAX_SIP_AMOUNT = 99_999_999.99
export const MAX_SIP_PLANS = 200
const MAX_SIP_INSTALMENTS = 120
/** Stamp duty on mutual-fund purchases (0.005%) is deducted before units are allotted. */
export const SIP_STAMP_DUTY_RATE = 0.00005

/** The exchange calendar suits domestic equity schemes; liquid and overnight funds follow different allotment rules. */
export function usesEquityCalendar(name: string, category = ''): boolean {
  return !/\b(liquid|overnight)\b/i.test(`${name} ${category}`)
}

/** Units allotted for an instalment: net of stamp duty, rounded to three decimals as registrars report them. */
export function sipUnits(amount: number, nav: number): number {
  return Math.round(amount * (1 - SIP_STAMP_DUTY_RATE) / nav * 1000) / 1000
}

export { isCalendarDate as isSipDate }

export function istToday(now: number): string {
  return new Date(now + 19_800_000).toISOString().slice(0, 10)
}

export function normalizeSipAmountInput(value: string): string | null {
  const normalized = value.replace(/,/g, '').trim()
  return /^\d{0,8}(?:\.\d{0,2})?$/.test(normalized) ? normalized : null
}

export function parseSipAmount(value: string): number | null {
  const normalized = normalizeSipAmountInput(value)
  if (normalized === null || !/^\d{1,8}(?:\.\d{1,2})?$/.test(normalized)) return null
  const amount = Number(normalized)
  return amount >= 1 && amount <= MAX_SIP_AMOUNT ? amount : null
}

function occurrence(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, last), 12)).toISOString().slice(0, 10)
}

/** The first instalment on or after `from` (and never before the plan's start). */
export function sipDateOnOrAfter(plan: Pick<SipPlan, 'start' | 'day'>, from: string): string {
  const floor = plan.start > from ? plan.start : from
  const year = Number(floor.slice(0, 4))
  const month = Number(floor.slice(5, 7)) - 1
  const current = occurrence(year, month, plan.day)
  return current >= floor ? current : occurrence(year, month + 1, plan.day)
}

/** Next instalment from today, honouring a skipped date. */
export function sipSchedule(plan: Pick<SipPlan, 'start' | 'day' | 'skipDate'>, today: string): { next: string; skipped?: string } {
  const upcoming = sipDateOnOrAfter(plan, today)
  if (plan.skipDate !== upcoming) return { next: upcoming }
  const after = new Date(`${upcoming}T12:00:00Z`)
  after.setUTCDate(after.getUTCDate() + 1)
  return { next: sipDateOnOrAfter(plan, after.toISOString().slice(0, 10)), skipped: upcoming }
}

function dayAfter(date: string): string {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

/** Scheduled instalments from the plan's next unsettled date through today. */
export function dueSipDates(plan: Pick<SipPlan, 'start' | 'day'>, today: string): string[] {
  const dates: string[] = []
  for (let date = sipDateOnOrAfter(plan, plan.start); date <= today && dates.length < 24; date = sipDateOnOrAfter(plan, dayAfter(date))) dates.push(date)
  return dates
}


/** The NAV an instalment is allotted at: the expected business day's NAV for equity schemes, otherwise the first published on or after the date. */
function allotmentNav(date: string, today: string, navs: readonly { date: string; close: number }[], equityCalendar: boolean) {
  const published = navs.filter((item) => item.date >= date && item.date <= today && Number.isFinite(item.close) && item.close > 0)
  const expected = equityCalendar ? nextFundBusinessDate(date, EQUITY_MF_MARKET_CALENDAR_2026) : undefined
  if (expected?.status !== 'available') return published[0]
  // A later NAV with none for the expected day means the calendar and the publication disagree; fall back to publication order.
  return published.find((item) => item.date === expected.date) ?? (published.some((item) => item.date > expected.date) ? published[0] : undefined)
}

/** Settles due instalments in order; settlement stops at the first instalment whose NAV is not yet published. */
export function settleSipPlan(plan: SipPlan, today: string, navs: readonly { date: string; close: number }[], equityCalendar = true): SipPlan {
  if (plan.paused) return plan
  const settled: SipInstalment[] = []
  let start = plan.start
  for (const date of dueSipDates(plan, today)) {
    if (date === plan.skipDate) settled.push({ date, status: 'skipped' })
    else {
      const point = allotmentNav(date, today, navs, equityCalendar)
      if (!point) break
      settled.push({ date, status: 'recorded', amount: plan.amount, navDate: point.date, nav: point.close, units: sipUnits(plan.amount, point.close) })
    }
    start = sipDateOnOrAfter(plan, dayAfter(date))
  }
  if (!settled.length) return plan
  const { skipDate, ...rest } = plan
  return {
    ...rest, start, instalments: [...(plan.instalments ?? []), ...settled].slice(-MAX_SIP_INSTALMENTS),
    ...(skipDate && skipDate >= start ? { skipDate } : {}),
  }
}

/** The earliest due instalment still waiting for its NAV, if any. */
export function pendingSipDate(plan: SipPlan, today: string): string | undefined {
  if (plan.paused) return undefined
  return dueSipDates(plan, today).find((date) => date !== plan.skipDate)
}

export function sipDueToday(plan: SipPlan, today: string): boolean {
  return !plan.paused && sipSchedule(plan, today).next === today
}

export function parseSipPlan(value: unknown): SipPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const name = typeof row.schemeName === 'string' ? row.schemeName.trim() : ''
  const amount = typeof row.amount === 'number' ? parseSipAmount(String(row.amount)) : null
  if (!id || id.length > 200 || !name || name.length > 500 || amount === null
    || typeof row.schemeCode !== 'number' || !Number.isSafeInteger(row.schemeCode) || row.schemeCode <= 0
    || typeof row.day !== 'number' || !Number.isInteger(row.day) || row.day < 1 || row.day > 31
    || typeof row.start !== 'string' || !isCalendarDate(row.start)
    || !SIP_PROVIDERS.some((provider) => provider.id === row.provider)
    || !(SIP_PAYMENT_METHODS as readonly unknown[]).includes(row.method)
    || typeof row.paused !== 'boolean'
    || (row.skipDate !== undefined && (typeof row.skipDate !== 'string' || !isCalendarDate(row.skipDate)))) return null
  const instalments = row.instalments === undefined ? [] : Array.isArray(row.instalments) && row.instalments.length <= MAX_SIP_INSTALMENTS ? row.instalments.map(parseInstalment) : [null]
  if (instalments.some((item) => item === null)) return null
  return {
    id, schemeCode: row.schemeCode, schemeName: name, amount, day: row.day, start: row.start,
    provider: row.provider as string, method: row.method as string, paused: row.paused,
    ...(row.skipDate ? { skipDate: row.skipDate as string } : {}),
    ...(instalments.length ? { instalments: instalments as SipInstalment[] } : {}),
  }
}

function parseInstalment(value: unknown): SipInstalment | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.date !== 'string' || !isCalendarDate(row.date)) return null
  if (row.status === 'skipped') return { date: row.date, status: 'skipped' }
  const positive = (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0
  if (row.status !== 'recorded' || typeof row.navDate !== 'string' || !isCalendarDate(row.navDate) || row.navDate < row.date || !positive(row.amount) || !positive(row.nav) || !positive(row.units)) return null
  let imported: SipImportMatch | undefined
  if (row.imported !== undefined) {
    const match = row.imported as Record<string, unknown> | null
    if (!match || typeof match.statementDate !== 'string' || !isCalendarDate(match.statementDate)
      || (match.units !== undefined && !positive(match.units)) || (match.nav !== undefined && !positive(match.nav))) return null
    imported = { statementDate: match.statementDate, ...(match.units !== undefined ? { units: match.units as number } : {}), ...(match.nav !== undefined ? { nav: match.nav as number } : {}) }
  }
  if (row.added !== undefined && row.added !== true) return null
  return { date: row.date, status: 'recorded', amount: row.amount, navDate: row.navDate, nav: row.nav, units: row.units, ...(imported ? { imported } : {}), ...(row.added ? { added: true as const } : {}) }
}
