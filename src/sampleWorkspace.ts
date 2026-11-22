import type { Folio, Position } from './types'
import { MONITOR_STORAGE_KEY } from './monitor'
import { istToday, parseSipPlan, type SipPlan } from './sipPlans'

/** Sample data is offered in development and on Vercel preview deployments only; production never includes it. */
export const SAMPLE_WORKSPACE_ENABLED = import.meta.env.DEV || import.meta.env.VITE_SAMPLE_WORKSPACE === 'true'
export const SAMPLE_MARKER_KEY = 'finverse:sample-workspace'
const FOLIOS_KEY = 'finverse:folios'
const PPFAS = 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth'
const HDFC_INDEX = 'HDFC Index Fund-NIFTY 50 Plan - Direct Plan - Growth'

const stock = (ticker: string, name: string, isin: string, quantity: number, buyPrice: number, lastPrice: number, sector: string): Position => ({
  id: `sample-${ticker.toLowerCase()}`, ticker, name, type: 'stock', quantity, buyPrice, invested: quantity * buyPrice, lastPrice,
  exchange: 'NSE', currency: 'INR', providerSymbol: `${ticker}.NS`, isin, sector, identityVersion: 2, exchangeSource: 'explicit',
})
const fund = (id: string, name: string, code: number, quantity: number, invested: number, lastPrice: number, amc: string, category: string): Position => ({
  id, ticker: name, name, type: 'mutual-fund', quantity, buyPrice: invested / quantity, invested, lastPrice, currency: 'INR', amc, category,
  folio: '91029384', mfScheme: { code, name, source: 'confirmed' },
})
const statement = (statementDate: string) => ({ id: `sample-${statementDate}`, fileName: 'sample-holdings.xlsx', statementDate, completeness: 'complete' as const })
const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** Two monthly instalments already due, so published NAVs can be recorded straight away. */
function sampleDates(now: number) {
  const today = istToday(now)
  const [year, month, day] = today.split('-').map(Number)
  const back = day < 8 ? 2 : 1
  const first = new Date(Date.UTC(year, month - 1 - back, 5, 12)).toISOString().slice(0, 10)
  return { first, imported: shiftDays(first, -4) }
}

export function sampleWorkspace(now = Date.now()): { folios: Folio[]; plans: SipPlan[] } {
  const { first, imported } = sampleDates(now)
  const positions = [
    stock('TCS', 'Tata Consultancy Services', 'INE467B01029', 12, 3420, 3150, 'Information Technology'),
    stock('INFY', 'Infosys Limited', 'INE009A01021', 25, 1480, 1530, 'Information Technology'),
    stock('HDFCBANK', 'HDFC Bank Limited', 'INE040A01034', 30, 1590, 1720, 'Financial Services'),
    fund('sample-ppfas', PPFAS, 122639, 120, 8400, 95.46, 'PPFAS Mutual Fund', 'Flexi Cap'),
    fund('sample-hdfc-index', HDFC_INDEX, 119063, 300, 66_000, 240, 'HDFC Mutual Fund', 'Index Funds'),
  ]
  return {
    folios: [{ id: 'sample-account', name: 'Sample broker account', importedAt: Date.parse(`${imported}T10:00:00Z`), statement: statement(imported), positions }],
    plans: [{ id: 'sample-sip', schemeCode: 122639, schemeName: PPFAS, amount: 5000, day: 5, start: first, provider: 'groww', method: 'Provider AutoPay', paused: false }],
  }
}

function hasRealWorkspace(): boolean {
  return !!localStorage.getItem(FOLIOS_KEY) && !localStorage.getItem(SAMPLE_MARKER_KEY)
}

/** Replaces a sample (or empty) workspace with fresh sample data. Never overwrites a real workspace. */
export function loadSampleWorkspace(now = Date.now()): boolean {
  if (!SAMPLE_WORKSPACE_ENABLED || hasRealWorkspace()) return false
  for (const key of Object.keys(localStorage)) if (key.startsWith('finverse:')) localStorage.removeItem(key)
  const { folios, plans } = sampleWorkspace(now)
  localStorage.setItem(FOLIOS_KEY, JSON.stringify(folios))
  localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ version: 1, rules: [], events: [], alerts: [], sipPlans: plans }))
  localStorage.setItem(SAMPLE_MARKER_KEY, '1')
  return true
}

/**
 * Stands in for the user's next statement import: it contains every recorded instalment, and the change since the
 * previous statement equals the latest instalment's units at statement precision, so that instalment is matched.
 */
export function simulateNextImport(now = Date.now()): string {
  if (!SAMPLE_WORKSPACE_ENABLED || !localStorage.getItem(SAMPLE_MARKER_KEY)) return 'Load the sample workspace first.'
  const folios = JSON.parse(localStorage.getItem(FOLIOS_KEY) ?? '[]') as Folio[]
  const monitor = JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY) ?? '{}') as { sipPlans?: unknown[] }
  const plan = parseSipPlan(monitor.sipPlans?.[0])
  const recorded = (plan?.instalments ?? []).flatMap((item) => item.status === 'recorded' && !item.imported ? [item] : [])
  const account = folios[0]
  const holding = account?.positions.find((position) => position.mfScheme?.code === plan?.schemeCode)
  if (!plan || !account || !holding || !recorded.length) return 'No recorded instalments yet. Open Settings → Recurring SIPs and wait for their NAVs.'
  const latest = recorded.at(-1)!
  const earlier = recorded.slice(0, -1)
  const units = (items: typeof recorded) => items.reduce((total, item) => total + item.units, 0)
  const round2 = (value: number) => Math.round(value * 100) / 100
  const before = { quantity: round2(holding.quantity + units(earlier)), invested: holding.invested + earlier.length * plan.amount }
  const after = { quantity: round2(before.quantity + latest.units), invested: before.invested + plan.amount }
  const withHolding = (values: { quantity: number; invested: number }) => account.positions.map((position) => position.id === holding.id
    ? { ...position, ...values, buyPrice: values.invested / values.quantity } : position)
  const today = istToday(now)
  localStorage.setItem(FOLIOS_KEY, JSON.stringify([{
    ...account, importedAt: now, statement: statement(today), lastOperation: 'updated', operationAt: now, positions: withHolding(after),
    previousRevision: { statement: statement(shiftDays(latest.navDate, -1)), importedAt: now - 86_400_000, positions: withHolding(before) },
  }]))
  return `Imported a ${today} statement with ${after.quantity} units.`
}
