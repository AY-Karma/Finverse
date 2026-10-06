// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSettings } from '../store'
import type { Settings } from '../types'
import { SettingsView } from './SettingsView'

const state = vi.hoisted(() => ({ settings: {} as Settings, setSettings: vi.fn(), folios: [], positions: [], removeFolio: vi.fn(), undoLastImport: vi.fn(), undoImportFolioId: null, exportPortfolio: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => state }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  state.settings = loadSettings()
  state.setSettings.mockClear()
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(async () => { await act(async () => root.unmount()) })

describe('workspace settings', () => {
  it('keeps display preferences and holdings management together', async () => {
    await act(async () => root.render(<SettingsView />))
    expect([...container.querySelectorAll('.settings-nav-copy strong')].map((item) => item.textContent)).toEqual(['Preferences', 'Data & privacy'])
    expect(container.querySelector('.settings-detail > .settings-group')?.nextElementSibling?.getAttribute('aria-label')).toBe('Manage holdings')
    const currency = container.querySelector<HTMLSelectElement>('#currency')!
    await act(async () => {
      currency.value = 'USD'
      currency.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(state.setSettings).toHaveBeenCalledWith({ ...state.settings, currency: 'USD' })
  })

  it('describes browser storage and keeps market access opt-in', async () => {
    state.settings = { ...state.settings, allowExternalData: false }
    await act(async () => root.render(<SettingsView />))
    const privacy = [...container.querySelectorAll<HTMLButtonElement>('.settings-nav-item')].find((button) => button.textContent?.includes('Data & privacy'))!
    await act(async () => privacy.click())
    expect(container.querySelector('[aria-label="Manage holdings"]')).toBeNull()
    expect([...container.querySelectorAll('.data-handling-row strong')].map((item) => item.textContent)).toEqual(['Portfolio & history', 'Market data'])
    expect(container.textContent).toContain('Holdings and tracked history use local storage.')
    const externalData = container.querySelector<HTMLInputElement>('#external-data')!
    expect(externalData.checked).toBe(false)
    await act(async () => externalData.click())
    expect(state.setSettings).toHaveBeenCalledWith({ ...state.settings, allowExternalData: true })
  })
})
