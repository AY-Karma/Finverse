// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSettings } from '../store'
import { PRIVATE_VALUE_MASK } from '../privacy'
import type { Position, Settings } from '../types'
import { ResearchView } from './ResearchView'

const state = vi.hoisted(() => ({ positions: [] as Position[], liveQuotes: {}, fxRate: null, settings: {} as Settings, resolvePath: vi.fn(), history: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => state }))
vi.mock('../research', async (original) => ({ ...await original<typeof import('../research')>(), resolveScreenerCompanyPath: state.resolvePath }))
vi.mock('../marketData', () => ({ marketData: { history: state.history } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const position: Position = { id: 'one', ticker: 'TCS', name: 'Tata Consultancy Services', type: 'stock', quantity: 10, buyPrice: 100, invested: 1000, lastPrice: 120, exchange: 'NSE' }
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const onAssistant = vi.fn()

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/app/research')
  state.settings = { ...loadSettings(), allowExternalData: false }
  state.positions = [position]
  state.resolvePath.mockResolvedValue(null)
  state.history.mockResolvedValue([])
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); state.resolvePath.mockReset(); state.history.mockReset(); onAssistant.mockReset() })
async function render(active = true) { await act(async () => root.render(<ResearchView active={active} onOpenAssistant={onAssistant} onRequestImport={vi.fn()} />)) }
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === text)
  expect(button, text).toBeDefined()
  await act(async () => button!.click())
}

describe('research desk', () => {
  it('renders a bounded list and resolves only the selected company, cancelling abandoned requests', async () => {
    state.settings.allowExternalData = true
    state.positions = Array.from({ length: 5000 }, (_, index) => ({ ...position, id: String(index), ticker: `HOLD${index}`, name: `Holding ${String(index).padStart(4, '0')}` }))
    const signals: AbortSignal[] = []
    state.resolvePath.mockImplementation((_ticker: string, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    await render()
    expect(container.querySelectorAll('.rd-holding')).toHaveLength(24)
    expect(state.resolvePath).toHaveBeenCalledTimes(1)
    expect(state.history).not.toHaveBeenCalled()
    await click('Next')
    expect(signals[0].aborted).toBe(true)
    expect(state.resolvePath).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Page 2 of 209')
    state.settings.allowExternalData = false
    await render()
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(container.querySelector('img[src^="https:"]')).toBeNull()
    expect(container.querySelectorAll('.rd-holding')).toHaveLength(24)
  })

  it('keeps missing valuations unknown and withholds incomplete portfolio weights', async () => {
    state.positions = [position, { ...position, id: 'missing', ticker: 'MISSING', name: 'A missing price', lastPrice: null }]
    await render()
    expect(container.querySelector('.rd-metrics dd')?.textContent).toBe('Unpriced')
    expect(container.querySelectorAll('.rd-metrics dd')[1].textContent).toBe('Unavailable')
    expect(container.textContent).toContain('Portfolio weight needs complete prices in one currency')
    expect(state.resolvePath).not.toHaveBeenCalled()
    expect(state.history).not.toHaveBeenCalled()
  })

  it('removes the notebook and sends the starting action to Sources', async () => {
    const saved = '{"thesis":"Previously saved private research"}'
    localStorage.setItem('finverse:research:v1:existing', saved)
    await render()
    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(['Overview', 'Sources'])
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).not.toContain('Not reviewed yet')
    const start = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.startsWith('Start my research'))!
    await act(async () => start.click())
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Sources')
    expect(container.textContent).toContain('Read at the source')
    expect(localStorage.getItem('finverse:research:v1:existing')).toBe(saved)
    const icons = [...container.querySelectorAll('.rd-source-icon svg')]
    expect(icons).toHaveLength(3)
    expect(new Set(icons.map((icon) => icon.innerHTML)).size).toBe(3)
  })

  it('keeps portfolio amounts hidden when values are hidden', async () => {
    state.settings.hideValues = true
    await render()
    expect([...container.querySelectorAll('.rd-metrics dd')].every((metric) => metric.textContent === PRIVATE_VALUE_MASK)).toBe(true)
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('restores selection and section from browser navigation, including removed holdings', async () => {
    await render()
    await act(async () => {
      window.history.replaceState({}, '', '/app/research?holding=one&tab=notes')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Sources')
    await act(async () => {
      window.history.replaceState({}, '', '/app/research?holding=removed')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(container.textContent).toContain('Holding no longer available')
    await click('Return to holdings')
    expect(window.location.search).toBe('')
  })

  it('returns to the preceding holdings list instead of adding another dossier entry', async () => {
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('.rd-holding')!.click())
    expect(window.history.state.researchListUrl).toBe('/app/research')
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const push = vi.spyOn(window.history, 'pushState')
    await act(async () => container.querySelector<HTMLButtonElement>('.rd-back')!.click())
    expect(back).toHaveBeenCalledOnce()
    expect(push).not.toHaveBeenCalled()
  })

  it('supports keyboard navigation between dossier tabs', async () => {
    await render()
    await act(async () => container.querySelector('#rd-tab-overview')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(container.querySelector('#rd-tab-sources')?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement?.id).toBe('rd-tab-sources')
    expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Sources')
  })
})
