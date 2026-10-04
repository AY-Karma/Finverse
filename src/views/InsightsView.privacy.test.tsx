// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { investmentWorkspace } from '../investmentWorkspace'
import { loadSettings } from '../store'
import { InsightsView } from './InsightsView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { state } = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../useStore', () => ({ useStore: () => state }))
vi.mock('../portfolioBackcast', () => ({ buildPortfolioBackcast: async () => null }))

let root: Root
let container: HTMLDivElement

function panel(title: string): HTMLElement {
  const result = [...container.querySelectorAll<HTMLElement>('section')]
    .find((section) => section.querySelector('.panel-title')?.textContent === title)
  if (!result) throw new Error(`Missing panel: ${title}`)
  return result
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
})

describe('Insights privacy', () => {
  it('labels imported prices without claiming they are fresh or reporting a move today', async () => {
    state.settings = { ...loadSettings(), allowExternalData: false, hideValues: false }
    state.snapshot = investmentWorkspace.readSnapshot({
      folios: [{ id: 'f', name: 'Portfolio', importedAt: 1, positions: [
        { id: 'a', ticker: 'A', name: 'A', type: 'stock', quantity: 1, buyPrice: 100, lastPrice: 110, invested: 100 },
      ] }], quotes: {}, fxRate: null,
    })
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => { root.render(<InsightsView onRequestImport={() => {}} />) })
    const health = container.querySelectorAll('.insight-kpi')[3]
    expect(health.textContent).toContain('Imported only')
    expect(health.textContent).toContain('Freshness unknown')
    expect(container.textContent).not.toMatch(/Fresh(?!ness)|Today’s move|What moved today/)
  })

  it('dates older-session movers and reports partial coverage without a portfolio return', async () => {
    state.settings = { ...loadSettings(), allowExternalData: true, hideValues: false }
    state.snapshot = investmentWorkspace.readSnapshot({
      folios: [{ id: 'f', name: 'Portfolio', importedAt: 1, positions: ['A', 'B'].map((ticker) => (
        { id: ticker, ticker, name: ticker, type: 'stock' as const, quantity: 1, buyPrice: 100, lastPrice: 110, invested: 100 }
      )) }],
      quotes: { 'EQ:A': { price: 110, change: 10, changePct: 10, at: Date.parse('2026-10-01T10:00:00Z'), source: 'yahoo' } }, fxRate: null,
    })
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => { root.render(<InsightsView onRequestImport={() => {}} />) })
    const move = container.querySelector('.insight-kpi')!
    expect(move.textContent).toContain('01 Oct 2026')
    expect(move.textContent).toContain('1 of 2 holdings')
    expect(move.querySelector('strong')?.textContent).toBe('Unavailable')
    expect(move.textContent).not.toContain('10.00%')
    expect(panel('Latest price movers').textContent).toContain('01 Oct 2026')
    expect(panel('Latest price movers').querySelectorAll('.contribution-fill')).toHaveLength(1)
  })

  it('removes allocation and mover identities, colours, and proportions while masked', async () => {
    const settings = { ...loadSettings(), allowExternalData: true, hideValues: false }
    state.settings = settings
    state.snapshot = investmentWorkspace.readSnapshot({
      folios: [{ id: 'portfolio', name: 'Portfolio', importedAt: 1, positions: [
        { id: 'up', ticker: 'SECRETUP', name: 'SECRETUP', type: 'stock', quantity: 10, buyPrice: 100, lastPrice: 120, invested: 1000 },
        { id: 'down', ticker: 'SECRETDOWN', name: 'SECRETDOWN', type: 'stock', quantity: 2, buyPrice: 100, lastPrice: 80, invested: 200 },
      ] }],
      quotes: {
        'EQ:SECRETUP': { price: 120, change: 5, changePct: 4, at: Date.now(), source: 'yahoo' },
        'EQ:SECRETDOWN': { price: 80, change: -3, changePct: -4, at: Date.now(), source: 'yahoo' },
      },
      fxRate: null,
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => { root.render(<InsightsView onRequestImport={() => {}} />) })
    expect(panel('Allocation treemap').querySelectorAll('.allocation-tile')).toHaveLength(2)
    expect(panel('Latest price movers').querySelectorAll('.contribution-fill')).toHaveLength(2)
    await act(async () => {
      panel('Allocation treemap').querySelectorAll<HTMLButtonElement>('.allocation-tile')[1].click()
    })

    settings.hideValues = true
    await act(async () => { root.render(<InsightsView onRequestImport={() => {}} />) })
    for (const title of ['Allocation treemap', 'Latest price movers']) {
      const section = panel(title)
      expect(section.textContent).toContain('Values are hidden')
      expect(section.innerHTML).not.toMatch(/SECRETUP|SECRETDOWN|Tailwinds|Headwinds/)
      expect(section.querySelector('.allocation-tile, .allocation-detail, .contribution-row, .up, .down, [style]')).toBeNull()
    }
    await act(async () => {
      panel('Latest price movers').querySelectorAll<HTMLButtonElement>('.segmented-control button')[1].click()
    })
    expect(panel('Latest price movers').querySelector('.contribution-fill')).toBeNull()

    settings.hideValues = false
    await act(async () => { root.render(<InsightsView onRequestImport={() => {}} />) })
    expect(panel('Allocation treemap').querySelectorAll('.allocation-tile')).toHaveLength(2)
    expect(panel('Allocation treemap').textContent).toContain('SECRETUP')
    expect(panel('Allocation treemap').querySelector('.allocation-detail strong')?.textContent).toBe('SECRETDOWN')
    expect(panel('Latest price movers').querySelectorAll('.contribution-fill')).toHaveLength(2)
    expect(panel('Latest price movers').textContent).toContain('SECRETDOWN')
    expect(panel('Latest price movers').querySelector('.is-active')?.textContent).toContain('%')
  })
})
