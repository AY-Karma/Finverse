// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdingIdentity, MONITOR_STORAGE_KEY } from '../monitor'
import { loadSettings } from '../store'
import type { useStore } from '../useStore'
import { MonitorView } from './MonitorView'
import { useMonitor } from '../useMonitor'
import { quoteKey } from '../valuation'
import { ReminderAction, RulesPanel, type ReminderRequest, type RuleRequest } from './monitorPanels'

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
  it('shows waiting until a recent compatible observation exists and hides capacity noise', async () => {
    await renderMonitor()
    expect(container.querySelector('.mp-rule-state')?.textContent).toBe('Waiting')
    expect(container.querySelector('.mp-rule-capacity')).toBeNull()
    state.store.settings = { ...state.store.settings, allowExternalData: true }
    const position = state.store.positions[0]
    state.store.liveQuotes = { [quoteKey(position)]: { price: 100, source: 'nav', at: Date.now() } }
    await act(async () => root.render(<MonitorView onRequestImport={() => {}} />))
    expect(container.querySelector('.mp-rule-state')?.textContent).toBe('Active')
    expect(container.querySelector('.mp-rule-observation')?.textContent).toContain('10.00% to level')
    expect(container.querySelector('.mp-rule-observation')?.textContent).toContain('Published NAV')
    state.store.liveQuotes = { [quoteKey(position)]: { price: 100, source: 'nav', at: Date.now() - 5 * 86_400_000 } }
    await act(async () => root.render(<MonitorView onRequestImport={() => {}} />))
    expect(container.querySelector('.mp-rule-state')?.textContent).toBe('Waiting')
    expect(container.querySelector('.mp-rule-observation')?.textContent).not.toContain('10.00%')
  })

  it('opens a contextual watch form for the requested holding and supports repeating the action', async () => {
    await renderMonitor()
    let request: RuleRequest = { holdingId: 'missing', revision: 1 }
    const Context = () => <RulesPanel controller={useMonitor()} request={request} />
    await act(async () => root.render(<Context />))
    const dialog = container.querySelector<HTMLDialogElement>('[aria-labelledby="mp-rule-title"]')!
    expect(dialog.open).toBe(false)
    request = { holdingId: 'NIPPON', revision: 2 }
    await act(async () => root.render(<Context />))
    expect(dialog.open).toBe(true)
    expect(dialog.querySelector('select')?.value).toBe('NIPPON')
    expect(dialog.querySelector('h2')?.textContent).toBe('Create a watch rule')
    await act(async () => dialog.close())
    request = { ...request, revision: 3 }
    await act(async () => root.render(<Context />))
    expect(dialog.open).toBe(true)
  })

  it('prefills a contextual reminder without persisting it until submitted', async () => {
    await renderMonitor()
    const saved = localStorage.getItem(MONITOR_STORAGE_KEY)
    const request: ReminderRequest = { holdingId: 'NIPPON', title: 'Read the fund notice', date: '2035-01-20', revision: 1 }
    const Context = () => <ReminderAction controller={useMonitor()} request={request} />
    await act(async () => root.render(<Context />))
    const dialog = container.querySelector<HTMLDialogElement>('[aria-labelledby="mp-reminder-title"]')!
    expect(dialog.open).toBe(true)
    expect(dialog.querySelector('select')?.value).toBe('NIPPON')
    expect(dialog.querySelector<HTMLInputElement>('input[maxlength]')?.value).toBe('Read the fund notice')
    expect(dialog.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('2035-01-20')
    expect(localStorage.getItem(MONITOR_STORAGE_KEY)).toBe(saved)
    state.store.settings = { ...state.store.settings, hideValues: true }
    await act(async () => root.render(<Context />))
    expect(dialog.open).toBe(false)
    expect(dialog.querySelector<HTMLInputElement>('input[maxlength]')?.value).toBe('')
  })

  it('closes a private rule form and blocks editing when masking is enabled', async () => {
    await renderMonitor()
    const edit = [...container.querySelectorAll<HTMLButtonElement>('.mp-rule-menu button')].find(button => button.textContent === 'Edit')!
    await act(async () => edit.click())
    const dialog = container.querySelector<HTMLDialogElement>('[aria-labelledby="mp-rule-title"]')!
    expect(dialog.open).toBe(true)
    state.store.settings = { ...state.store.settings, hideValues: true }
    await act(async () => root.render(<MonitorView onRequestImport={() => {}} />))
    expect(dialog.open).toBe(false)
    expect(edit.disabled).toBe(true)
    expect(container.textContent).not.toContain('Nippon India')
    const actions = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.textContent === '+ New rule' || button.getAttribute('aria-label') === 'Add reminder')
    expect(actions).toHaveLength(2)
    expect(actions.every(button => button.disabled)).toBe(true)
  })

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

  it('shows a flagged rule as unavailable even when its old holding ID still exists', async () => {
    await renderMonitor()
    const saved = JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!)
    saved.rules[0].unresolved = true
    saved.rules[0].instrumentIdentity += '|old-mapping'
    localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify(saved))
    await act(async () => window.dispatchEvent(new Event('finverse:monitor-restored')))
    expect(container.querySelector('.mp-rule-state')?.textContent).toBe('Unavailable')
    expect(container.querySelector('.mp-rule-menu')).toBeNull()
  })
})
