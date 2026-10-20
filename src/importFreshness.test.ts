import { expect, it } from 'vitest'
import { canConfirmFolioUnchanged, getFolioFreshness, getImportFreshness } from './importFreshness'

const importedAt = Date.parse('2026-10-01T10:00:00Z')

it('only permits unchanged confirmation strictly after seven days from import or last review', () => {
  const boundary = importedAt + 7 * 86_400_000
  expect(canConfirmFolioUnchanged({ importedAt }, boundary)).toBe(false)
  expect(canConfirmFolioUnchanged({ importedAt }, boundary + 1)).toBe(true)
  expect(canConfirmFolioUnchanged({ importedAt, reviewedAt: boundary + 1 }, boundary + 2)).toBe(false)
  expect(canConfirmFolioUnchanged({ importedAt, reviewedAt: boundary + 1 }, boundary + 1 + 7 * 86_400_000 + 1)).toBe(true)
  expect(canConfirmFolioUnchanged({ importedAt: Number.NaN }, boundary)).toBe(false)
})

it('starts a new freshness period on review without changing the import timestamp', () => {
  const reviewedAt = importedAt + 28 * 86_400_000
  const folio = { importedAt, reviewedAt }
  expect(getFolioFreshness({ importedAt }, reviewedAt)).toBe('old')
  expect(getFolioFreshness(folio, reviewedAt)).toBe('healthy')
  expect(getFolioFreshness(folio, reviewedAt + 21 * 86_400_000)).toBe('aging')
  expect(getFolioFreshness(folio, reviewedAt + 21 * 86_400_000 + 1)).toBe('old')
  expect(getFolioFreshness({ importedAt, reviewedAt: importedAt - 28 * 86_400_000 }, importedAt)).toBe('healthy')
})

it.each([
  ['2026-10-01T10:00:00Z', 'healthy'],
  ['2026-10-08T10:00:00Z', 'healthy'],
  ['2026-10-08T10:00:00.001Z', 'aging'],
  ['2026-10-22T10:00:00Z', 'aging'],
  ['2026-10-22T10:00:00.001Z', 'old'],
  ['2026-11-01T10:00:00Z', 'old'],
] as const)('classifies elapsed import age at %s as %s', (date, expected) => {
  expect(getImportFreshness(importedAt, Date.parse(date))).toBe(expected)
})

it('treats future imports as recent when the local clock is behind', () => {
  expect(getImportFreshness(importedAt, Date.parse('2026-09-30T10:00:00Z'))).toBe('healthy')
})

it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 9e15])('keeps invalid import dates neutral', (date) => {
  expect(getImportFreshness(date, importedAt)).toBe('unknown')
})

it('keeps an invalid current time neutral', () => {
  expect(getImportFreshness(importedAt, Number.NaN)).toBe('unknown')
})
