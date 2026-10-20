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
    expect(container.querySelector('.settings-nav-item[aria-current="page"] strong')?.textContent).toBe('Preferences')
    expect(container.querySelector('.holdings-import')).toBeNull()
  })

  it('keeps display preferences and holdings management together', async () => {
    await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    expect([...container.querySelectorAll('.settings-nav-copy strong')].map((item) => item.textContent)).toEqual(['Preferences', 'Data & privacy'])
    expect(container.querySelector('.settings-preferences > .settings-group')?.nextElementSibling?.getAttribute('aria-label')).toBe('Manage holdings')
    const currency = container.querySelector<HTMLSelectElement>('#currency')!
    await act(async () => {
      currency.value = 'USD'
      currency.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(state.setSettings).toHaveBeenCalledWith({ ...state.settings, currency: 'USD' })
  })

  it('opens listing review beside preferences, provides a separate scroll region, and restores focus on close', async () => {
    state.positions = [{ id: 'test', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120, exchangeSource: 'inferred' }]
    const originalScroll = HTMLElement.prototype.scrollIntoView
    const scroll = vi.fn()
    HTMLElement.prototype.scrollIntoView = scroll
    try {
      await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
      const trigger = container.querySelector<HTMLButtonElement>('#listing-review-trigger')!
      expect(container.querySelector('#instrument-review')).toBeNull()
      await act(async () => trigger.click())
      const panel = container.querySelector<HTMLElement>('.settings-detail--review > #instrument-review')!
      expect(panel).not.toBeNull()
      expect(panel.querySelector('[role="region"][aria-label="Instrument listings"]')?.getAttribute('tabindex')).toBe('0')
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(panel)
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
      await act(async () => panel.querySelector<HTMLButtonElement>('[aria-label="Close listing review"]')!.click())
      expect(container.querySelector('#instrument-review')).toBeNull()
      expect(document.activeElement).toBe(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')

      await act(async () => root.unmount())
      root = createRoot(container)
      window.history.replaceState({}, '', '/app/settings#instrument-review')
      await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
      expect(container.querySelector('.settings-detail--review > #instrument-review')).not.toBeNull()
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close listing review"]')!.click())
      expect(window.location.hash).toBe('')
      await act(async () => container.querySelector<HTMLButtonElement>('#listing-review-trigger')!.click())
      state.positions = []
      await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
      expect(container.querySelector('.settings-detail--review')).toBeNull()
      expect(container.querySelector('#instrument-review')).toBeNull()
    } finally { HTMLElement.prototype.scrollIntoView = originalScroll }
  })

  it('describes browser storage and keeps market access opt-in', async () => {
    state.settings = { ...state.settings, allowExternalData: false }
    await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    const privacy = [...container.querySelectorAll<HTMLButtonElement>('.settings-nav-item')].find((button) => button.textContent?.includes('Data & privacy'))!
    await act(async () => privacy.click())
    expect(container.querySelector('[aria-label="Manage holdings"]')).toBeNull()
    expect([...container.querySelectorAll('.data-handling-card h4')].map((item) => item.textContent)).toEqual(['Portfolio & history', 'Market data'])
    expect(container.textContent).toContain('Holdings and tracked history use local storage.')
    const externalData = container.querySelector<HTMLInputElement>('#external-data')!
    expect(externalData.getAttribute('role')).toBe('switch')
    expect(container.querySelector(`#${externalData.getAttribute('aria-describedby')}`)?.textContent).toContain('Allow quote')
    expect(container.querySelector('.setting-toggle-status')?.textContent).toBe('Off')
    expect(container.querySelector('.data-handling-card:last-child .data-destination')?.textContent).toBe('Blocked')
    expect(externalData.checked).toBe(false)
    await act(async () => externalData.click())
    expect(state.setSettings).toHaveBeenCalledWith({ ...state.settings, allowExternalData: true })
    state.settings = state.setSettings.mock.lastCall![0]
    await act(async () => root.render(<SettingsView onRequestImport={vi.fn()} />))
    expect(externalData.checked).toBe(true)
    expect(container.querySelector('.setting-toggle-status')?.textContent).toBe('On')
    expect(container.querySelector('.data-handling-card:last-child .data-destination')?.textContent).toBe('Identifiers only')
  })
})
