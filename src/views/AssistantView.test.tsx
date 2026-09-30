// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSettings } from '../store'
import type { Settings } from '../types'
import { AssistantView } from './AssistantView'

const state = vi.hoisted(() => ({
  positions: [{ id: 'test', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }],
  settings: {} as Settings,
  liveQuotes: {}, fxRate: null, quickMode: false, setQuickMode: vi.fn(), chat: vi.fn(),
}))
vi.mock('../useStore', () => ({ useStore: () => state }))
vi.mock('../providers', async (importOriginal) => ({ ...await importOriginal<typeof import('../providers')>(), chat: state.chat }))
vi.mock('../ChatChart', () => ({ ChatChart: ({ spec }: { spec: unknown }) => <div data-chart>{JSON.stringify(spec)}</div> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const DEFAULT_SETTINGS = loadSettings()

afterEach(() => { localStorage.clear(); state.chat.mockReset() })

describe('assistant privacy and retention', () => {
  it('prefills a research question without sending it or including private notes', async () => {
    state.settings = { ...DEFAULT_SETTINGS }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<AssistantView initialDraft="Help me review TCS" onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector<HTMLInputElement>('input[aria-label="Message to AI provider"]')?.value).toBe('Help me review TCS')
      expect(container.textContent).toContain('Your current portfolio context is included')
      expect(state.chat).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()) }
  })
  it('removes saved text, charts and input from visible and accessible DOM until an explicit reveal', async () => {
    state.settings = { ...DEFAULT_SETTINGS, provider: 'openai', apiKey: 'fictional-key', hideValues: true }
    localStorage.setItem('finverse:chat', JSON.stringify([{ role: 'assistant', content: 'Balance 123456', charts: [{ kind: 'bar', data: [{ label: 'Secret', value: 98765 }] }] }]))
    const container = document.createElement('div')
    const root = createRoot(container)
    const render = () => root.render(<AssistantView onGoTo={vi.fn()} onRequestImport={vi.fn()} />)
    try {
      await act(async () => render())
      expect(container.innerHTML).not.toContain('123456')
      expect(container.innerHTML).not.toContain('98765')
      expect(container.querySelector('.chat-input input')).toBeNull()
      const reveal = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Reveal conversation')
      expect(reveal).toBeDefined()
      await act(async () => reveal?.click())
      expect(container.textContent).toContain('123456')
      expect(container.querySelector('[data-chart]')).not.toBeNull()
      const hide = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Hide conversation')
      await act(async () => hide?.click())
      expect(container.innerHTML).not.toContain('123456')
      expect(container.querySelector('[data-chart]')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it('trims before saving and reload keeps the newest turns', async () => {
    state.settings = { ...DEFAULT_SETTINGS }
    localStorage.setItem('finverse:chat', JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ role: 'assistant', content: `turn-${i}:` + 'x'.repeat(24_000) }))))
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<AssistantView onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      const saved = localStorage.getItem('finverse:chat')!
      expect(saved.length).toBeLessThan(200_000)
      expect(saved).toContain('turn-99:')
      expect(saved).not.toContain('turn-0:')
      expect(container.textContent).toContain('Older messages were omitted')
    } finally { await act(async () => root.unmount()) }
  })

  it('passes the market permission to explicitly submitted AI requests', async () => {
    state.settings = { ...DEFAULT_SETTINGS, provider: 'openai', apiKey: 'fictional-key', allowExternalData: false }
    state.chat.mockResolvedValue({ content: 'Reply', charts: [] })
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<AssistantView onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      const prompt = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Analyze my portfolio')
      await act(async () => prompt?.click())
      expect(state.chat).toHaveBeenCalledWith(expect.objectContaining({ allowExternalData: false }))
    } finally { await act(async () => root.unmount()) }
  })
})
