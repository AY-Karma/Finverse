// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdingIdentity, MONITOR_STORAGE_KEY } from '../monitor'
import { loadSettings } from '../store'
import type { Position } from '../types'
import type { useStore } from '../useStore'
import { useMonitor } from '../useMonitor'
import type { WatchSecurity } from '../watchSecurity'
import { RulesPanel } from './monitorPanels'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true } })
Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false } })

const mocks = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore>, search: vi.fn(), quote: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => mocks.store }))
vi.mock('../watchSecuritySearch', async (original) => ({
  ...(await original<typeof import('../watchSecuritySearch')>()),
  searchWatchSecurities: mocks.search,
  fetchWatchQuote: mocks.quote,
}))

const tcs: WatchSecurity = { kind: 'equity', symbol: 'TCS.NS', isin: 'INE467B01029', name: 'Tata Consultancy Services', type: 'stock' }
const motors: WatchSecurity = { kind: 'equity', symbol: 'TATAMOTORS.NS', isin: 'INE155A01022', name: 'Tata Motors Limited', type: 'stock' }
const fund: WatchSecurity = { kind: 'fund', code: 119551, name: 'Example Nifty 50 Index Fund Direct Growth' }
const owned: Position = { id: 'tata-steel', ticker: 'TATASTEEL', name: 'Tata Steel Limited', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120, exchange: 'NSE', currency: 'INR', providerSymbol: 'TATASTEEL.NS', isin: 'INE081A01020' }
const ownedTcs: Position = { ...owned, id: 'tcs', ticker: 'TCS', name: 'TCS Holding', providerSymbol: 'TCS.NS', isin: tcs.isin }

let root: Root
let container: HTMLDivElement

function Host() {
  return <RulesPanel controller={useMonitor()} />
}

async function render(positions: Position[], hideValues = false, rules: unknown[] = []) {
  localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ version: 1, alerts: [], events: [], rules }))
  mocks.store = {
    positions, liveQuotes: {}, settings: { ...loadSettings(), allowExternalData: true, hideValues },
    refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null, workspaceReadOnly: false,
  } as unknown as ReturnType<typeof useStore>
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<Host />))
}

const dialog = () => container.querySelector<HTMLDialogElement>('[aria-labelledby="mp-rule-title"]')!
const combobox = () => dialog().querySelector<HTMLInputElement>('[role="combobox"]')!
const options = () => [...dialog().querySelectorAll('[role="option"]')].map((option) => option.querySelector('.mp-pick-name')!.textContent)
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
}
const openDialog = async () => {
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === '+ New rule')!.click())
  await act(async () => combobox().click())
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.search.mockReset()
  mocks.quote.mockReset().mockResolvedValue(null)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  localStorage.clear()
  vi.useRealTimers()
})

describe('watch rule security search', () => {
  it('can start a rule with no holdings and offers nothing until the user searches', async () => {
    await render([])
    expect(container.querySelector<HTMLButtonElement>('.mp-section-head button')!.disabled).toBe(false)
    await openDialog()
    expect(dialog().open).toBe(true)
    expect(options()).toEqual([])
    expect(mocks.search).not.toHaveBeenCalled()
  })

  it('lists matching holdings first, then index results, without repeating a security the user owns', async () => {
    mocks.search.mockResolvedValue({ securities: [tcs, motors, fund], unavailable: [] })
    await render([owned, ownedTcs])
    await openDialog()
    expect(options()).toEqual(['Tata Steel Limited', 'TCS Holding'])
    await type(combobox(), 'tata')
    expect(mocks.search).toHaveBeenCalledWith('tata', expect.any(AbortSignal))
    expect(options()).toEqual(['Tata Steel Limited', 'Tata Motors Limited', 'Example Nifty 50 Index Fund Direct Growth'])
    expect([...dialog().querySelectorAll('.mp-pick-group')].map((group) => group.textContent)).toEqual(['Your holdings', 'Listed securities'])
  })

  it('saves a rule for a listed security with a suggested level, then shows it by name', async () => {
    mocks.search.mockResolvedValue({ securities: [motors], unavailable: [] })
    mocks.quote.mockResolvedValue({ price: 701.456, at: Date.now(), source: 'yahoo' })
    await render([owned])
    await openDialog()
    await type(combobox(), 'motors')
    await act(async () => dialog().querySelector<HTMLElement>('[role="option"]')!.click())
    expect(combobox().value).toBe('Tata Motors Limited')
    expect(dialog().querySelector('[role="listbox"]')).toBeNull()
    expect(dialog().querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('701.46')
    await act(async () => dialog().querySelector('form')!.requestSubmit())
    expect(dialog().open).toBe(false)
    const [saved] = JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).rules
    expect(saved).toMatchObject({ security: motors, holdingId: 'watch:equity:TATAMOTORS.NS:INE155A01022', condition: 'price_above', threshold: 701.46 })
    expect(container.querySelector('.mp-rule-row strong')!.textContent).toBe('Tata Motors Limited')
  })

  it('follows a fund by NAV and labels its level that way', async () => {
    mocks.search.mockResolvedValue({ securities: [fund], unavailable: [] })
    await render([])
    await openDialog()
    await type(combobox(), 'nifty 50')
    await act(async () => dialog().querySelector<HTMLElement>('[role="option"]')!.click())
    expect(dialog().textContent).toContain('NAV threshold (₹)')
  })

  it('supports the keyboard: arrows move, Enter selects, Escape closes the list before the dialog', async () => {
    mocks.search.mockResolvedValue({ securities: [tcs, motors], unavailable: [] })
    await render([])
    await openDialog()
    await type(combobox(), 'tata')
    const press = (key: string) => act(async () => { combobox().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
    await press('ArrowDown')
    await press('ArrowDown')
    expect(combobox().getAttribute('aria-activedescendant')).toBe(dialog().querySelectorAll('[role="option"]')[1].id)
    await press('Escape')
    expect(dialog().querySelector('[role="listbox"]')).toBeNull()
    await press('ArrowDown')
    await press('Enter')
    expect(combobox().value).toBe('Tata Motors Limited')
  })

  it('rejects links and free text: nothing is searched, nothing can be chosen, and typed text is not kept', async () => {
    await render([owned])
    await openDialog()
    await type(combobox(), 'https://www.nseindia.com/get-quotes/equity?symbol=TCS')
    expect(mocks.search).not.toHaveBeenCalled()
    expect(dialog().querySelector('[role="status"]')!.textContent).toContain('Links and other text are not accepted')
    expect(options()).toEqual([])
    await act(async () => dialog().querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe('Choose a security from the list.')
    await act(async () => combobox().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body })))
    expect(combobox().value).toBe('')
    expect(localStorage.getItem(MONITOR_STORAGE_KEY)).not.toContain('security')
  })

  it('says when a source is unavailable or nothing matches', async () => {
    mocks.search.mockResolvedValueOnce({ securities: [fund], unavailable: ['stocks'] }).mockResolvedValueOnce({ securities: [], unavailable: [] })
    await render([])
    await openDialog()
    await type(combobox(), 'nifty')
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('Stock and ETF search is unavailable.')
    expect(options()).toEqual(['Example Nifty 50 Index Fund Direct Growth'])
    await type(combobox(), 'zzzz')
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('No matching holding, stock, ETF or fund.')
  })

  it('hides holding names but not other securities when values are hidden', async () => {
    const rules = [
      { id: 'own', holding: owned.name, holdingId: owned.id, instrumentIdentity: holdingIdentity(owned), condition: 'price_above', threshold: 150, active: true },
      { id: 'listed', holding: tcs.name, holdingId: 'watch:equity:TCS.NS:INE467B01029', instrumentIdentity: 'watch:equity:TCS.NS:INE467B01029', condition: 'price_above', threshold: 4000, active: true, security: tcs },
    ]
    await render([owned], true, rules)
    expect([...container.querySelectorAll('.mp-rule-row strong')].map((name) => name.textContent)).toEqual(['••••••', 'Tata Consultancy Services'])
    expect(container.textContent).not.toContain('4,000')
  })
})
