// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdingIdentity, MONITOR_STORAGE_KEY } from '../monitor'
import { loadSettings } from '../store'
import type { useStore } from '../useStore'
import { MonitorView } from './MonitorView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true } })
Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false } })
const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore> }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('./MonitorNewsPanel', () => ({ MonitorNewsPanel: () => null }))

let root: Root
let container: HTMLDivElement

async function renderMonitor() {
  const position = { id: 'NIPPON', ticker: 'NIPPON', name: 'Nippon India Small Cap Fund Direct Growth', type: 'mutual-fund' as const, quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }
  localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ version: 1, alerts: [], events: [], rules: [
    { id: 'rule-1', holding: position.name, holdingId: position.id, instrumentIdentity: holdingIdentity(position), condition: 'price_below', threshold: 90, active: true },
  ] }))
  state.store = {
    positions: [position], liveQuotes: {}, settings: { ...loadSettings(), allowExternalData: false },
    refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null,
  } as unknown as ReturnType<typeof useStore>
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  localStorage.clear()
})

describe('mobile watch rule actions', () => {
  async function openAfterTouchBlur() {
    await renderMonitor()
    const menu = container.querySelector<HTMLDetailsElement>('.mp-rule-menu')!
    const summary = menu.querySelector('summary')!
    await act(async () => { summary.click() })
    expect(menu.open).toBe(true)

    await act(async () => {
      menu.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    })

    expect(menu.open).toBe(true)
    return menu
  }

  it('lets the user delete a rule after touch blur has no related target', async () => {
    const menu = await openAfterTouchBlur()
    const deleteButton = [...menu.querySelectorAll('button')].find((button) => button.textContent === 'Delete')!
    await act(async () => { deleteButton.click() })
    expect(container.querySelector('.mp-rule-row')).toBeNull()
  })

  it('lets the user edit a rule after touch blur has no related target', async () => {
    const menu = await openAfterTouchBlur()
    const editButton = [...menu.querySelectorAll('button')].find((button) => button.textContent === 'Edit')!
    await act(async () => { editButton.click() })
    expect(container.querySelector('#mp-rule-title')?.textContent).toBe('Edit watch rule')
  })
})
