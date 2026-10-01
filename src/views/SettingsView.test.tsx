// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { loadSettings } from '../store'
import { SettingsView } from './SettingsView'

const state = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, setSettings: vi.fn(), folios: [], positions: [], removeFolio: vi.fn(), undoLastImport: vi.fn(), undoImportFolioId: null, exportPortfolio: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => state }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const DEFAULT_SETTINGS = loadSettings()

describe('provider settings', () => {
  it('clears the previous destination credential and resets its model when switching providers', async () => {
    state.settings = { ...DEFAULT_SETTINGS, provider: 'openai', apiKey: 'fictional-openai-key', model: 'old-model', baseUrl: 'https://old.example/v1', confirmRemoteOllama: true }
    state.setSettings.mockClear()
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<SettingsView />))
      expect(container.querySelector('.settings-detail > .settings-group')?.nextElementSibling?.getAttribute('aria-label')).toBe('Manage holdings')
      const ai = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('AI connection'))
      await act(async () => ai?.click())
      expect(container.querySelector('[aria-label="Manage holdings"]')).toBeNull()
      const provider = container.querySelector<HTMLSelectElement>('#provider')!
      await act(async () => {
        provider.value = 'anthropic'
        provider.dispatchEvent(new Event('change', { bubbles: true }))
      })
      expect(state.setSettings).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic', apiKey: '', model: 'claude-3-5-sonnet-latest', baseUrl: '', confirmRemoteOllama: false }))
      expect(container.textContent).toContain('https://api.openai.com')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
