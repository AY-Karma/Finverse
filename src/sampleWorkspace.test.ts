import './test/storage'
import { afterEach, expect, it } from 'vitest'
import { MONITOR_STORAGE_KEY } from './monitor'
import { loadSampleWorkspace, sampleWorkspace, simulateNextImport } from './sampleWorkspace'
import { reconcileSipImports } from './sipHoldings'
import { settleSipPlan, type SipPlan } from './sipPlans'
import type { Folio } from './types'

const now = Date.parse('2026-11-22T06:00:00Z')
afterEach(() => localStorage.clear())

it('seeds a confirmed fund with a SIP whose first two instalments are already due', () => {
  const { folios, plans } = sampleWorkspace(now)
  expect(plans[0]).toMatchObject({ start: '2026-10-05', day: 5, schemeCode: 122639 })
  expect(folios[0].statement?.statementDate).toBe('2026-10-01')
  expect(folios[0].positions.filter((position) => position.mfScheme)).toHaveLength(2)
})

it('never replaces a real workspace', () => {
  localStorage.setItem('finverse:folios', '[{"id":"mine"}]')
  expect(loadSampleWorkspace(now)).toBe(false)
  expect(localStorage.getItem('finverse:folios')).toBe('[{"id":"mine"}]')
})

it('simulates a next import that covers recorded instalments and matches the latest one', () => {
  expect(loadSampleWorkspace(now)).toBe(true)
  const monitor = JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!)
  const settled = settleSipPlan(monitor.sipPlans[0] as SipPlan, '2026-11-22', [{ date: '2026-10-05', close: 88.762 }, { date: '2026-11-05', close: 92.7055 }])
  localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ ...monitor, sipPlans: [settled] }))
  expect(simulateNextImport(now)).toContain('2026-11-22')
  const folios = JSON.parse(localStorage.getItem('finverse:folios')!) as Folio[]
  const [reconciled] = reconcileSipImports([settled], folios)
  expect(reconciled.instalments!.map((item) => item.status === 'recorded' && item.imported)).toEqual([
    { statementDate: '2026-11-22' },
    { statementDate: '2026-11-22', units: 53.93, nav: expect.any(Number) },
  ])
})
