// @vitest-environment jsdom
import { Activity, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { investmentWorkspace } from '../investmentWorkspace'
import type { PortfolioBackcastHistory } from '../portfolioBackcast'
import { loadSettings } from '../store'
import type { Position, PortfolioSnapshot } from '../types'
import type { useStore } from '../useStore'
import { quoteKey } from '../valuation'
import { PortfolioPerformance } from './PortfolioPerformance'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore>, build: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('../portfolioBackcast', async (original) => ({ ...await original<typeof import('../portfolioBackcast')>(), buildPortfolioBackcast: state.build }))
vi.mock('./InteractiveTrendChart', () => ({
  InteractiveTrendChart: ({ rows, onReachStart, axisFormatter }: { rows: { value: number }[]; onReachStart?: () => void; axisFormatter: (amount: number) => string }) => (
    <div data-chart="value,invested" data-latest={rows[rows.length - 1].value} data-axis={axisFormatter(rows[rows.length - 1].value)}>
      {onReachStart && <button type="button" onClick={onReachStart}>Earlier history</button>}
    </div>
  ),
}))

let root: Root | undefined
let container: HTMLDivElement
type Scope = 'all' | 'equity' | 'mutual'
const defaultPositions: Position[] = [{ id: 'a', ticker: 'AAA', name: 'AAA', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }]
const points = (values = [200, 220]) => values.map((value, index) => ({ at: Date.parse(`2026-09-${28 + index}T00:00:00+05:30`), value, invested: 100 }))

async function renderPerformance(backcast = points(), options: { positions?: Position[]; history?: PortfolioSnapshot[]; scope?: Scope; allowExternalData?: boolean } = {}) {
  const positions = options.positions ?? defaultPositions
  state.store = {
    snapshot: investmentWorkspace.readSnapshot({ folios: [{ id: 'test', name: 'Test', importedAt: 0, positions }], quotes: {}, history: options.history ?? [] }),
    settings: { ...loadSettings(), allowExternalData: options.allowExternalData ?? true },
  } as ReturnType<typeof useStore>
  state.build.mockResolvedValue({ points: backcast, coveredPositions: positions, holdingsIncluded: positions.length, holdingsTotal: positions.length })
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root!.render(<PortfolioPerformance scope={options.scope} />))
}

const rerender = async (scope?: Scope) => act(async () => root!.render(<PortfolioPerformance scope={scope} />))
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

it('reuses loaded history when returning to the page and refreshes it after five minutes', async () => {
  const now = vi.spyOn(Date, 'now')
  const startedAt = Date.now()
  now.mockReturnValue(startedAt)
  await renderPerformance()
  const show = (visible: boolean) => act(async () => root!.render(<Activity mode={visible ? 'visible' : 'hidden'}><PortfolioPerformance /></Activity>))
  await show(true)
  const initialCalls = state.build.mock.calls.length
  await show(false)
  await show(true)
  expect(state.build).toHaveBeenCalledTimes(initialCalls)
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('220')
  await show(false)
  now.mockReturnValue(startedAt + 5 * 60_000 + 1)
  await show(true)
  expect(state.build).toHaveBeenCalledTimes(initialCalls + 1)
})

it('keeps the chart and observation readout current without refetching history', async () => {
  await renderPerformance()
  const latestValue = () => container.querySelector('.insight-chart-metric--value strong')?.textContent
  expect(container.querySelector('.panel-title')?.textContent).toBe('Portfolio performance')
  expect(container.querySelector('section')?.classList.contains('panel')).toBe(false)
  expect(latestValue()).toBe('₹220.00')
  expect(container.querySelector('.insight-chart-metric--value small')?.textContent).toBe('Historical close · 29 Sept 2026 IST')
  expect(container.querySelector('.performance-method-note')).toBeNull()
  const position = state.store.snapshot.positions[0]
  state.store.snapshot = { ...state.store.snapshot, quotes: { [quoteKey(position)]: { price: 240, at: Date.parse('2026-09-30T15:30:00+05:30'), source: 'yahoo' } } }
  await rerender()
  expect(latestValue()).toBe('₹240.00')
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('240')
  expect(container.querySelector('.insight-chart-metric--value small')?.textContent).toBe('Provider observations · 30 Sept 2026 IST')
  state.store.snapshot = { ...state.store.snapshot, quotes: { [quoteKey(position)]: { price: 180, at: Date.parse('2026-10-01T15:30:00+05:30'), source: 'yahoo' } } }
  await rerender()
  expect(latestValue()).toBe('₹180.00')
  expect(state.build).toHaveBeenCalledTimes(1)
})

it('restores each loaded holding scope immediately without rebuilding its history', async () => {
  const fund: Position = { id: 'fund', ticker: 'FUND', name: 'Fund', type: 'mutual-fund', quantity: 1, buyPrice: 50, invested: 50, lastPrice: 60 }
  const positions = [...defaultPositions, fund]
  await renderPerformance(points([200, 220]), { positions })
  state.build.mockImplementation(async (selected: Position[]) => ({
    points: points(selected[0].type === 'mutual-fund' ? [50, 60] : [150, 160]),
    coveredPositions: selected, holdingsIncluded: selected.length, holdingsTotal: selected.length,
  }))
  await rerender('equity')
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('160')
  await rerender('mutual')
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('60')
  expect(state.build).toHaveBeenCalledTimes(3)
  state.build.mockImplementation(() => new Promise<PortfolioBackcastHistory>(() => {}))
  for (const [scope, expected] of [['all', '220'], ['equity', '160'], ['mutual', '60']] as const) {
    await rerender(scope)
    expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe(expected)
    expect(container.textContent).not.toContain('Building your historical series')
  }
  expect(state.build).toHaveBeenCalledTimes(3)
})

it('retains a loaded scope when visiting an empty holding type', async () => {
  await renderPerformance()
  await rerender('mutual')
  expect(container.textContent).toContain('No holdings in this view')
  await rerender('all')
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('220')
  expect(state.build).toHaveBeenCalledTimes(1)
})

it('keeps the matching cached chart visible while refreshing an expired scope', async () => {
  const startedAt = Date.now()
  const now = vi.spyOn(Date, 'now').mockReturnValue(startedAt)
  const fund: Position = { id: 'fund', ticker: 'FUND', name: 'Fund', type: 'mutual-fund', quantity: 1, buyPrice: 50, invested: 50, lastPrice: 60 }
  await renderPerformance(points(), { positions: [...defaultPositions, fund] })
  await rerender('mutual')
  now.mockReturnValue(startedAt + 5 * 60_000 + 1)
  let resolve!: (history: PortfolioBackcastHistory) => void
  state.build.mockImplementationOnce(() => new Promise<PortfolioBackcastHistory>((done) => { resolve = done }))
  await rerender('all')
  expect(state.build).toHaveBeenCalledTimes(3)
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('220')
  expect(container.textContent).not.toContain('Building your historical series')
  const positions = state.store.snapshot.positions
  await act(async () => resolve({ points: points([200, 250]), coveredPositions: positions, holdingsIncluded: 2, holdingsTotal: 2 }))
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('250')
})

it('rebuilds a cached scope after its holding quantity changes', async () => {
  await renderPerformance()
  const positions = state.store.snapshot.positions.map((position) => ({ ...position, quantity: 2 }))
  state.store.snapshot = { ...state.store.snapshot, positions }
  state.build.mockResolvedValueOnce({ points: points([400, 440]), coveredPositions: positions, holdingsIncluded: 1, holdingsTotal: 1 })
  await rerender()
  expect(state.build).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('440')
})

it('does not retain a cancelled scope result over the next completed request', async () => {
  let resolve!: (history: PortfolioBackcastHistory) => void
  state.build.mockImplementationOnce(() => new Promise<PortfolioBackcastHistory>((done) => { resolve = done }))
  await renderPerformance()
  const signal = state.build.mock.calls[0][3] as AbortSignal
  await rerender('mutual')
  expect(signal.aborted).toBe(true)
  await act(async () => resolve({ points: points([800, 900]), coveredPositions: defaultPositions, holdingsIncluded: 1, holdingsTotal: 1 }))
  await rerender('all')
  expect(state.build).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('220')
})

it('lets saved balances remain available offline with the cash-flow explanation', async () => {
  const history = [100, 200].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: value, pnl: 0, holdingCount: index + 1 }))
  await renderPerformance([], { history, allowExternalData: false })
  expect(state.build).not.toHaveBeenCalled()
  expect(container.textContent).toContain('External market data is off')
  await act(async () => button('Tracked').click())
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('200')
  expect(container.textContent).toContain('Balances include cash flows and account changes.')
  expect(button('Earlier history')).toBeUndefined()
})

it('discloses partial backcast coverage and hides it in tracked or private views', async () => {
  const positions = [...defaultPositions, { ...defaultPositions[0], id: 'b', ticker: 'BBB' }]
  const history = [100, 200].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: value, pnl: 0, holdingCount: 2 }))
  state.build.mockResolvedValueOnce({ points: points(), coveredPositions: positions.slice(0, 1), holdingsIncluded: 1, holdingsTotal: 2 })
  await renderPerformance(points(), { positions, history })
  expect(container.querySelector('.performance-coverage')?.textContent).toBe('History covers 1 of 2 holdings · 50% of priced INR value.')
  state.store.settings.hideValues = true
  await rerender()
  expect(container.querySelector('.performance-coverage')).toBeNull()
  state.store.settings.hideValues = false
  await act(async () => button('Tracked').click())
  expect(container.querySelector('.performance-coverage')).toBeNull()
})

it('filters backcast holdings by scope and keeps full-portfolio tracked balances out of a filtered view', async () => {
  const positions: Position[] = [...defaultPositions, { id: 'fund', ticker: 'FUND', name: 'Fund', type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }]
  const history = [100, 200].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: value, pnl: 0, holdingCount: 2 }))
  await renderPerformance(points(), { positions, history })
  await act(async () => button('Tracked').click())
  expect(button('Tracked').getAttribute('aria-pressed')).toBe('true')
  await rerender('mutual')
  expect(state.build.mock.lastCall?.[0].map((position: Position) => position.type)).toEqual(['mutual-fund'])
  expect(button('Tracked').disabled).toBe(true)
  expect(button('Tracked').title).toBe('Tracked balances cover all holdings')
  expect(button('Backcast').getAttribute('aria-pressed')).toBe('true')
  await rerender('equity')
  expect(state.build.mock.lastCall?.[0].map((position: Position) => position.ticker)).toEqual(['AAA'])
})

it('loads earlier history in yearly pages up to the existing three-year limit', async () => {
  await renderPerformance()
  await act(async () => button('Earlier history').click())
  await act(async () => button('Earlier history').click())
  await act(async () => button('Earlier history').click())
  expect(state.build.mock.calls.map((call) => call[2])).toEqual([366, 732, 1098])
})

it('cancels a pending history request when external data is disabled and clears loading', async () => {
  state.build.mockImplementationOnce(() => new Promise<PortfolioBackcastHistory>(() => {}))
  await renderPerformance([])
  const signal = state.build.mock.calls[0][3] as AbortSignal
  expect(container.textContent).toContain('Building your historical series')
  state.store.settings.allowExternalData = false
  await rerender()
  expect(signal.aborted).toBe(true)
  expect(container.textContent).toContain('External market data is off')
  expect(container.textContent).not.toContain('Building')
})

it('removes chart geometry, values and observation dates while masking is enabled', async () => {
  await renderPerformance()
  expect(container.querySelector('[data-chart]')).not.toBeNull()
  state.store.settings.hideValues = true
  await rerender()
  expect(container.textContent).toContain('Values are hidden')
  expect(container.querySelector('[data-chart], .insight-chart-readout, .up, .down')).toBeNull()
  expect(container.innerHTML).not.toMatch(/220|Sept|₹/)
  state.store.settings.hideValues = false
  await rerender()
  expect(container.querySelector('[data-chart]')).not.toBeNull()
  expect(state.build).toHaveBeenCalledTimes(1)
})

it('shows missing scoped holdings without fetching history or offering tracked balances', async () => {
  await renderPerformance([], { scope: 'mutual' })
  expect(state.build).not.toHaveBeenCalled()
  expect(container.textContent).toContain('No holdings in this view')
  expect(button('Tracked').disabled).toBe(true)
})

it('formats compact chart labels in INR', async () => {
  await renderPerformance(points([200000, 220000]))
  await rerender()
  expect(container.querySelector('[data-chart]')?.getAttribute('data-axis')).toBe('₹2.2L')
  expect(container.querySelector('.insight-chart-metric--value strong')?.textContent).toBe('₹2,20,000')
})
