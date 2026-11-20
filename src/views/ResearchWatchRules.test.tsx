// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MonitorRule } from '../monitor'
import type { MonitorController } from '../useMonitor'
import type { Position } from '../types'
import { ResearchWatchRules } from './ResearchWatchRules'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('../useStore', () => ({ useStore: () => ({ liveQuotes: {}, workspaceReadOnly: false }) }))

const position: Position = { id: 'hdfc', ticker: 'HDFCBANK', name: 'HDFC Bank', type: 'stock', quantity: 1, buyPrice: 700, lastPrice: 846, invested: 700 }
const rule = (overrides: Partial<MonitorRule> = {}): MonitorRule => ({ id: 'r1', holding: 'HDFC Bank', holdingId: 'hdfc', instrumentIdentity: 'x', condition: 'price_above', threshold: 800, active: true, ...overrides })

let root: Root
let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

function controller(rules: MonitorRule[], overrides: Partial<MonitorController> = {}) {
  return { rules, positions: [position], now: Date.now(), allowExternalData: true, hideValues: false, saveRule: vi.fn(() => true), toggleRule: vi.fn(), deleteRule: vi.fn(), ...overrides } as unknown as MonitorController
}

it('lists only this holding’s rules and pauses one', async () => {
  const monitor = controller([rule(), rule({ id: 'other', holdingId: 'tcs' })])
  await act(async () => root.render(<ResearchWatchRules controller={monitor} position={position} />))
  const rows = container.querySelectorAll('.rd-watch-list li')
  expect(rows).toHaveLength(1)
  expect(rows[0].textContent).toContain('Price above ₹800')
  const more = rows[0].querySelector<HTMLButtonElement>('.rd-watch-more')!
  expect(rows[0].querySelector<HTMLElement>('.rd-watch-menu-actions')!.hidden).toBe(true)
  await act(async () => more.click())
  expect(more.getAttribute('aria-expanded')).toBe('true')
  const [pause, remove] = [...rows[0].querySelectorAll<HTMLButtonElement>('.rd-watch-menu-actions button')]
  await act(async () => pause.click())
  expect(monitor.toggleRule).toHaveBeenCalledWith('r1')
  await act(async () => more.click())
  await act(async () => remove.click())
  expect(monitor.deleteRule).toHaveBeenCalledWith('r1')
})

it('adds a rule for the open holding and rejects a non-positive level', async () => {
  const monitor = controller([])
  await act(async () => root.render(<ResearchWatchRules controller={monitor} position={position} />))
  expect(container.textContent).toContain('Get an Overview alert')
  await act(async () => container.querySelector<HTMLButtonElement>('.rd-watch-head button')!.click())
  const input = container.querySelector('input')!
  const setValue = (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await act(async () => setValue('0'))
  await act(async () => container.querySelector('form')!.requestSubmit())
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Enter a positive level.')
  await act(async () => setValue('900'))
  await act(async () => container.querySelector('form')!.requestSubmit())
  expect(monitor.saveRule).toHaveBeenCalledWith({ holdingId: 'hdfc', condition: 'price_above', threshold: 900 })
  expect(container.querySelector('form')).toBeNull()
})

it('masks levels and blocks new rules while values are hidden', async () => {
  await act(async () => root.render(<ResearchWatchRules controller={controller([rule()], { hideValues: true })} position={position} />))
  expect(container.textContent).not.toContain('800')
  expect(container.querySelector<HTMLButtonElement>('.rd-watch-head button')!.disabled).toBe(true)
})

it('reports unavailable rules honestly and blocks new ones for unresolved listings', async () => {
  const unresolved: Position = { ...position, identityIssue: 'Confirm this listing.' }
  await act(async () => root.render(<ResearchWatchRules controller={controller([rule()], { positions: [unresolved] })} position={unresolved} />))
  expect(container.querySelector('.rd-watch-state')?.textContent).toBe('Unavailable')
  expect(container.querySelector<HTMLButtonElement>('.rd-watch-head button')!.disabled).toBe(true)
})

it('closes the rule menu on Escape and returns focus to its toggle', async () => {
  await act(async () => root.render(<ResearchWatchRules controller={controller([rule()])} position={position} />))
  const more = container.querySelector<HTMLButtonElement>('.rd-watch-more')!
  await act(async () => more.click())
  const pause = container.querySelector<HTMLButtonElement>('.rd-watch-menu-actions button')!
  pause.focus()
  await act(async () => pause.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(more.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(more)
})
