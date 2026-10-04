// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { investmentWorkspace } from '../investmentWorkspace'
import { loadSettings } from '../store'
import type { Position, PortfolioSnapshot } from '../types'
import type { PortfolioBackcast } from '../portfolioBackcast'
import type { useStore } from '../useStore'
import { InsightsView } from './InsightsView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore>, build: vi.fn(), benchmark: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('../portfolioBackcast', () => ({ buildPortfolioBackcast: state.build }))
vi.mock('../marketData', async (original) => ({ ...await original<typeof import('../marketData')>(), marketData: { benchmarkHistory: state.benchmark } }))
vi.mock('./InteractiveTrendChart', () => ({ InteractiveTrendChart: ({ lines }: { lines: { key: string }[] }) => <div data-chart={lines.map((line) => line.key).join(',')} /> }))

let root: Root | undefined
let container: HTMLDivElement

async function renderInsights(backcast: PortfolioBackcast['points'], history: PortfolioSnapshot[] = []) {
  const positions: Position[] = [{ id: 'a', ticker: 'AAA', name: 'AAA', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }]
  const folios = [{ id: 'test', name: 'Test', importedAt: 0, positions }]
  state.store = { snapshot: investmentWorkspace.readSnapshot({ folios, quotes: {}, fxRate: null, history }), settings: { ...loadSettings(), allowExternalData: true } } as ReturnType<typeof useStore>
  state.build.mockResolvedValue({ points: backcast, coveragePct: 100, holdingsIncluded: 1, holdingsTotal: 1 })
  state.benchmark.mockResolvedValue([{ date: '2026-01-01', close: 100 }, { date: '2026-03-01', close: 100 }])
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  vi.clearAllMocks()
})

it('does not turn an account addition into benchmark returns or risk', async () => {
  const history = [100, 200].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: value, pnl: 0, holdingCount: index + 1 }))
  await renderInsights([], history)
  expect(container.querySelector('[data-chart="portfolio,benchmark"]')).toBeNull()
  expect(container.querySelector('.insight-kpi[aria-controls="drawdown-detail"] strong')?.textContent).toBe('—')
  expect(container.textContent).toContain('Tracked balances include account changes and cash flows')
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Tracked')?.click())
  expect(container.querySelector('[data-chart="value,invested"]')).not.toBeNull()
  expect(container.textContent).toContain('Balance history, not investment returns')
  expect(container.textContent).not.toContain('Portfolio leads')
})

it('does not annualize sparse monthly observations as daily returns', async () => {
  await renderInsights([100, 80, 110].map((value, index) => ({ at: Date.UTC(2026, index, 1) - 5.5 * 3600000, value, invested: 100 })))
  const volatility = container.querySelectorAll('.risk-reading')[2]
  expect(volatility?.textContent).toContain('Unavailable')
  expect(volatility?.textContent).not.toMatch(/\d+\.\d+%/)
  expect(container.textContent).toContain('Daily closes are required')
  expect(container.querySelector('.insight-kpi[aria-controls="drawdown-detail"] strong')?.textContent).toBe('-20.0%')
})

it('shows the full-history trough even when chart rows are sampled', async () => {
  await renderInsights(Array.from({ length: 1000 }, (_, index) => ({ at: Date.UTC(2023, 0, 1 + index) - 5.5 * 3600000, value: index === 2 ? 50 : 100, invested: 100 })))
  expect(container.querySelector('.insight-kpi[aria-controls="drawdown-detail"] strong')?.textContent).toBe('-50.0%')
})
