import { isCalendarDate } from '../../fundBusinessDays'
export { isCalendarDate as isSipDate } from '../../fundBusinessDays'

export const MAX_SIP_AMOUNT = 99_999_999.99

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

export function nextSipDate(plan: { start: string; day: number; skipped: boolean }): string {
  const value = new Date(`${plan.start}T12:00:00Z`)
  if (plan.skipped) value.setUTCMonth(value.getUTCMonth() + 1, 1)
  const last = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate()
  value.setUTCDate(Math.min(plan.day, last))
  return value.toISOString().slice(0, 10)
}

export function isWeekendSipDate(value: string): boolean {
  if (!isCalendarDate(value)) return false
  return [0, 6].includes(new Date(`${value}T12:00:00Z`).getUTCDay())
}
