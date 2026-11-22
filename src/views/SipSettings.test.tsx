// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MONITOR_STORAGE_KEY } from '../monitor'
import { loadSettings } from '../store'
import type { Position } from '../types'
import type { useStore } from '../useStore'
import { SipSettings } from './SipSettings'

const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore> }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('./FundSchemeReview', () => ({ FundSchemeReview: () => <details className="fund-review"><summary>Mutual-fund schemes</summary>Scheme review</details> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const schemeName = 'Parag Parikh Flexi Cap Fund Direct Plan Growth'
const confirmed: Position = { id: 'pp', ticker: 'PPFAS', name: schemeName, type: 'mutual-fund', quantity: 10, buyPrice: 80, invested: 800, lastPrice: 90, currency: 'INR', mfScheme: { code: 122639, name: schemeName, source: 'confirmed' } }
const pending: Position = { ...confirmed, id: 'mid', name: 'Motilal Oswal Midcap Fund', mfScheme: undefined }
const stock: Position = { id: 'tcs', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 1, invested: 1, lastPrice: 1 }

let root: Root
let container: HTMLDivElement
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text)
const saved = () => JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY) ?? '{}').sipPlans

async function render(positions: Position[], hideValues = false) {
  state.store = {
    positions, liveQuotes: {}, settings: { ...loadSettings(), allowExternalData: true, hideValues },
    refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null, workspaceReadOnly: false,
  } as unknown as ReturnType<typeof useStore>
  await act(async () => root.render(<section className="holdings-manage"><SipSettings /></section>))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-22T06:00:00Z'))
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals()
})

it('stays out of the way without mutual funds', async () => {
  await render([stock])
  expect(container.querySelector('.holdings-manage')!.innerHTML).toBe('')
})

it('sits below Mutual-fund schemes and points to it until a scheme is confirmed', async () => {
  await render([pending])
  const [schemes, sips] = [...container.querySelectorAll<HTMLDetailsElement>('details.fund-review')]
  expect(sips.querySelector('.listing-review-copy')!.textContent).toBe('Recurring SIPsConfirm a scheme to track a SIP.')
  expect(sips.textContent).toContain('Confirm a scheme first.')
  await act(async () => button('Open Mutual-fund schemes')!.click())
  expect(schemes.open).toBe(true)
})

it('tracks a SIP for an imported fund, saves it and keeps it across reloads', async () => {
  await render([confirmed, pending])
  await act(async () => button('Track your first SIP')!.click())
  const amount = container.querySelector<HTMLInputElement>('[data-sip-amount]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, '5,000')
    amount.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(container.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-12-05')
  await act(async () => container.querySelector('form')!.requestSubmit())
  expect(saved()).toEqual([expect.objectContaining({ schemeCode: 122639, schemeName, amount: 5000, day: 5, start: '2026-12-05', provider: 'groww', paused: false })])
  expect(container.querySelector('.sip-plan-context')!.textContent).toBe('ActiveNext 5 DecNAV est. 7 Dec')
  expect(container.querySelector('.sip-schemes .listing-review-copy')!.textContent).toBe('Recurring SIPs1 SIP tracked · ₹5,000 / month')

  await act(async () => root.unmount())
  root = createRoot(container)
  await render([confirmed])
  expect(container.querySelector('.sip-plan strong')!.textContent).toBe(schemeName)
})

it('skips one instalment, pauses, resumes and removes tracking', async () => {
  localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ version: 1, rules: [], events: [], alerts: [], sipPlans: [
    { id: 'p1', schemeCode: 122639, schemeName, amount: 5000, day: 5, start: '2026-12-05', provider: 'zerodha', method: 'Provider AutoPay', paused: false },
  ] }))
  await render([confirmed])
  await act(async () => button('Skip next')!.click())
  expect(container.querySelector('.sip-plan-context')!.textContent).toBe('Skipped 5 DecNext 5 Jan 2027NAV date pending')
  expect(saved()[0].skipDate).toBe('2026-12-05')
  await act(async () => button('Undo skip')!.click())
  expect(saved()[0].skipDate).toBeUndefined()
  await act(async () => button('Pause')!.click())
  expect(container.querySelector('.sip-plan-context')!.textContent).toBe('Paused')
  expect(container.querySelector('.sip-schemes .listing-review-copy')!.textContent).toBe('Recurring SIPs1 SIP tracked · 1 paused · ₹0 / month')
  await act(async () => button('Resume')!.click())
  await act(async () => button('Remove')!.click())
  await act(async () => button('Remove tracking')!.click())
  expect(saved()).toEqual([])
  expect(container.textContent).toContain('SIP tracking removed.')
})

it('labels a tracked SIP whose fund is no longer held, and hides everything when values are hidden', async () => {
  localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ version: 1, rules: [], events: [], alerts: [], sipPlans: [
    { id: 'p1', schemeCode: 999, schemeName: 'Sold Fund Direct Growth', amount: 1000, day: 10, start: '2026-12-10', provider: 'amc', method: 'Manual payment', paused: false },
  ] }))
  await render([confirmed])
  expect(container.querySelector('.sip-plan-name')!.textContent).toContain('Not in current holdings')
  await render([confirmed], true)
  expect(container.querySelector('.sip-hidden')).not.toBeNull()
  expect(container.textContent).not.toContain('Sold Fund')
})
