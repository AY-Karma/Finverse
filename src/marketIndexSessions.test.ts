import { expect, it } from 'vitest'
import { isGlobalIndexSessionOpen } from './marketIndexSessions'

it.each([
  ['sp-500', '2026-11-14T15:00:00Z', false],
  ['sp-500', '2026-11-09T14:29:00Z', false],
  ['sp-500', '2026-11-09T14:30:00Z', true],
  ['sp-500', '2026-11-09T21:00:00Z', false],
  ['sp-500', '2026-07-06T13:30:00Z', true],
  ['ftse-100', '2026-07-06T07:00:00Z', true],
  ['dax', '2026-11-09T08:00:00Z', true],
  ['cac-40', '2026-11-09T16:30:00Z', false],
  ['nikkei-225', '2026-11-09T03:00:00Z', false],
  ['nikkei-225', '2026-11-09T03:30:00Z', true],
  ['nikkei-225', '2026-11-09T06:30:00Z', false],
  ['hang-seng', '2026-11-09T04:30:00Z', false],
  ['hang-seng', '2026-11-09T05:00:00Z', true],
] as const)('gates %s at %s by its local regular session', (id, date, open) => {
  expect(isGlobalIndexSessionOpen(id, new Date(date))).toBe(open)
})
