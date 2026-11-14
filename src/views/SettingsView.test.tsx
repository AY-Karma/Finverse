// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSettings } from '../store'
import type { Folio, Position, Settings } from '../types'
import { SettingsView } from './SettingsView'

const state = vi.hoisted(() => ({ settings: {} as Settings, setSettings: vi.fn(), folios: [] as Folio[], positions: [] as Position[], removeFolio: vi.fn(), undoLastImport: vi.fn(), undoImportFolioId: null, exportPortfolio: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => state }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  window.history.replaceState({}, '', '/app/settings')
  state.folios = []
  state.positions = []
  state.settings = loadSettings()
  state.setSettings.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })

describe('workspace settings', () => {
  it('selects and swaps market index slots with benchmark-style keyboard and dismissal behavior', async () => {
    const render = () => act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    await render()
    const menus = [...container.querySelectorAll<HTMLDetailsElement>('.settings-index-menu')]
    expect(menus).toHaveLength(2)
    expect(menus[0].closest('[aria-label="Preferences"]')).not.toBeNull()
    expect([...menus[0].querySelectorAll('.benchmark-menu-group > span')].map((node) => node.textContent)).toEqual(['India', 'Global'])
    const firstTrigger = menus[0].querySelector('summary')!
    await act(async () => firstTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(menus[0].open).toBe(true)
    expect(document.activeElement).toBe(menus[0].querySelector('.is-selected'))
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(document.activeElement?.textContent).toBe('CAC 40')
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(menus[0].open).toBe(false)
    expect(document.activeElement).toBe(firstTrigger)
    await act(async () => firstTrigger.click())
    const choose = (menu: HTMLDetailsElement, label: string) => act(async () => [...menu.querySelectorAll<HTMLButtonElement>('.benchmark-menu-group button')].find((button) => button.querySelector('span')?.textContent === label)!.click())
    await choose(menus[0], 'S&P 500')
    expect(state.setSettings.mock.lastCall![0].marketIndices).toEqual(['sp-500', 'nifty-50'])
    expect(menus[0].open).toBe(false)
    state.settings = state.setSettings.mock.lastCall![0]
    await render()
    await act(async () => menus[1].querySelector('summary')!.click())
    await choose(menus[1], 'S&P 500')
    expect(state.setSettings.mock.lastCall![0].marketIndices).toEqual(['nifty-50', 'sp-500'])
    state.settings = state.setSettings.mock.lastCall![0]
    await render()
    expect(menus[0].querySelector('summary')?.textContent).toBe('NIFTY 50')
    expect(menus[1].querySelector('summary')?.textContent).toBe('S&P 500')
    await act(async () => menus[0].querySelector('summary')!.click())
    await act(async () => document.body.click())
    expect(menus[0].open).toBe(false)
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
    const light = [...container.querySelectorAll<HTMLButtonElement>('.mode-toggle button')].find((button) => button.textContent === 'Light')!
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
    expect(container.textContent).toContain('Holdings and tracked history use local storage.')
    expect(state.settings.allowExternalData).toBe(true)
    expect(container.querySelector('#external-data, [role="switch"]')).toBeNull()
    expect(container.querySelector('[aria-label="Data & privacy"]')).toBeNull()
    expect(state.setSettings).not.toHaveBeenCalled()
    expect(container.querySelector('.data-handling-card:last-child .data-destination')?.textContent).toBe('Identifiers only')
  })
})
