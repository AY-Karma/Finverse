import type { Folio } from './types'

export type ImportFreshness = 'healthy' | 'aging' | 'old' | 'unknown'

const DAY_MS = 24 * 60 * 60 * 1000

export function getImportFreshness(importedAt: number, now = Date.now()): ImportFreshness {
  if (!Number.isFinite(importedAt) || !Number.isFinite(new Date(importedAt).getTime()) || !Number.isFinite(now)) return 'unknown'

  const age = Math.max(0, now - importedAt)
  if (age <= 7 * DAY_MS) return 'healthy'
  if (age <= 21 * DAY_MS) return 'aging'
  return 'old'
}

export function getFolioFreshness(folio: Pick<Folio, 'importedAt' | 'reviewedAt'>, now = Date.now()): ImportFreshness {
  return getImportFreshness(Math.max(folio.importedAt, folio.reviewedAt ?? folio.importedAt), now)
}

export function canConfirmFolioUnchanged(folio: Pick<Folio, 'importedAt' | 'reviewedAt'>, now = Date.now()): boolean {
  const freshness = getFolioFreshness(folio, now)
  return freshness === 'aging' || freshness === 'old'
}
