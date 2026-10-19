import { expect, it } from 'vitest'
import { getImportFreshness } from './importFreshness'

const importedAt = Date.parse('2026-10-01T10:00:00Z')

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
