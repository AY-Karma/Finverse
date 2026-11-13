// @vitest-environment jsdom
import { Activity, act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { investmentWorkspace } from '../investmentWorkspace'
import { loadSettings } from '../store'
import type { Position, PortfolioSnapshot } from '../types'
import type { PortfolioBackcastHistory } from '../portfolioBackcast'
import type { useStore } from '../useStore'
import { quoteKey } from '../valuation'
import { InsightsView } from './InsightsView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore>, build: vi.fn(), benchmark: vi.fn(), chart: vi.fn(), classification: vi.fn(), history: vi.fn() }))
vi.mock('../marketCapReference', () => ({ loadMarketCapReference: state.classification, getCachedMarketCapReference: () => null }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('../portfolioBackcast', async (original) => ({ ...await original<typeof import('../portfolioBackcast')>(), buildPortfolioBackcast: state.build }))
vi.mock('../marketData', async (original) => ({ ...await original<typeof import('../marketData')>(), marketData: { benchmarkHistory: state.benchmark, history: state.history } }))
vi.mock('./InteractiveTrendChart', () => ({ InteractiveTrendChart: (props: ComponentProps<typeof import('./InteractiveTrendChart').InteractiveTrendChart>) => {
  state.chart(props)
  const { lines, onReachStart, rows } = props
  return <div data-chart={lines.map((line) => line.key).join(',')} data-latest-portfolio={rows[rows.length - 1]?.portfolio}>{onReachStart && <button type="button" onClick={onReachStart}>Earlier benchmark history</button>}</div>
} }))

let root: Root | undefined
let container: HTMLDivElement

beforeEach(() => {
  state.classification.mockResolvedValue({ records: [] })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

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
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

it('keeps the session detail interactive and dismisses it outside', async () => {
  await renderInsights([
    { at: Date.UTC(2026, 0, 1), value: 100, invested: 100 },
    { at: Date.UTC(2026, 2, 1), value: 115, invested: 100 },
  ])
  document.body.append(container)
  try {
    const trigger = container.querySelector<HTMLButtonElement>('#session-kpi')!
    await act(async () => trigger.click())
    const detail = container.querySelector<HTMLElement>('#session-detail')!
    expect(detail).not.toBeNull()
    await act(async () => detail.click())
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await act(async () => document.body.click())
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.insights-summary-detail')).toBeNull()
    await act(async () => trigger.click())
    await act(async () => trigger.click())
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  } finally { container.remove() }
})

it('removes comparison geometry and readouts while masked and restores loaded results without refetching', async () => {
  await renderInsights([
    { at: Date.UTC(2026, 0, 1), value: 100, invested: 100 },
    { at: Date.UTC(2026, 2, 1), value: 115, invested: 100 },
  ])
  expect(container.querySelector('[data-chart="portfolio,benchmark"]')).not.toBeNull()
  const requests = { backcast: state.build.mock.calls.length, benchmark: state.benchmark.mock.calls.length }
  state.store = { ...state.store, settings: { ...state.store.settings, hideValues: true } }
  state.chart.mockClear()
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  const comparison = container.querySelector('.performance-comparison')!
  expect(comparison.querySelector('[data-chart], .insight-chart-readout')).toBeNull()
  expect(comparison.textContent).toContain('Values are hidden')
  expect(state.chart).not.toHaveBeenCalled()
  state.store = { ...state.store, settings: { ...state.store.settings, hideValues: false } }
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(container.querySelector('[data-chart="portfolio,benchmark"]')).not.toBeNull()
  expect(state.build).toHaveBeenCalledTimes(requests.backcast)
  expect(state.benchmark).toHaveBeenCalledTimes(requests.benchmark)
})

it('keeps the last applied custom contribution results through incomplete dates and revisiting Insights', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-04T18:00:00+05:30'))
  state.history.mockResolvedValue([{ date: '2026-09-30', close: 100 }, { date: '2026-11-04', close: 110 }])
  await renderInsights([])
  const show = (visible: boolean) => act(async () => root!.render(<Activity mode={visible ? 'visible' : 'hidden'}><InsightsView onRequestImport={vi.fn()} /></Activity>))
  await show(true)
  const period = container.querySelector<HTMLSelectElement>('[aria-label="Return contribution period"]')!
  await act(async () => { period.value = 'custom'; period.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(state.history).not.toHaveBeenCalled()
  const input = container.querySelector<HTMLInputElement>('[aria-label="Contribution start date"]')!
  const setDate = (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await setDate('2026-10-01')
  expect(container.querySelector('.holding-move-summary > strong')?.textContent).toBe('₹10.00')
  expect(state.history).toHaveBeenCalledOnce()
  await setDate('')
  await setDate('2026-12-31')
  expect(container.querySelector('.holding-move-summary > strong')?.textContent).toBe('₹10.00')
  expect(state.history).toHaveBeenCalledOnce()
  await show(false)
  await show(true)
  expect(container.querySelector('.holding-move-summary > strong')?.textContent).toBe('₹10.00')
  expect(container.querySelector<HTMLSelectElement>('[aria-label="Return contribution period"]')?.value).toBe('custom')
  expect(state.history).toHaveBeenCalledOnce()
})

it('opens import from the empty insights landing without fetching market data', async () => {
  const onRequestImport = vi.fn()
  await renderInsights([], [], [])
  await act(async () => root!.render(<InsightsView onRequestImport={onRequestImport} />))
  const welcome = container.querySelector('.portfolio-welcome')!
  expect(welcome.querySelector('h1')?.textContent).toBe('Your investments.A closer look.')
  expect(welcome.querySelector('.portfolio-welcome-index, .portfolio-welcome-features')).toBeNull()
  const importButton = welcome.querySelector<HTMLButtonElement>('button')!
  expect(importButton.textContent).toBe('Import portfolio')
  await act(async () => importButton.click())
  expect(onRequestImport).toHaveBeenCalledOnce()
  expect(state.build).not.toHaveBeenCalled()
  expect(state.benchmark).not.toHaveBeenCalled()
})

it('loads market cap before selection and retains the request and results across exposure switches', async () => {
  let resolve!: (value: unknown) => void
  state.classification.mockReturnValue(new Promise((done) => { resolve = done }))
  const isin = 'INE002A01018'
  await renderInsights([], [], [{ id: 'stock', ticker: 'STOCK', name: 'Stock', isin, type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }])
  const control = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('.exposure-mode button')].find((button) => button.textContent === label)!
  expect(control('Sectors').getAttribute('aria-pressed')).toBe('true')
  expect(state.classification).toHaveBeenCalledOnce()
  const signal = state.classification.mock.calls[0][0] as AbortSignal
  await act(async () => control('Market cap').click())
  await act(async () => control('Sectors').click())
  expect(signal.aborted).toBe(false)
  await act(async () => resolve({ records: [{ isin, band: 'large', asOf: '2026-06-30', name: 'Stock', weight: 100, parentIsin: '', source: '' }] }))
  act(() => control('Market cap').click())
  expect(container.querySelector('.market-cap-band--large')?.textContent).toContain('100.0%')
  expect(container.querySelector('.market-cap-band--unclassified')).toBeNull()
  expect(container.querySelector('.market-cap-exposure [role="status"]')).toBeNull()
  expect(state.classification).toHaveBeenCalledOnce()
  await act(async () => (container.querySelector('.market-cap-band--large') as HTMLButtonElement).click())
  expect(container.querySelector('.allocation-tile--exposure-match')).not.toBeNull()
  await act(async () => control('Sectors').click())
  expect(container.querySelector('.allocation-tile--exposure-match')).toBeNull()
})

it('keeps session totals and contributors on stocks and ETFs until same-session NAVs publish', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-30T18:00:00+05:30'))
  const positions: Position[] = [
    { id: 'stock', ticker: 'STOCK', name: 'Stock', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 },
    { id: 'etf', ticker: 'ETF', name: 'ETF', type: 'etf', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110 },
    { id: 'fund', ticker: 'Fund Direct Growth', name: 'Fund Direct Growth', type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 150, mfScheme: { code: 990, name: 'Fund Direct Growth', source: 'confirmed' } },
  ]
  await renderInsights([], [], positions)
  const folios = [{ id: 'session', name: 'Mixed', importedAt: 1, positions }]
  const quotes = {
    [quoteKey(positions[0])]: { price: 120, change: 10, at: Date.parse('2026-10-30T12:00:00+05:30'), source: 'yahoo' as const },
    [quoteKey(positions[1])]: { price: 110, change: -3, at: Date.parse('2026-10-30T12:00:00+05:30'), source: 'yahoo' as const },
    [quoteKey(positions[2])]: { price: 150, change: 2, at: Date.parse('2026-10-29T00:00:00+05:30'), source: 'nav' as const },
  }
  state.store.snapshot = investmentWorkspace.readSnapshot({ folios, quotes })
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  const card = container.querySelector<HTMLButtonElement>('#session-kpi')!
  expect(card.querySelector('strong')?.textContent).toBe('+₹7.00')
  expect(container.querySelector('.insights-summary-context')?.textContent).toContain('2 of 2 stocks + ETFs')
  await act(async () => card.click())
  expect(container.querySelectorAll('.session-contributors-row')).toHaveLength(2)
  expect(container.querySelector('.session-contributors-total')).toBeNull()
  expect(container.querySelector('.session-contributors-note')).toBeNull()
  const published = { ...quotes, [quoteKey(positions[2])]: { ...quotes[quoteKey(positions[2])], at: Date.parse('2026-10-30T00:00:00+05:30') } }
  state.store.snapshot = investmentWorkspace.readSnapshot({ folios, quotes: published })
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(card.querySelector('strong')?.textContent).toBe('+₹9.00')
  expect(container.querySelector('.insights-summary-context')?.textContent).toContain('3 of 3 session holdings')
  expect(container.querySelectorAll('.session-contributors-row')).toHaveLength(3)
  expect(container.querySelector('.session-contributors-total')).toBeNull()
  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(card.querySelector('strong')?.textContent).toBe('••••••')
  expect(card.querySelector('.hint')?.textContent).toBe('Values hidden')
  expect(container.querySelector('.insights-summary-context')?.textContent).not.toMatch(/3 of 3|session holdings/)
  expect(container.querySelector('.session-contributors')).toBeNull()
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
  expect(state.build).toHaveBeenCalledTimes(1)
  expect(state.benchmark).toHaveBeenCalledTimes(1)
})

it('keeps the benchmark and backcast ready when revisiting the page', async () => {
  await renderInsights([100, 110].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: 100 })))
  const show = (visible: boolean) => act(async () => root!.render(<Activity mode={visible ? 'visible' : 'hidden'}><InsightsView onRequestImport={vi.fn()} /></Activity>))
  await show(true)
  const benchmarkCalls = state.benchmark.mock.calls.length
  const backcastCalls = state.build.mock.calls.length
  await show(false)
  await show(true)
  expect(state.benchmark).toHaveBeenCalledTimes(benchmarkCalls)
  expect(state.build).toHaveBeenCalledTimes(backcastCalls)
  expect(container.querySelector('[data-chart="portfolio,benchmark"]')).not.toBeNull()
})

it('restores a cached benchmark when switching back before another benchmark finishes', async () => {
  await renderInsights([100, 110].map((value, index) => ({ at: Date.UTC(2026, index * 2, 1), value, invested: 100 })))
  const select = async (label: string) => act(async () => {
    const button = [...container.querySelectorAll<HTMLButtonElement>('.benchmark-menu button')].find((item) => item.querySelector('span')?.textContent === label)!
    button.click()
  })
  state.benchmark.mockImplementationOnce(() => new Promise(() => {}))
  await select('NIFTY Next 50')
  await select('NIFTY 50')
  expect(state.benchmark).toHaveBeenCalledTimes(2)
  expect(container.querySelector('.insight-chart-metric--benchmark strong')?.textContent).toBe('+0.0%')
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

it('does not turn an account addition into benchmark returns', async () => {
  const history = [100, 200].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: value, pnl: 0, holdingCount: index + 1 }))
  await renderInsights([], history)
  expect(container.querySelector('[data-chart="portfolio,benchmark"]')).toBeNull()
  expect(container.textContent).toContain('Tracked balances include account changes and cash flows')
  expect(container.querySelector('[data-chart="value,invested"]')).toBeNull()
  expect(container.textContent).not.toContain('Portfolio leads')
})

it('shows portfolio amounts and session availability', async () => {
  await renderInsights([])
  const summary = container.querySelector('.insights-portfolio-summary')!
  expect(summary.querySelector('.insights-summary-current strong')?.textContent).toBe('₹100.00')
  expect(summary.querySelector('.insights-summary-invested strong')?.textContent).toBe('₹100.00')
  expect(summary.querySelector('.insights-summary-pnl strong')?.textContent).toBe('+₹0.00')
  expect(summary.querySelector('#session-kpi strong')?.textContent).toBe('Unavailable')
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

it('shows sector totals while highlighted and restores the selected holding on pointer leave', async () => {
  await renderInsights([], [], exposurePositions)
  expectExposureMatches()
  const selected = container.querySelector<HTMLButtonElement>('.allocation-tile[aria-label^="BANK "]')!
  await act(async () => selected.click())
  const detail = container.querySelector('.allocation-detail')!.textContent
  const technology = exposureControl('Technology')

  await act(async () => technology.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expectExposureMatches(['ALPHA', 'BETA', 'Technology Fund'])
  expect(selected.getAttribute('aria-pressed')).toBe('true')
  expect([...container.querySelectorAll('.allocation-detail strong')].map((value) => value.textContent)).toEqual(['Technology', '42.9%', '₹300.00', '₹0.00'])
  expect(container.querySelector('.allocation-detail .score-label')?.textContent).toBe('Selected group')

  await act(async () => technology.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
  expectExposureMatches()
  expect(selected.getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.allocation-detail')!.textContent).toBe(detail)
})

it('shows combined fund-group values instead of the last hovered holding and clears them when switching views', async () => {
  await renderInsights([], [], [
    { id: 'stock', ticker: 'STOCK', name: 'Stock', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 50 },
    { id: 'fund', ticker: 'FUND', name: 'Fund', type: 'mutual-fund', quantity: 2, buyPrice: 100, invested: 200, lastPrice: 100 },
    { id: 'etf', ticker: 'ETF', name: 'ETF', type: 'etf', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 150 },
  ])
  const stock = container.querySelector<HTMLButtonElement>('.allocation-tile[aria-label^="STOCK "]')!
  await act(async () => stock.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  const detail = container.querySelector('.allocation-detail')!.textContent
  const mode = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('.exposure-mode button')].find((button) => button.textContent === label)!
  await act(async () => mode('Market cap').click())
  await act(async () => (container.querySelector('.market-cap-band--funds') as HTMLButtonElement).click())
  expect([...container.querySelectorAll('.allocation-detail strong')].map((value) => value.textContent)).toEqual(['ETF + Mutual Funds', '87.5%', '₹350.00', '₹50.00'])
  expect(container.querySelector('.allocation-detail .score-label')?.textContent).toBe('Selected group')
  expect(container.querySelector('.allocation-detail .up')?.textContent).toBe('₹50.00')
  await act(async () => stock.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expect(container.querySelector('.allocation-detail strong')?.textContent).toBe('ETF + Mutual Funds')
  await act(async () => mode('Sectors').click())
  expect(container.querySelector('.allocation-detail')!.textContent).toBe(detail)
})

it('keeps same-label holdings separate in market-cap totals and individual selection', async () => {
  const source = 'https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx'
  const isins = ['INE002A01018', 'INE467B01029']
  state.classification.mockResolvedValue({ records: isins.map((isin, index) => ({ isin, band: index === 0 ? 'large' : 'small', asOf: '2026-06-30', name: 'ALPHA', weight: 100, parentIsin: '', source })) })
  await renderInsights([], [], [
    { id: 'large', ticker: 'ALPHA', name: 'Large company', type: 'stock', isin: isins[0], exchange: 'NSE', currency: 'INR', quantity: 1, buyPrice: 90, invested: 90, lastPrice: 100 },
    { id: 'small', ticker: 'ALPHA', name: 'Small company', type: 'stock', isin: isins[1], exchange: 'BSE', currency: 'INR', quantity: 1, buyPrice: 70, invested: 70, lastPrice: 60 },
  ])
  const tiles = [...container.querySelectorAll<HTMLButtonElement>('.allocation-tile')]
  const mode = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('.exposure-mode button')].find((button) => button.textContent === label)!
  await act(async () => mode('Market cap').click())
  await act(async () => (container.querySelector('.market-cap-band--large') as HTMLButtonElement).click())
  expect([...container.querySelectorAll('.allocation-detail strong')].map((value) => value.textContent)).toEqual(['Large cap', '62.5%', '₹100.00', '₹10.00'])
  expect(tiles.map((tile) => tile.classList.contains('allocation-tile--exposure-match'))).toEqual([true, false])
  await act(async () => (container.querySelector('.market-cap-band--small') as HTMLButtonElement).click())
  expect([...container.querySelectorAll('.allocation-detail strong')].map((value) => value.textContent)).toEqual(['Small cap', '37.5%', '₹60.00', '−₹10.00'])
  expect(tiles.map((tile) => tile.classList.contains('allocation-tile--exposure-match'))).toEqual([false, true])
  await act(async () => mode('Sectors').click())
  await act(async () => tiles[1].click())
  expect(tiles.map((tile) => tile.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  expect([...container.querySelectorAll('.allocation-detail strong')].map((value) => value.textContent)).toEqual(['ALPHA', '37.5%', '₹60.00', '−₹10.00'])
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

  await act(async () => technology.click())
  expectExposureMatches(['ALPHA', 'BETA', 'Technology Fund'])
  await act(async () => technology.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
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

it('masks the moved summary and contributor detail', async () => {
  await renderInsights([100, 80].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: 100 })))
  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(container.querySelector('.insights-summary-current strong')?.textContent).toBe('••••••')
  expect(container.querySelector('.insights-summary-invested strong')?.textContent).toBe('••••••')
  expect(container.querySelector('.insights-summary-pnl strong')?.textContent).toBe('••••••')
  expect(container.querySelector('.insights-summary-pnl .up, .insights-summary-pnl .down')).toBeNull()
  const session = container.querySelector<HTMLButtonElement>('#session-kpi')!
  expect(session.querySelector('strong')?.textContent).toBe('••••••')
  await act(async () => session.click())
  expect(container.querySelector('#session-detail')?.textContent).toContain('Values are hidden')
  expect(container.querySelector('#session-detail')?.innerHTML).not.toMatch(/AAA|\b80\b|-20\.0%/)
  expect(container.querySelector('#session-detail .up, #session-detail .down')).toBeNull()
})

it('keeps comparison copy in loading state while benchmark prices are still pending', async () => {
  state.benchmark.mockImplementationOnce(() => new Promise(() => {}))
  await renderInsights([])
  const comparison = container.querySelector('.performance-comparison')!
  expect(comparison.textContent).toContain('Building your comparison')
  expect(comparison.textContent).not.toContain('Historical comparison unavailable')
  expect(comparison.querySelector('.insight-chart-footnote')?.textContent).toContain('Building the historical comparison')
})

it('does not describe completed unavailable comparison history as reconstruction in progress', async () => {
  await renderInsights([])
  const comparison = container.querySelector('.performance-comparison')!
  expect(comparison.textContent).toContain('Historical comparison unavailable')
  expect(comparison.textContent).not.toContain('is reconstructing')
})

it('retries missing portfolio history without fetching the already loaded benchmark again', async () => {
  await renderInsights([])
  const benchmarkCalls = state.benchmark.mock.calls.length
  state.build.mockResolvedValue({
    points: [
      { at: Date.UTC(2026, 0, 1), value: 100, invested: 100 },
      { at: Date.UTC(2026, 2, 1), value: 110, invested: 100 },
    ],
    coveredPositions: state.store.snapshot.positions,
    holdingsIncluded: 1, holdingsTotal: 1,
  })
  await act(async () => container.querySelector<HTMLButtonElement>('.benchmark-retry')!.click())
  expect(container.querySelector('[data-chart="portfolio,benchmark"]')).not.toBeNull()
  expect(state.benchmark).toHaveBeenCalledTimes(benchmarkCalls)
})

it('pages allocation holdings in groups of 25 without changing portfolio weights or group exposure', async () => {
  const positions: Position[] = Array.from({ length: 53 }, (_, index) => ({
    id: `holding-${index}`, ticker: `HOLDING${index + 1}`, name: `Holding ${index + 1}`, type: 'stock',
    quantity: 1, buyPrice: 100, invested: 100, lastPrice: 200 - index, sector: index % 2 ? 'Financials' : 'Technology',
  }))
  await renderInsights([], [], positions)
  const tiles = () => [...container.querySelectorAll<HTMLButtonElement>('.allocation-tile')]
  const pager = () => container.querySelector<HTMLElement>('[aria-label="Allocation treemap pages"]')!
  const next = () => container.querySelector<HTMLButtonElement>('[aria-label="Next allocation page"]')!
  const previous = () => container.querySelector<HTMLButtonElement>('[aria-label="Previous allocation page"]')!
  expect(tiles()).toHaveLength(25)
  expect(pager().textContent).toContain('1–25 of 53')
  expect(previous().disabled).toBe(true)
  expect(tiles()[0].getAttribute('aria-label')).toContain(`${(200 / positions.reduce((sum, position) => sum + position.lastPrice!, 0) * 100).toFixed(1)}% of portfolio`)
  await act(async () => next().click())
  expect(tiles()).toHaveLength(25)
  expect(tiles()[0].textContent).toContain('HOLDING26')
  await act(async () => tiles()[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
  expect(container.querySelector('.allocation-detail')?.textContent).toContain('HOLDING27')
  await act(async () => exposureControl('Technology').dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
  const groupDetail = container.querySelector('.allocation-detail')!.textContent
  expect(groupDetail).toContain('Technology')
  await act(async () => next().click())
  expect(tiles()).toHaveLength(3)
  expect(pager().textContent).toContain('51–53 of 53')
  expect(next().disabled).toBe(true)
  expect(container.querySelector('.allocation-detail')!.textContent).toBe(groupDetail)
  expect(tiles().map((tile) => tile.classList.contains('allocation-tile--exposure-match'))).toEqual([true, false, true])
  await act(async () => previous().click())
  expect(pager().textContent).toContain('26–50 of 53')
  const folios = [{ id: 'smaller', name: 'Smaller', importedAt: 0, positions: positions.slice(0, 3) }]
  state.store.snapshot = investmentWorkspace.readSnapshot({ folios, quotes: {} })
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(tiles()).toHaveLength(3)
  expect(container.querySelector('[aria-label="Allocation treemap pages"]')).toBeNull()
  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(container.querySelector('.allocation-map, .allocation-pagination')).toBeNull()
})

it('keeps allocation selection local so hovering a holding does not rerender the benchmark chart', async () => {
  await renderInsights([{ at: Date.UTC(2026, 0, 1), value: 100, invested: 100 }, { at: Date.UTC(2026, 2, 1), value: 110, invested: 100 }], [], exposurePositions)
  state.chart.mockClear()
  const tiles = container.querySelectorAll<HTMLButtonElement>('.allocation-tile')
  await act(async () => tiles[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
  expect(tiles[1].getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.allocation-detail')?.textContent).toContain(tiles[1].querySelector('strong')!.textContent)
  expect(state.chart).not.toHaveBeenCalled()
})

it('keeps unpriced and zero-value imports visible outside weighted allocation tiles', async () => {
  const base: Position = { id: 'priced', ticker: 'PRICED', name: 'Priced', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }
  await renderInsights([], [], [
    base, { ...base, id: 'second-import' },
    { ...base, id: 'missing', ticker: 'MISSING', lastPrice: null },
    { ...base, id: 'zero', ticker: 'ZERO', lastPrice: 0 },
  ])
  const tiles = container.querySelectorAll('.allocation-tile')
  expect(tiles).toHaveLength(1)
  expect(tiles[0].textContent).toBe('PRICED 100.0%')
  expect(container.querySelector('.allocation-detail')?.textContent).toContain('₹200')
  const unmapped = container.querySelector('.allocation-unmapped')!
  expect(unmapped.textContent).toContain('MISSINGUnpriced')
  expect(unmapped.textContent).toContain('ZERONo positive value')
  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(container.querySelector('.allocation-map')).toBeNull()
  expect(container.querySelector('.allocation-unmapped')).toBeNull()
})

it('moves the full allocation and composition below movers with its own recoverable holding scope', async () => {
  const positions: Position[] = [
    { id: 'equity', ticker: 'EQUITY', name: 'Equity', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 },
    { id: 'fund', ticker: 'FUND', name: 'Fund', type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 80 },
  ]
  await renderInsights([], [], positions)
  const allocation = container.querySelector<HTMLElement>('[aria-label="Allocation mix"]')!
  expect(allocation.previousElementSibling?.querySelector('.panel-title')?.textContent).toBe('Latest price movers')
  expect(container.querySelector('.risk-profile')).toBeNull()
  expect(allocation.querySelector('.alloc-summary')?.textContent).toContain('50% in profit')
  const details = allocation.querySelector<HTMLDetailsElement>('.alloc-more')!
  expect(details.open).toBe(false)
  expect(details.querySelector('summary')?.textContent).toBe('Composition details')
  details.open = true
  expect(details.querySelector('.alloc-more-content')).not.toBeNull()
  const select = (label: string) => act(async () => [...allocation.querySelectorAll<HTMLButtonElement>('.scope-btn')].find(button => button.textContent?.startsWith(label))!.click())
  const summary = container.querySelector('.insights-summary-current strong')?.textContent
  await select('Equity')
  expect(allocation.querySelector('.alloc-legend')?.textContent).toContain('EQUITY')
  expect(allocation.querySelector('.alloc-legend')?.textContent).not.toContain('FUND')
  expect(allocation.querySelector('.alloc-summary')?.textContent).toContain('100% in profit')
  expect(allocation.querySelector('.alloc-summary')?.textContent).toContain('100% equity')
  expect(container.querySelector('.insights-summary-current strong')?.textContent).toBe(summary)
  expect(container.querySelectorAll('.allocation-tile')).toHaveLength(2)
  await select('Mutual Funds')
  expect(allocation.querySelector('.alloc-legend')?.textContent).toContain('FUND')
  expect(allocation.querySelector('.alloc-legend')?.textContent).not.toContain('EQUITY')
  await select('All')
  expect(allocation.querySelector('.alloc-summary')?.textContent).toContain('50% in profit')
  expect(state.build).toHaveBeenCalledTimes(1)
  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(allocation.textContent).toContain('Values are hidden')
  expect(allocation.querySelector('.alloc-legend, .alloc-summary, .alloc-more')).toBeNull()
  state.store.settings.hideValues = false
  state.store.snapshot = investmentWorkspace.readSnapshot({ folios: [{ id: 'single', name: 'Single', importedAt: 0, positions: positions.slice(0, 1) }], quotes: {} })
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  await select('Mutual Funds')
  expect(allocation.querySelector('.alloc-empty')).not.toBeNull()
  expect(allocation.querySelectorAll('.scope-btn')).toHaveLength(3)
  await select('All')
  expect(allocation.querySelector('.alloc-empty')).toBeNull()
  expect(allocation.querySelector('.alloc-legend')?.textContent).toContain('EQUITY')
})
