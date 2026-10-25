// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { investmentWorkspace } from '../investmentWorkspace'
import { loadSettings } from '../store'
import type { Position, PortfolioSnapshot } from '../types'
import type { PortfolioBackcastHistory } from '../portfolioBackcast'
import type { useStore } from '../useStore'
import { quoteKey } from '../valuation'
import { InsightsView } from './InsightsView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore>, build: vi.fn(), benchmark: vi.fn(), chart: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('./HistoryPanel', () => ({ HistoryPanel: ({ scope }: { scope: string }) => <section data-history-scope={scope}>Holding Price History</section> }))
vi.mock('../portfolioBackcast', async (original) => ({ ...await original<typeof import('../portfolioBackcast')>(), buildPortfolioBackcast: state.build }))
vi.mock('../marketData', async (original) => ({ ...await original<typeof import('../marketData')>(), marketData: { benchmarkHistory: state.benchmark } }))
vi.mock('./InteractiveTrendChart', () => ({ InteractiveTrendChart: (props: ComponentProps<typeof import('./InteractiveTrendChart').InteractiveTrendChart>) => {
  state.chart(props)
  const { lines, onReachStart, rows } = props
  return <div data-chart={lines.map((line) => line.key).join(',')} data-latest-portfolio={rows[rows.length - 1]?.portfolio}>{onReachStart && <button type="button" onClick={onReachStart}>Earlier benchmark history</button>}</div>
} }))

let root: Root | undefined
let container: HTMLDivElement

async function renderInsights(backcast: PortfolioBackcastHistory['points'], history: PortfolioSnapshot[] = [], positions: Position[] = [{ id: 'a', ticker: 'AAA', name: 'AAA', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }]) {
  const folios = [{ id: 'test', name: 'Test', importedAt: 0, positions }]
  state.store = { snapshot: investmentWorkspace.readSnapshot({ folios, quotes: {}, history }), settings: { ...loadSettings(), allowExternalData: true } } as ReturnType<typeof useStore>
  state.build.mockResolvedValue({ points: backcast, coveredPositions: positions, holdingsIncluded: 1, holdingsTotal: 1 })
  state.benchmark.mockResolvedValue([{ date: '2026-01-01', close: 100 }, { date: '2026-03-01', close: 100 }])
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
}

const exposurePositions: Position[] = [
  { ticker: 'ALPHA', type: 'stock', sector: 'Technology' },
  { ticker: 'BETA', type: 'stock', sector: 'Technology' },
  { ticker: 'BANK', type: 'stock', sector: 'Financials' },
  { ticker: 'TECH-FUND', name: 'Technology Fund', type: 'mutual-fund', sector: 'Technology' },
  { ticker: 'BROAD-FUND', name: 'Broad Fund', type: 'mutual-fund', category: 'Equity - Large Cap Fund' },
  { ticker: 'DEBT-FUND', name: 'Debt Fund', type: 'mutual-fund', sector: 'Debt', category: 'Debt - Corporate Bond Fund' },
  { ticker: 'SERVICES', type: 'stock', sector: 'Technology Services' },
].map((position) => ({ id: position.ticker, name: position.ticker, quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100, ...position } as Position))

function exposureControl(label: string, selector: '.expo-row' | '.expo-seg' = '.expo-row') {
  const index = state.store.snapshot.sectors.findIndex((sector) => sector.label === label)
  const control = container.querySelectorAll<HTMLElement>(selector)[index]
  expect(control).toBeDefined()
  return control
}

function expectExposureMatches(symbols: string[] = []) {
  const tiles = [...container.querySelectorAll('.allocation-tile')]
  expect(tiles).toHaveLength(exposurePositions.length)
  for (const tile of tiles) {
    const matches = symbols.includes(tile.querySelector('strong')!.textContent!)
    expect(tile.classList.contains('allocation-tile--exposure-match')).toBe(matches)
    expect(tile.classList.contains('allocation-tile--exposure-muted')).toBe(symbols.length > 0 && !matches)
  }
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  vi.clearAllMocks()
})

it('shows holding price history for all holdings at the bottom below the insights grid', async () => {
  await renderInsights([])
  const history = container.querySelector('[data-history-scope="all"]')
  expect(history).not.toBeNull()
  expect(container.querySelector('.insights-page')?.lastElementChild).toBe(history)
  expect(history?.previousElementSibling?.classList.contains('insight-grid')).toBe(true)
})

it('rebases both comparison returns on the first shared date when the benchmark has a holiday', async () => {
  state.benchmark.mockResolvedValueOnce([{ date: '2026-09-08', close: 100 }, { date: '2026-09-09', close: 110 }])
  await renderInsights([100, 200, 220].map((value, index) => ({ at: Date.parse(`2026-09-0${7 + index}T00:00:00+05:30`), value, invested: 100 })))
  expect(container.querySelector('.insight-chart-metric--portfolio strong')?.textContent).toBe('+10.0%')
  expect(container.querySelector('.insight-chart-metric--benchmark strong')?.textContent).toBe('+10.0%')
  expect(container.querySelector('.insight-chart-metric--gap strong')?.textContent).toBe('+0.0 pts')
})

it('keeps the benchmark line continuous across a market holiday without inventing a close', async () => {
  state.benchmark.mockResolvedValueOnce([{ date: '2026-09-04', close: 100 }, { date: '2026-09-08', close: 110 }])
  await renderInsights(['04', '07', '08'].map((day, index) => ({ at: Date.parse(`2026-09-${day}T00:00:00+05:30`), value: 100 + index * 10, invested: 100 })))
  const props = state.chart.mock.lastCall![0] as ComponentProps<typeof import('./InteractiveTrendChart').InteractiveTrendChart>
  expect(props.rows[1].benchmark).toBeUndefined()

  const { InteractiveTrendChart } = await vi.importActual<typeof import('./InteractiveTrendChart')>('./InteractiveTrendChart')
  const chart = document.createElement('div')
  chart.innerHTML = renderToStaticMarkup(<InteractiveTrendChart {...props} />)
  const path = chart.querySelector('.interactive-trend-line[stroke="var(--chart-benchmark)"]')?.getAttribute('d')
  expect(path?.match(/M/g)).toHaveLength(1)
  expect(path?.match(/L/g)).toHaveLength(1)
})

it('keeps benchmark totals visible when portfolio history extends beyond the latest benchmark date', async () => {
  state.benchmark.mockResolvedValueOnce([{ date: '2026-09-28', close: 100 }, { date: '2026-09-29', close: 105 }])
  await renderInsights([200, 220, 240].map((value, index) => ({ at: Date.parse(`2026-09-${28 + index}T00:00:00+05:30`), value, invested: 100 })))
  expect(container.querySelector('[data-chart="portfolio,benchmark"]')).not.toBeNull()
  expect(container.querySelector('.insight-chart-metric--benchmark strong')?.textContent).toBe('+5.0%')
  expect(container.querySelector('.insight-chart-metric--portfolio strong')?.textContent).toBe('+10.0%')
  expect(container.querySelector('.insight-chart-metric--gap strong')?.textContent).toBe('+5.0 pts')
  expect(container.querySelector('.insight-chart-metric--portfolio small')?.textContent).toBe('Compared through 29 Sept 2026')
  expect(Number(container.querySelector('[data-chart="portfolio,benchmark"]')?.getAttribute('data-latest-portfolio'))).toBeCloseTo(20)
  expect(state.benchmark).toHaveBeenCalledTimes(1)
})

it('keeps benchmark totals unavailable when the series have no shared dates', async () => {
  state.benchmark.mockResolvedValueOnce([{ date: '2026-09-28', close: 100 }, { date: '2026-09-29', close: 105 }])
  await renderInsights([200, 220].map((value, index) => ({ at: Date.UTC(2026, 9, 1 + index), value, invested: 100 })))
  expect(container.querySelector('.insight-chart-metric--portfolio strong')?.textContent).toBe('+10.0%')
  expect(container.querySelector('.insight-chart-metric--benchmark strong')?.textContent).toBe('—')
  expect(container.querySelector('.insight-chart-metric--gap strong')?.textContent).toBe('—')
})

it('updates delayed and refreshed quote analytics in the same mounted view without refetching history', async () => {
  state.benchmark.mockResolvedValueOnce([{ date: '2026-09-28', close: 100 }, { date: '2026-09-29', close: 110 }])
  await renderInsights([200, 220].map((value, index) => ({ at: Date.parse(`2026-09-${28 + index}T00:00:00+05:30`), value, invested: 100 })))
  expect(container.querySelector('.insight-panel--performance')).toBeNull()
  expect(container.querySelector('.insight-chart-metric--benchmark strong')?.textContent).toBe('+10.0%')
  const position = state.store.snapshot.positions[0]
  state.store.snapshot = { ...state.store.snapshot, quotes: { [quoteKey(position)]: { price: 240, at: Date.parse('2026-09-30T15:30:00+05:30'), source: 'yahoo' } } }
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(container.querySelector('.insight-chart-metric--portfolio strong')?.textContent).toBe('+10.0%')
  expect(container.querySelector('.insight-chart-metric--benchmark strong')?.textContent).toBe('+10.0%')
  expect(container.querySelector('.insight-chart-metric--gap strong')?.textContent).toBe('+0.0 pts')
  state.store.snapshot = { ...state.store.snapshot, quotes: { [quoteKey(position)]: { price: 180, at: Date.parse('2026-10-01T15:30:00+05:30'), source: 'yahoo' } } }
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(container.querySelector('#drawdown-kpi strong')?.textContent).toBe('-18.2%')
  expect(state.build).toHaveBeenCalledTimes(1)
  expect(state.benchmark).toHaveBeenCalledTimes(1)
})

it('starts benchmark history while backcast is pending and cancels both when external data is disabled', async () => {
  state.build.mockImplementationOnce(() => new Promise<PortfolioBackcastHistory>(() => {}))
  await renderInsights([])
  expect(state.benchmark).toHaveBeenCalledTimes(1)
  const benchmarkSignal = state.benchmark.mock.calls[0][3] as AbortSignal
  const backcastSignal = state.build.mock.calls[0][3] as AbortSignal
  expect(benchmarkSignal.aborted).toBe(false)
  expect(backcastSignal.aborted).toBe(false)
  state.store.settings.allowExternalData = false
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(benchmarkSignal.aborted).toBe(true)
  expect(backcastSignal.aborted).toBe(true)
})

it('extends both portfolio and benchmark history when navigating to earlier dates', async () => {
  await renderInsights([100, 110].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: 100 })))
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Earlier benchmark history')!.click())
  expect(state.build.mock.calls.map((call) => call[2])).toEqual([366, 732])
  expect(state.benchmark).toHaveBeenCalledTimes(2)
  const [, from, to] = state.benchmark.mock.lastCall as [string, Date, Date]
  expect(to.getTime() - from.getTime()).toBe(732 * 24 * 60 * 60 * 1000)
})

it('does not turn an account addition into benchmark returns or risk', async () => {
  const history = [100, 200].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: value, pnl: 0, holdingCount: index + 1 }))
  await renderInsights([], history)
  expect(container.querySelector('[data-chart="portfolio,benchmark"]')).toBeNull()
  expect(container.querySelector('.insight-kpi[aria-controls="drawdown-detail"] strong')?.textContent).toBe('—')
  expect(container.textContent).toContain('Tracked balances include account changes and cash flows')
  expect(container.querySelector('[data-chart="value,invested"]')).toBeNull()
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
  await act(async () => container.querySelector<HTMLButtonElement>('#drawdown-kpi')!.click())
  expect(container.querySelector('#drawdown-detail [role="img"]')).not.toBeNull()
  expect(container.querySelector('#drawdown-detail')?.textContent).toContain('-50.0%')
})

it('keeps each detail directly after its card and switches or collapses the dropdowns', async () => {
  await renderInsights([100, 80].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: 100 })))
  const cards = [...container.querySelectorAll<HTMLButtonElement>('.insight-kpi')]
  expect(cards.map((card) => card.querySelector('.score-label')?.textContent)).toEqual([
    'Session move', 'Worst drawdown', 'Top five weight', 'Data health',
  ])
  for (const card of cards) {
    await act(async () => card.click())
    expect(card.getAttribute('aria-expanded')).toBe('true')
    const detail = container.querySelector(`#${card.getAttribute('aria-controls')}`)
    expect(card.nextElementSibling).toBe(detail)
    expect(detail?.parentElement).toBe(card.parentElement)
    expect(detail?.getAttribute('aria-labelledby')).toBe(card.id)
    expect(container.querySelectorAll('.insight-kpi-detail')).toHaveLength(1)
    expect(cards.filter((item) => item.getAttribute('aria-expanded') === 'true')).toHaveLength(1)
  }
  expect(container.querySelector('#data-health-detail')?.textContent).toContain('Older quotes')
  expect(container.querySelector('#data-health-detail')?.textContent).toContain('No prices')
  await act(async () => cards[3].click())
  expect(cards[3].getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelector('.insight-kpi-detail')).toBeNull()
})

it('hides exposure labels, counts and relative sizes while masked, then restores them', async () => {
  await renderInsights([])
  expect(container.querySelector('.expo-mix')).not.toBeNull()
  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  const panel = container.querySelector('.insight-panel--exposure')!
  expect(panel.querySelector('.expo-mix')).toBeNull()
  expect(panel.textContent).toContain('Values are hidden')
  state.store.settings.hideValues = false
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(panel.querySelector('.expo-mix')).not.toBeNull()
})

it('highlights exact sector members on row hover without changing the selected holding', async () => {
  await renderInsights([], [], exposurePositions)
  expectExposureMatches()
  const selected = container.querySelector<HTMLButtonElement>('.allocation-tile[aria-label^="BANK,"]')!
  await act(async () => selected.click())
  const detail = container.querySelector('.allocation-detail')!.textContent
  const technology = exposureControl('Technology')

  await act(async () => technology.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expectExposureMatches(['ALPHA', 'BETA', 'Technology Fund'])
  expect(selected.getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.allocation-detail')!.textContent).toBe(detail)

  await act(async () => technology.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
  expectExposureMatches()
  expect(selected.getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.allocation-detail')!.textContent).toBe(detail)
})

it('uses the workspace fund fallback sector when hovering a ribbon segment', async () => {
  await renderInsights([], [], exposurePositions)
  expect(state.store.snapshot.sectors.find((sector) => sector.label === 'Mutual fund')?.count).toBe(2)
  const funds = exposureControl('Mutual fund', '.expo-seg')

  await act(async () => funds.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expectExposureMatches(['Broad Fund', 'Debt Fund'])
  await act(async () => funds.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
  expectExposureMatches()
})

it('restores the focused sector after pointer leave and clears it on blur', async () => {
  await renderInsights([], [], exposurePositions)
  const technology = exposureControl('Technology')
  const financials = exposureControl('Financials')

  await act(async () => technology.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
  expectExposureMatches(['ALPHA', 'BETA', 'Technology Fund'])
  await act(async () => financials.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expectExposureMatches(['BANK'])
  await act(async () => financials.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
  expectExposureMatches(['ALPHA', 'BETA', 'Technology Fund'])
  await act(async () => technology.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expectExposureMatches()

  await act(async () => financials.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
  expectExposureMatches(['BANK'])
  await act(async () => financials.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expectExposureMatches()
})

it('clears hovered and focused exposure when values are masked', async () => {
  await renderInsights([], [], exposurePositions)
  await act(async () => exposureControl('Technology').dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
  await act(async () => exposureControl('Financials', '.expo-seg').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expectExposureMatches(['BANK'])

  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(container.querySelector('.expo-mix')).toBeNull()
  expect(container.querySelector('.allocation-map')).toBeNull()

  state.store.settings.hideValues = false
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expectExposureMatches()
  expect(container.querySelector('.expo-row.is-active, .expo-seg.is-active')).toBeNull()
})

it('hides the drawdown geometry and holding identities in all value dropdowns', async () => {
  await renderInsights([100, 80].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: 100 })))
  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  for (const id of ['session', 'drawdown', 'top-five']) {
    await act(async () => container.querySelector<HTMLButtonElement>(`#${id}-kpi`)!.click())
    const detail = container.querySelector(`#${id}-detail`)!
    expect(detail.textContent).toContain('Values are hidden')
    expect(detail.innerHTML).not.toMatch(/AAA|\b80\b|-20\.0%/)
    expect(detail.querySelector('svg, [style], .up, .down')).toBeNull()
  }
  expect(container.querySelector('#drawdown-kpi .down')).toBeNull()
})

it('explains unavailable drawdown without claiming completed requests are loading', async () => {
  await renderInsights([])
  await act(async () => container.querySelector<HTMLButtonElement>('#drawdown-kpi')!.click())
  const detail = container.querySelector('#drawdown-detail')!
  expect(detail.textContent).toContain('Historical prices are unavailable')
  expect(detail.textContent).not.toContain('loading')
  state.store.settings.allowExternalData = false
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(detail.textContent).toContain('Enable external market data in Settings')
})

it('clears the drawdown loading state when external data is switched off', async () => {
  state.build.mockImplementationOnce(() => new Promise<PortfolioBackcastHistory>(() => {}))
  await renderInsights([])
  await act(async () => container.querySelector<HTMLButtonElement>('#drawdown-kpi')!.click())
  expect(container.querySelector('#drawdown-detail')?.textContent).toContain('Historical prices are loading')
  state.store.settings.allowExternalData = false
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(container.querySelector('#drawdown-detail')?.textContent).toContain('Enable external market data in Settings')
  expect(container.querySelector('#drawdown-detail')?.textContent).not.toContain('loading')
})
