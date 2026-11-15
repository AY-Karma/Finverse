// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Position } from '../../types'
import { SipSettingsPrototype } from './SipSettingsPrototype'

const state = vi.hoisted(() => ({ positions: [] as Position[], settings: { hideValues: false, allowExternalData: true }, confirmFundScheme: vi.fn(), search: vi.fn() }))
vi.mock('../../useStore', () => ({ useStore: () => state }))
vi.mock('../../marketData', () => ({ marketData: { reviewFundScheme: state.search } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let container: HTMLDivElement
let root: Root
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
const match = { schemeCode: 999901, schemeName: 'Motilal Oswal Midcap Fund Direct Plan Growth' }
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text)!

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  window.history.replaceState({}, '', '/app/settings')
  state.positions = []; state.settings = { hideValues: false, allowExternalData: true }
  state.search.mockResolvedValue({ status: 'matched', match, candidates: [match], reason: 'Exact fund, plan and option match.' })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals()
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

it('retains approval and candidate confirmation inside Scheme matches, with sample confirmations staying local', async () => {
  await act(async () => root.render(<SipSettingsPrototype />))
  await act(async () => button('Scheme matches').click())
  expect(button('Auto-approve schemes')).toBeDefined()
  expect(container.querySelectorAll('details.fund-review')).toHaveLength(1)
  const pending = [...container.querySelectorAll<HTMLButtonElement>('.fund-scheme-trigger')].find((item) => item.textContent?.includes('Motilal'))!
  await act(async () => pending.click())
  expect(container.querySelector('.scheme-picker [role="listbox"]')).not.toBeNull()
  expect(state.confirmFundScheme).not.toHaveBeenCalled()
  await act(async () => button('Confirm scheme').click())
  expect(container.textContent).toContain('Code 999901')
  expect(state.confirmFundScheme).not.toHaveBeenCalled()
  await act(async () => button('Recurring SIPs').click())
  expect(button('+ Add SIP')).toBeDefined()
})

it('uses imported funds and the original saved confirmation path when holdings exist', async () => {
  state.positions = [{ id: 'owned', ticker: 'MOTILAL', name: match.schemeName, type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }]
  await act(async () => root.render(<SipSettingsPrototype />))
  await act(async () => button('Scheme matches').click())
  expect(container.querySelectorAll('.fund-scheme-trigger')).toHaveLength(1)
  expect(container.querySelector('.fund-scheme-content')?.textContent).not.toContain('Parag')
  await act(async () => container.querySelector<HTMLButtonElement>('.fund-scheme-trigger')!.click())
  await act(async () => button('Confirm scheme').click())
  expect(state.confirmFundScheme).toHaveBeenCalledExactlyOnceWith('owned', match)
  expect(container.querySelector('.sip-prototype-caption')?.textContent).toContain('Scheme approvals are saved')
})

it('rolls the weekend NAV estimate forward while keeping units pending and the original recurring date', async () => {
  await act(async () => root.render(<SipSettingsPrototype />))
  await act(async () => button('Check pending instalment').click())
  expect(container.textContent).toContain('falls on a weekend')
  expect(container.textContent).toContain('Estimated NAV: 7 Dec 2026 (next business day)')
  expect(container.textContent).toContain('Every 5th')
  expect(container.textContent).toContain('No units added')
  expect(container.querySelector('.sip-estimated-units')).toBeNull()
  expect(state.confirmFundScheme).not.toHaveBeenCalled()
})
