// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSettings } from '../store'
import type { Position, Settings } from '../types'
import { SettingsView } from './SettingsView'

const state = vi.hoisted(() => ({ settings: {} as Settings, setSettings: vi.fn(), folios: [], positions: [] as Position[], removeFolio: vi.fn(), undoLastImport: vi.fn(), undoImportFolioId: null, exportPortfolio: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => state }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  window.history.replaceState({}, '', '/app/settings')
  state.positions = []
  state.settings = loadSettings()
  state.setSettings.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })

describe('workspace settings', () => {
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

  it('shows holdings, privacy, preferences, and data handling in one continuous page', async () => {
    await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    const page = container.querySelector('.settings-page')!
    expect([...page.children].map((item) => item.getAttribute('aria-label') || item.getAttribute('aria-labelledby'))).toEqual(['Manage holdings', 'Data & privacy', 'Preferences', 'data-handling-title'])
    expect(container.querySelector('.settings-nav, [role="tablist"]')).toBeNull()
    expect(container.querySelector('#currency')).toBeNull()
    expect(container.querySelector('[aria-label="Accent colour"], [aria-label="Hue"], .accent-popover')).toBeNull()
    expect(container.textContent).not.toContain('Accent colour')
    expect(container.querySelector('#density, [aria-label="Interface density"]')).toBeNull()
    expect(container.textContent).not.toContain('Interface density')
  })

  it('applies appearance and hidden-value changes immediately', async () => {
    state.settings = { ...state.settings, mode: 'dark', hideValues: false }
    const render = () => act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    await render()
    const light = [...container.querySelectorAll<HTMLButtonElement>('.mode-toggle button')].find((button) => button.textContent === 'Light')!
    await act(async () => light.click())
    expect(state.setSettings).toHaveBeenCalledWith({ ...state.settings, mode: 'light' })
    state.settings = state.setSettings.mock.lastCall![0]
    await render()
    expect(light.getAttribute('aria-pressed')).toBe('true')
    const hidden = container.querySelector<HTMLInputElement>('#hide-values')!
    await act(async () => hidden.click())
    expect(state.setSettings).toHaveBeenCalledWith({ ...state.settings, hideValues: true })
    state.settings = state.setSettings.mock.lastCall![0]
    await render()
    expect(hidden.checked).toBe(true)
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

  it('describes browser storage and keeps market access opt-in', async () => {
    state.settings = { ...state.settings, allowExternalData: false }
    await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    expect(container.querySelector('[aria-label="Manage holdings"]')).not.toBeNull()
    expect([...container.querySelectorAll('.data-handling-card h4')].map((item) => item.textContent)).toEqual(['Portfolio & history', 'Market data'])
    expect(container.textContent).toContain('Holdings and tracked history use local storage.')
    const externalData = container.querySelector<HTMLInputElement>('#external-data')!
    expect(externalData.getAttribute('role')).toBe('switch')
    expect(container.querySelector(`#${externalData.getAttribute('aria-describedby')}`)?.textContent).toContain('Allow quote')
    expect(externalData.closest('.setting-row')?.querySelector('.setting-toggle-status')?.textContent).toBe('Off')
    expect(container.querySelector('.data-handling-card:last-child .data-destination')?.textContent).toBe('Blocked')
    expect(externalData.checked).toBe(false)
    await act(async () => externalData.click())
    expect(state.setSettings).toHaveBeenCalledWith({ ...state.settings, allowExternalData: true })
    state.settings = state.setSettings.mock.lastCall![0]
    await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    expect(externalData.checked).toBe(true)
    expect(externalData.closest('.setting-row')?.querySelector('.setting-toggle-status')?.textContent).toBe('On')
    expect(container.querySelector('.data-handling-card:last-child .data-destination')?.textContent).toBe('Identifiers only')
  })
})
