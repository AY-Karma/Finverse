// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdingIdentity, MONITOR_STORAGE_KEY } from '../monitor'
import { loadSettings } from '../store'
import type { useStore } from '../useStore'
import { MonitorView } from './MonitorView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore> }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('./MonitorNewsPanel', () => ({ MonitorNewsPanel: () => null }))

let root: Root
let container: HTMLDivElement

async function renderWatch(hideValues: boolean) {
  const positions = ['UP', 'DOWN'].map((ticker) => ({
    id: ticker, ticker, name: ticker, type: 'stock' as const, quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100,
  }))
  localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ version: 1, alerts: [], events: [], rules: [
    { id: 'above', holding: 'UP', holdingId: 'UP', instrumentIdentity: holdingIdentity(positions[0]), condition: 'price_above', threshold: 110, active: true },
    { id: 'below', holding: 'DOWN', holdingId: 'DOWN', instrumentIdentity: holdingIdentity(positions[1]), condition: 'price_below', threshold: 90, active: true },
    { id: 'move', holding: 'UP', holdingId: 'UP', instrumentIdentity: holdingIdentity(positions[0]), condition: 'daily_move', threshold: 1, active: true },
  ] }))
  state.store = {
    positions, liveQuotes: {
      'EQ:UP': { price: 120, changePct: 10, at: Date.now(), source: 'yahoo' },
      'EQ:DOWN': { price: 80, changePct: -10, at: Date.now(), source: 'yahoo' },
    },
    settings: { ...loadSettings(), allowExternalData: true, hideValues },
    refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null,
  } as unknown as ReturnType<typeof useStore>
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
}

function expectNeutralWatch() {
  expect(container.querySelectorAll('.mp-timeline-item')).toHaveLength(5)
  expect(container.querySelector('[data-tone="up"], [data-tone="down"], [data-trend="up"], [data-trend="down"]')).toBeNull()
  expect(container.querySelector('.mp-metric svg, .mp-item-category svg, .mp-rule-condition svg')).toBeNull()
  expect(container.querySelector('.mp-timeline-items')?.textContent).not.toMatch(/Daily move up|Daily move down|Price is above|Price is below|10\.00%/)
  expect(container.querySelector('.mp-rule-list')?.innerHTML).not.toMatch(/Price above|Price below|Daily move exceeds/)
  expect([...container.querySelectorAll('.mp-metric dd')].every((element) => element.textContent === '••••••')).toBe(true)
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  localStorage.clear()
})

describe('Portfolio Watch masking', () => {
  it('neutralizes quote and alert indicators, titles, and rule labels, then restores them', async () => {
    await renderWatch(false)
    expect(container.querySelector('[data-tone="up"]')).not.toBeNull()
    expect(container.querySelector('[data-tone="down"]')).not.toBeNull()
    expect(container.textContent).toContain('Daily move up 10.00%')
    const saved = localStorage.getItem(MONITOR_STORAGE_KEY)

    state.store.settings = { ...state.store.settings, hideValues: true }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expectNeutralWatch()
    expect(localStorage.getItem(MONITOR_STORAGE_KEY)).toBe(saved)

    state.store.settings = { ...state.store.settings, hideValues: false }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expect(container.querySelector('[data-trend="up"]')).not.toBeNull()
    expect(container.querySelector('[data-trend="down"]')).not.toBeNull()
    expect(container.querySelector('.mp-metric svg')).not.toBeNull()
    expect(container.querySelector('.mp-rule-condition svg')).not.toBeNull()
    expect(container.textContent).toContain('Daily move up 10.00%')
  })

  it('starts neutral when masking is already enabled', async () => {
    await renderWatch(true)
    expectNeutralWatch()
    const review = container.querySelector<HTMLButtonElement>('.mp-timeline-item--open .mp-actions button')!
    expect(review.textContent).toContain('Mark reviewed')
    await act(async () => { review.click() })
    expect(container.querySelector('.mp-badge[data-state="reviewed"]')).not.toBeNull()
    expectNeutralWatch()
  })
})
