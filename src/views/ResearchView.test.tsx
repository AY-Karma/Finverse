// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSettings } from '../store'
import type { Position, Settings } from '../types'
import { ResearchView } from './ResearchView'

const state = vi.hoisted(() => ({ positions: [] as Position[], liveQuotes: {}, fxRate: null, settings: {} as Settings, resolvePath: vi.fn(), resolveIsin: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => state }))
vi.mock('../research', async (original) => ({ ...await original<typeof import('../research')>(), resolveScreenerCompanyPath: state.resolvePath }))
vi.mock('../logos', async (original) => ({ ...await original<typeof import('../logos')>(), resolveIsin: state.resolveIsin }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => { state.resolvePath.mockReset(); state.resolveIsin.mockReset() })

describe('research work limits', () => {
  it('renders one page, caps active lookups and aborts them when permission is revoked', async () => {
    state.settings = { ...loadSettings(), allowExternalData: true }
    state.positions = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), ticker: `HOLD${i}`, name: `Holding ${i}`, type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: i === 4999 ? null : 120 }))
    const signals: AbortSignal[] = []
    state.resolvePath.mockImplementation((_ticker: string, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    state.resolveIsin.mockResolvedValue(null)
    const container = document.createElement('div')
    const root = createRoot(container)
    const render = () => root.render(<ResearchView onOpenAssistant={vi.fn()} onRequestImport={vi.fn()} />)
    try {
      await act(async () => render())
      expect(container.querySelectorAll('.research-card')).toHaveLength(24)
      expect(state.resolvePath).toHaveBeenCalledTimes(4)
      expect(container.textContent).toContain('24 of 5000 shown')
      const next = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Next')!
      await act(async () => next.click())
      expect(signals.slice(0, 4).every((signal) => signal.aborted)).toBe(true)
      expect(state.resolvePath).toHaveBeenCalledTimes(8)
      expect(container.querySelectorAll('.research-card')).toHaveLength(24)
      expect(container.textContent).toContain('Page 2 of 209')
      state.settings = { ...state.settings, allowExternalData: false }
      await act(async () => render())
      expect(signals.every((signal) => signal.aborted)).toBe(true)
      expect(state.resolvePath).toHaveBeenCalledTimes(8)
      expect(container.querySelector('img[src^="https:"]')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it('labels missing market values as unpriced', async () => {
    state.settings = { ...loadSettings(), allowExternalData: false }
    state.positions = [{ id: 'missing', ticker: 'MISSING', name: 'Missing price', type: 'stock', quantity: 10, buyPrice: 100, invested: 1000, lastPrice: null }]
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ResearchView onOpenAssistant={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector('.research-value')?.textContent).toBe('Unpriced')
      expect(container.querySelector('.research-pnl')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })
})
