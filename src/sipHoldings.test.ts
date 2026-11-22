import { describe, expect, it } from 'vitest'
import { investmentWorkspace } from './investmentWorkspace'
import { applySipEstimates, reconcileSipImports, sipEntriesForFund, sipImportCoverage } from './sipHoldings'
import type { SipPlan } from './sipPlans'
import type { Folio, Position } from './types'

const name = 'Parag Parikh Flexi Cap Fund Direct Growth'
const fund: Position = { id: 'pp', ticker: 'PPFAS', name, type: 'mutual-fund', quantity: 120, buyPrice: 70, invested: 8400, lastPrice: 90, currency: 'INR', mfScheme: { code: 122639, name, source: 'confirmed' } }
const folio = (statementDate: string, quantity = 120, previous?: { statementDate: string; quantity: number }): Folio => ({
  id: 'f1', name: 'CAS', importedAt: Date.parse(`${statementDate}T10:00:00Z`), positions: [{ ...fund, quantity }],
  statement: { id: `s-${statementDate}`, fileName: 'cas.pdf', statementDate, completeness: 'complete' },
  ...(previous ? { previousRevision: { statement: { id: 'prev', fileName: 'cas.pdf', statementDate: previous.statementDate, completeness: 'complete' as const }, importedAt: 1, positions: [{ ...fund, quantity: previous.quantity }] } } : {}),
})
const recorded = (date: string, navDate: string, units: number) => ({ date, status: 'recorded' as const, amount: 5000, navDate, nav: 5000 / units, units, added: true as const })
const plan: SipPlan = { id: 'sip', schemeCode: 122639, schemeName: name, amount: 5000, day: 5, start: '2026-12-05', provider: 'groww', method: 'Provider AutoPay', paused: false,
  instalments: [recorded('2026-10-05', '2026-10-05', 56.328), recorded('2026-11-05', '2026-11-05', 53.932), { date: '2026-12-05', status: 'skipped' }] }

describe('SIP estimates in holdings', () => {
  it('adds instalments allotted after the latest import to quantity and invested, with a marker', () => {
    const holdings = applySipEstimates(investmentWorkspace.prepareHoldings([folio('2026-10-31')]), [plan])
    expect(holdings.positions[0]).toMatchObject({ quantity: 173.932, invested: 13_400, sipEstimate: { units: 53.932, amount: 5000, instalments: 1, since: '2026-10-31' } })
    expect(holdings.positions[0].buyPrice).toBeCloseTo(13_400 / 173.932)
    expect(holdings.rawPositions[0].quantity).toBe(120)
  })

  it('stops adding an instalment once an import dated on or after its NAV date covers it, including rolled-forward dates', () => {
    const weekend = { ...plan, instalments: [recorded('2026-12-05', '2026-12-07', 51.307)] }
    expect(applySipEstimates(investmentWorkspace.prepareHoldings([folio('2026-12-06')]), [weekend]).positions[0].sipEstimate?.units).toBe(51.307)
    const covered = investmentWorkspace.prepareHoldings([folio('2026-12-07')])
    expect(applySipEstimates(covered, [weekend])).toBe(covered)
    expect(sipImportCoverage([folio('2026-12-07')], 999)).toBeNull()
  })

  it('adds nothing the user has not added, and lists every entry with its state', () => {
    const { added: _added, ...waiting } = recorded('2026-11-05', '2026-11-05', 53.932)
    const choice = { ...plan, instalments: [recorded('2026-10-05', '2026-10-05', 56.328), waiting] }
    expect(applySipEstimates(investmentWorkspace.prepareHoldings([folio('2026-10-01')]), [choice]).positions[0].sipEstimate).toMatchObject({ units: 56.328, instalments: 1 })
    expect(sipEntriesForFund([choice], [folio('2026-10-01')], 122639).map((entry) => [entry.date, entry.state])).toEqual([['2026-11-05', 'estimate'], ['2026-10-05', 'added']])
    expect(sipEntriesForFund([choice], [folio('2026-10-20')], 122639).map((entry) => [entry.date, entry.state])).toEqual([['2026-11-05', 'estimate'], ['2026-10-05', 'in-import']])
    expect(sipEntriesForFund([choice], [folio('2026-10-01')], 1)).toEqual([])
  })

  it('leaves holdings untouched without plans or for other schemes', () => {
    const holdings = investmentWorkspace.prepareHoldings([folio('2026-10-31')])
    expect(applySipEstimates(holdings, [])).toBe(holdings)
    expect(applySipEstimates(holdings, [{ ...plan, schemeCode: 1 }]).positions[0].quantity).toBe(120)
  })
})

describe('SIP import reconciliation', () => {
  it('marks covered instalments and takes the import’s units when one instalment explains the change', () => {
    const [reconciled] = reconcileSipImports([plan], [folio('2026-11-10', 230.33, { statementDate: '2026-10-31', quantity: 176.4 })])
    expect(reconciled.instalments![0]).toMatchObject({ imported: { statementDate: '2026-11-10' } })
    expect(reconciled.instalments![0]).not.toHaveProperty('imported.units')
    expect(reconciled.instalments![1]).toMatchObject({ units: 53.932, imported: { statementDate: '2026-11-10', units: 53.93, nav: 92.7081 } })
    expect(reconciled.instalments![2]).toEqual({ date: '2026-12-05', status: 'skipped' })
    expect(reconcileSipImports([reconciled], [folio('2026-11-10', 230.33, { statementDate: '2026-10-31', quantity: 176.4 })])[0]).toBe(reconciled)
  })

  it('trusts the import but keeps the estimate when the change does not match (for example a lump-sum buy)', () => {
    const [reconciled] = reconcileSipImports([plan], [folio('2026-11-10', 300, { statementDate: '2026-10-31', quantity: 176.4 })])
    expect(reconciled.instalments![1]).toMatchObject({ units: 53.932, imported: { statementDate: '2026-11-10' } })
    expect(reconciled.instalments![1]).not.toHaveProperty('imported.units')
  })

  it('changes nothing until an import covers an instalment', () => {
    const plans = [plan]
    expect(reconcileSipImports(plans, [folio('2026-10-01')])).toBe(plans)
  })
})
