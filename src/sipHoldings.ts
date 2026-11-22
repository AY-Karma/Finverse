import type { Folio, Position } from './types'
import type { PreparedHoldings } from './investmentWorkspace'
import { SIP_STAMP_DUTY_RATE, istToday, type SipInstalment, type SipPlan } from './sipPlans'

type Recorded = Extract<SipInstalment, { status: 'recorded' }>

const holdsScheme = (positions: Position[], code: number) => positions.some((position) => position.type === 'mutual-fund' && position.mfScheme?.code === code)
const statementDay = (statementDate: string | null | undefined, importedAt: number) => statementDate ?? istToday(importedAt)
const unitsOf = (positions: Position[], code: number) => positions.reduce((total, position) => total + (position.type === 'mutual-fund' && position.mfScheme?.code === code ? position.quantity : 0), 0)

/** The newest statement date among imports holding this scheme; instalments allotted on or before it are already in the import. */
export function sipImportCoverage(folios: Folio[], code: number): string | null {
  return folios.filter((folio) => holdsScheme(folio.positions, code))
    .map((folio) => statementDay(folio.statement?.statementDate, folio.importedAt))
    .reduce<string | null>((latest, date) => !latest || date > latest ? date : latest, null)
}

/** Recorded instalments not yet contained in an import. */
function pendingSipInstalments(plan: SipPlan, coverage: string | null): Recorded[] {
  return (plan.instalments ?? []).flatMap((item) => item.status === 'recorded' && !item.imported && (!coverage || item.navDate > coverage) ? [item] : [])
}

export type SipEntryState = 'estimate' | 'added' | 'in-import' | 'matched'
export interface SipEntry { planId: string; date: string; navDate: string; nav: number; units: number; amount: number; state: SipEntryState }

/** SIP rows for a fund's entries table: estimates waiting for the user, added estimates, and those the latest import contains. */
export function sipEntriesForFund(plans: SipPlan[], folios: Folio[], code: number): SipEntry[] {
  const plan = plans.find((item) => item.schemeCode === code)
  if (!plan) return []
  const coverage = sipImportCoverage(folios, code)
  return (plan.instalments ?? []).flatMap((item): SipEntry[] => {
    if (item.status !== 'recorded') return []
    const covered = !!item.imported || (!!coverage && item.navDate <= coverage)
    // Only the latest import's instalments stay listed; older ones are part of the imported entry.
    if (covered && (item.imported?.statementDate ?? coverage) !== coverage) return []
    const state: SipEntryState = item.imported?.units ? 'matched' : covered ? 'in-import' : item.added ? 'added' : 'estimate'
    return [{ planId: plan.id, date: item.date, navDate: item.navDate, nav: item.imported?.nav ?? item.nav, units: item.imported?.units ?? item.units, amount: item.amount, state }]
  }).reverse()
}

/** Adds the SIP estimates the user chose to the matching mutual-fund holding until an import covers them. */
export function applySipEstimates(holdings: PreparedHoldings, plans: SipPlan[]): PreparedHoldings {
  if (!plans.length) return holdings
  let changed = false
  const positions = holdings.positions.map((position) => {
    const code = position.type === 'mutual-fund' ? position.mfScheme?.code : undefined
    const plan = code ? plans.find((item) => item.schemeCode === code) : undefined
    if (!plan || !code) return position
    const since = sipImportCoverage(holdings.folios, code)
    const pending = pendingSipInstalments(plan, since).filter((item) => item.added)
    if (!pending.length) return position
    changed = true
    const units = Math.round(pending.reduce((total, item) => total + item.units, 0) * 1000) / 1000
    const amount = pending.reduce((total, item) => total + item.amount, 0)
    const quantity = Math.round((position.quantity + units) * 1e6) / 1e6
    const invested = position.invested + amount
    return { ...position, quantity, invested, buyPrice: invested / quantity, sipEstimate: { units, amount, instalments: pending.length, since } }
  })
  return changed ? { ...holdings, positions } : holdings
}

/**
 * Marks instalments contained in a later import. When the latest import of the scheme has a previous revision and
 * exactly one recorded instalment falls between the two statements, the change in units within 1% of the estimate
 * is taken as that instalment's actual allotment.
 */
export function reconcileSipImports(plans: SipPlan[], folios: Folio[]): SipPlan[] {
  let changed = false
  const next = plans.map((plan) => {
    const coverage = sipImportCoverage(folios, plan.schemeCode)
    if (!coverage || !plan.instalments?.some((item) => item.status === 'recorded' && !item.imported && item.navDate <= coverage)) return plan
    const latest = folios.filter((folio) => holdsScheme(folio.positions, plan.schemeCode) && statementDay(folio.statement?.statementDate, folio.importedAt) === coverage)
    const previous = latest.length === 1 ? latest[0].previousRevision : undefined
    const from = previous ? statementDay(previous.statement.statementDate, previous.importedAt) : null
    const dayOf = (item: SipInstalment) => item.status === 'recorded' ? item.navDate : item.date
    const between = from ? plan.instalments.filter((item) => dayOf(item) > from && dayOf(item) <= coverage) : []
    const delta = previous ? Math.round((unitsOf(latest[0].positions, plan.schemeCode) - unitsOf(previous.positions, plan.schemeCode)) * 1000) / 1000 : 0
    const exact = between.length === 1 && between[0].status === 'recorded' && delta > 0 && Math.abs(delta - between[0].units) / between[0].units <= 0.01 ? between[0] : undefined
    changed = true
    return {
      ...plan,
      instalments: plan.instalments.map((item) => item.status !== 'recorded' || item.imported || item.navDate > coverage ? item
        : { ...item, imported: { statementDate: coverage, ...(item === exact ? { units: delta, nav: Math.round(item.amount * (1 - SIP_STAMP_DUTY_RATE) / delta * 10000) / 10000 } : {}) } }),
    }
  })
  return changed ? next : plans
}
