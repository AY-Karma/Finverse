// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSettings } from '../store'
import type { Folio, Position, Settings } from '../types'
import { SettingsView } from './SettingsView'

const state = vi.hoisted(() => ({ settings: {} as Settings, setSettings: vi.fn(), folios: [] as Folio[], positions: [] as Position[], removeFolio: vi.fn(), undoLastImport: vi.fn(), undoImportFolioId: null, exportPortfolio: vi.fn(), settingsSaved: true }))
vi.mock('../useStore', () => ({ useStore: () => state }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
const captureDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture')
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false })
  window.history.replaceState({}, '', '/app/settings')
  state.folios = []
  state.positions = []
  state.settingsSaved = true
  state.settings = loadSettings()
  state.setSettings.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  if (captureDescriptor) Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', captureDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture')
})

describe('workspace settings', () => {
  it('selects and swaps grouped market index slots with shared keyboard and dismissal behavior', async () => {
    const render = () => act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    await render()
    const triggers = [...container.querySelectorAll<HTMLButtonElement>('.settings-index-control .select-control-trigger')]
    expect(triggers).toHaveLength(2)
    expect(triggers[0].closest('[aria-label="Preferences"]')).not.toBeNull()
    const firstTrigger = triggers[0]
    expect(firstTrigger.getAttribute('aria-label')).toBe('First market index NIFTY Bank')
    await act(async () => { firstTrigger.focus(); firstTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    await settle()
    expect(firstTrigger.getAttribute('aria-expanded')).toBe('true')
    expect([...document.querySelectorAll('.select-control-group-label')].map((node) => node.textContent)).toEqual(['India', 'Global'])
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true')
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    await settle()
    expect(document.activeElement?.textContent).toBe('CAC 40')
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(firstTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(firstTrigger)
    await act(async () => firstTrigger.click())
    const choose = async (label: string) => {
      await settle()
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === label)!
      await act(async () => { option.focus(); option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    }
    await choose('S&P 500')
    expect(state.setSettings.mock.lastCall![0].marketIndices).toEqual(['sp-500', 'nifty-50'])
    expect(firstTrigger.getAttribute('aria-expanded')).toBe('false')
    state.settings = state.setSettings.mock.lastCall![0]
    await render()
    await act(async () => triggers[1].click())
    await choose('S&P 500')
    expect(state.setSettings.mock.lastCall![0].marketIndices).toEqual(['nifty-50', 'sp-500'])
    state.settings = state.setSettings.mock.lastCall![0]
    await render()
    expect(firstTrigger.textContent).toBe('NIFTY 50')
    expect(triggers[1].textContent).toBe('S&P 500')
    await act(async () => firstTrigger.click())
    await settle()
    await act(async () => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); document.body.click() })
    expect(firstTrigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens marker help in the imported folio card and dismisses it with Escape or an outside click', async () => {
    const position: Position = { id: 'a', ticker: 'AAA', name: 'AAA', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110 }
    const folio: Folio = { id: 'f', name: 'Imported folio', importedAt: 1, positions: [position] }
    state.folios = [folio]
    state.positions = [position]
    await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    const card = container.querySelector<HTMLElement>('.imported-portfolio')!
    const help = card.querySelector<HTMLDetailsElement>('.import-data-help')!
    expect(card.querySelector('.import-source-files')).not.toBeNull()
    const pointer = new MouseEvent('pointerover', { bubbles: true })
    Object.defineProperty(pointer, 'pointerType', { value: 'mouse' })
    await act(async () => help.dispatchEvent(pointer))
    expect(help.open).toBe(true)
    help.open = false
    await act(async () => help.querySelector('summary')!.click())
    expect(help.open).toBe(true)
    expect([...help.querySelectorAll('.data-health-guide li strong')].map((label) => label.textContent)).toEqual(['Quoted', 'Older quotes', 'Partial quotes', 'Imported only', 'No prices'])
    expect(help.textContent).toContain('freshness unknown')
    await act(async () => help.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(help.open).toBe(false)
    expect(document.activeElement).toBe(help.querySelector('summary'))
    await act(async () => help.querySelector('summary')!.click())
    await act(async () => document.body.click())
    expect(help.open).toBe(false)
  })

  it('dismisses listing review outside its box without stealing focus or retaining its deep link', async () => {
    state.positions = [{ id: 'test', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120, exchangeSource: 'inferred' }]
    await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    const trigger = container.querySelector<HTMLButtonElement>('#listing-review-trigger')!
    await act(async () => trigger.click())
    window.history.replaceState({}, '', '/app/settings#instrument-review')
    await act(async () => container.querySelector<HTMLElement>('#instrument-review-content')!.click())
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const outside = container.querySelector<HTMLButtonElement>('.mode-toggle button')!
    outside.focus()
    await act(async () => outside.click())
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(outside)
    expect(window.location.hash).toBe('')
    await act(async () => trigger.click())
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('requests the shared portfolio import without changing Settings navigation', async () => {
    const onRequestImport = vi.fn()
    await act(async () => root.render(<SettingsView onRequestImport={onRequestImport} />))
    const trigger = [...container.querySelectorAll<HTMLButtonElement>('.manage-actions button')].find((button) => button.textContent === 'Import holdings')!
    await act(async () => trigger.click())
    expect(onRequestImport).toHaveBeenCalledOnce()
    expect(window.location.pathname).toBe('/app/settings')
    expect(container.querySelector('[aria-label="Settings categories"]')).toBeNull()
    expect(container.querySelector('.holdings-import')).toBeNull()
  })

  it('applies appearance changes immediately without duplicating the app privacy control', async () => {
    state.settings = { ...state.settings, mode: 'dark', hideValues: false }
    const render = () => act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    await render()
    const modeButtons = [...container.querySelectorAll<HTMLButtonElement>('.mode-toggle button')]
    expect(modeButtons.map((button) => button.textContent)).toEqual(['Dark', 'Default', 'Light'])
    const light = modeButtons.find((button) => button.textContent === 'Light')!
    await act(async () => light.click())
    expect(state.setSettings).toHaveBeenCalledWith({ ...state.settings, mode: 'light' })
    state.settings = state.setSettings.mock.lastCall![0]
    await render()
    expect(light.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('#hide-values')).toBeNull()
    expect(container.textContent).not.toContain('Hide portfolio values')
    expect(state.settings.hideValues).toBe(false)
  })

  it('opens listing review inline, provides a separate scroll region, and restores focus on close', async () => {
    state.positions = [{ id: 'test', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120, exchangeSource: 'inferred' }]
    const originalScroll = HTMLElement.prototype.scrollIntoView
    const scroll = vi.fn()
    HTMLElement.prototype.scrollIntoView = scroll
    try {
      await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
      const trigger = container.querySelector<HTMLButtonElement>('#listing-review-trigger')!
      expect(container.querySelector('#instrument-review')).toBeNull()
      trigger.focus()
      await act(async () => trigger.click())
      const panel = container.querySelector<HTMLElement>('.settings-page #instrument-review')!
      expect(panel).not.toBeNull()
      expect(panel.querySelector('[role="region"][aria-label="Instrument listings"]')?.getAttribute('tabindex')).toBe('0')
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(trigger.nextElementSibling?.contains(panel)).toBe(true)
      expect(document.activeElement).toBe(trigger)
      expect(scroll).not.toHaveBeenCalled()
      await act(async () => panel.querySelector<HTMLButtonElement>('[aria-label="Close listing review"]')!.click())
      expect(container.querySelector('#instrument-review')).toBeNull()
      expect(document.activeElement).toBe(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')

      await act(async () => root.unmount())
      root = createRoot(container)
      window.history.replaceState({}, '', '/app/settings#instrument-review')
      await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
      expect(container.querySelector('.settings-page #instrument-review')).not.toBeNull()
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close listing review"]')!.click())
      expect(window.location.hash).toBe('')
      await act(async () => container.querySelector<HTMLButtonElement>('#listing-review-trigger')!.click())
      state.positions = []
      await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
      expect(container.querySelector('#instrument-review')).toBeNull()
    } finally { HTMLElement.prototype.scrollIntoView = originalScroll }
  })

  it('describes data handling without exposing the retired market-data toggle', async () => {
    await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    expect(container.querySelector('[aria-label="Manage holdings"]')).not.toBeNull()
    expect([...container.querySelectorAll('.data-handling-card h4')].map((item) => item.textContent)).toEqual(['Portfolio & history', 'Market data'])
    expect(container.textContent).toContain('Stored only in this browser.')
    expect(state.settings.allowExternalData).toBe(true)
    expect(container.querySelector('#external-data')).toBeNull()
    expect([...container.querySelectorAll('[role="switch"]')].map((item) => item.getAttribute('aria-label'))).toEqual(['Keyboard focus outlines'])
    expect(container.querySelector('[aria-label="Data & privacy"]')).toBeNull()
    expect(state.setSettings).not.toHaveBeenCalled()
    expect(container.querySelector('.data-handling-card:last-child p')?.textContent).toBe('Quote providers see instrument identifiers only, never quantities or costs.')
  })

  it('keeps keyboard focus outlines on by default and saves the opt-out', async () => {
    const render = () => act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    await render()
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await act(async () => toggle.click())
    expect(state.setSettings).toHaveBeenLastCalledWith({ ...state.settings, focusRings: false })
    state.settings = state.setSettings.mock.lastCall![0]
    await render()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('keeps Preferences to one row per decision and reports saving only on failure', async () => {
    await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    expect([...container.querySelectorAll('.setting-row strong')].map((item) => item.textContent)).toEqual(['Appearance', 'Overview indices', 'Keyboard focus outlines'])
    expect(container.querySelectorAll('.setting-row--indices .settings-index-control')).toHaveLength(2)
    expect(container.querySelector('.settings-save-status')).toBeNull()
    expect(container.textContent).not.toContain('Saved automatically')

    state.settingsSaved = false
    await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    expect(container.querySelector('.settings-save-status')?.textContent).toBe('Preferences not saved')
  })
})
