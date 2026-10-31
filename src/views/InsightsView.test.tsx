// @vitest-environment jsdom
import { Activity, act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { investmentWorkspace } from '../investmentWorkspace'
import { loadSettings } from '../store'
import type { Position, PortfolioSnapshot } from '../types'
import type { PortfolioBackcastHistory } from '../portfolioBackcast'
import type { useStore } from '../useStore'
import { quoteKey } from '../valuation'
import { isRegularMarketOpen } from '../marketCalendar'
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

it('shows holding price history for all holdings at the bottom below the insights grid', async () => {
  await renderInsights([])
  const history = container.querySelector('[data-history-scope="all"]')
  expect(history).not.toBeNull()
  expect(container.querySelector('.insights-page')?.lastElementChild).toBe(history)
  expect(history?.previousElementSibling?.classList.contains('insight-grid')).toBe(true)
})

it('keeps session totals and contributors on stocks and ETFs until same-session NAVs publish', async () => {
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
  expect(card.querySelector('.hint')?.textContent).toContain('2 of 2 stocks + ETFs')
  await act(async () => card.click())
  expect(container.querySelectorAll('.session-contributors-row')).toHaveLength(2)
  expect(container.querySelector('.session-contributors-total')?.textContent).toContain('+₹7.00')
  const published = { ...quotes, [quoteKey(positions[2])]: { ...quotes[quoteKey(positions[2])], at: Date.parse('2026-10-30T00:00:00+05:30') } }
  state.store.snapshot = investmentWorkspace.readSnapshot({ folios, quotes: published })
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(card.querySelector('strong')?.textContent).toBe('+₹9.00')
  expect(card.querySelector('.hint')?.textContent).toContain('3 of 3 session holdings')
  expect(container.querySelectorAll('.session-contributors-row')).toHaveLength(3)
  expect(container.querySelector('.session-contributors-total')?.textContent).toContain('+₹9.00')
  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(card.querySelector('strong')?.textContent).toBe('••••••')
  expect(card.querySelector('.hint')?.textContent).toBe('Session values hidden')
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
  expect(container.querySelector('#drawdown-kpi strong')?.textContent).toBe('-18.2%')
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

it('shows the exact peak, latest value and rupee drop behind the current drawdown', async () => {
  await renderInsights([12000.75, 15000.5, 13400.25].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: 100 })))
  const calculation = container.querySelector('.risk-calculation')!
  expect([...calculation.querySelectorAll('dt')].map((label) => label.textContent)).toEqual(['Peak value', 'Latest value', 'Below peak'])
  expect([...calculation.querySelectorAll('dd')].map((reading) => reading.textContent)).toEqual(['₹15,000.50', '₹13,400.25', '₹1,600.25'])
  expect(calculation.querySelector('.risk-calculation-result--loss')).not.toBeNull()
  expect(calculation.closest('.risk-bar')?.querySelector('.risk-reading strong')?.textContent).toBe('10.7%')
  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(calculation.querySelectorAll('strong')).toHaveLength(3)
  expect([...calculation.querySelectorAll('strong')].every((element) => element.textContent === '••••')).toBe(true)
  expect(calculation.innerHTML).not.toMatch(/₹|15000|13400|1600/)
  expect(calculation.querySelector('.risk-calculation-result--loss')).toBeNull()
})

it('labels partial historical coverage without substituting the full portfolio value', async () => {
  const positions: Position[] = ['AAA', 'BBB'].map((ticker) => ({ id: ticker, ticker, name: ticker, type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }))
  const points = [150, 120].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: 100 }))
  state.build.mockResolvedValueOnce({ points, coveredPositions: [positions[0]], holdingsIncluded: 1, holdingsTotal: 2 })
  await renderInsights(points, [], positions)
  expect(container.querySelector('.risk-calculation-stat:nth-child(2) dd')?.textContent).toBe('₹120.00')
  expect(container.querySelector('.risk-calculation-basis')?.textContent).toBe('History covers 1 of 2 holdings · 50% of priced INR value.')
})

it('replaces duplicate risk cards with peak duration and exact eligible down-session counts', async () => {
  const dates = ['21', '22', '23', '24', '25', '29', '30']
  await renderInsights([100, 100, 90, 95, 80, 60, 50].map((value, index) => ({
    at: Date.parse(`2026-09-${dates[index]}T15:30:00+05:30`), value, invested: 100,
    ...(index === 6 ? { isCurrent: true } : {}),
  })))
  const duration = container.querySelector('[data-risk="time-below-peak"]')!
  const sessions = container.querySelector('[data-risk="down-sessions"]')!
  expect(duration.querySelector('.risk-reading strong')?.textContent).toBe('8 days')
  expect(duration.querySelector('.risk-bar-head .risk-reading')).toBeNull()
  expect(duration.querySelector('.risk-timeline-reading .risk-reading strong')?.textContent).toBe('8 days')
  expect([...duration.querySelectorAll('.risk-timeline dt')].map((label) => label.textContent)).toEqual(['Last observed peak', 'Latest reading'])
  expect([...duration.querySelectorAll('.risk-timeline time')].map((reading) => reading.textContent)).toEqual(['22 Sept 2026', '30 Sept 2026'])
  expect(sessions.querySelector('.risk-reading strong')?.textContent).toBe('2 of 4')
  expect(sessions.querySelector('.risk-observation')?.textContent).toBe('50.0%')
  expect(sessions.querySelector('.risk-track')?.getAttribute('aria-label')).toContain('2 of 4')
  expect(duration.querySelector('.risk-status')?.textContent).toBe('Good')
  expect(duration.querySelector('.risk-track canvas')).not.toBeNull()
  expect(duration.querySelector('.risk-track')?.getAttribute('aria-label')).toBe('Time below peak: 8 days, Good. Bar scale 0 to 180 days.')
  expect(sessions.querySelector('.risk-status')?.textContent).toBe('To watch')
  expect(container.querySelector('.risk-profile')?.textContent).not.toMatch(/Worst past drop|Top five holdings/)
  expect(container.querySelector('#drawdown-kpi')).not.toBeNull()
  expect(container.querySelector('.risk-history-basis')?.textContent).toContain('30 Sept 2026')

  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  for (const card of [duration, sessions]) {
    expect(card.querySelector('.risk-reading strong')?.textContent).toBe('••••')
    expect(card.innerHTML).not.toMatch(/2 of 4|50\.0%|22 Sept 2026|8 days/)
  }
  expect(sessions.querySelector('.risk-track')?.getAttribute('aria-label')).toBe('Down sessions: hidden')
  expect(duration.querySelector('.risk-track')?.getAttribute('aria-label')).toBe('Time below peak: hidden')
  expect(duration.querySelector('.risk-timeline time')).toBeNull()
  expect(duration.innerHTML).not.toMatch(/2026-09-22|2026-09-30/)
  expect(container.querySelector('.risk-history-basis')).toBeNull()
})

it('shows recovery as zero days and leaves down-session frequency unavailable for sparse history', async () => {
  await renderInsights([100, 80, 100].map((value, index) => ({ at: Date.UTC(2026, index, 1), value, invested: 100 })))
  expect(container.querySelector('[data-risk="time-below-peak"] .risk-reading strong')?.textContent).toBe('0 days')
  expect(container.querySelector('[data-risk="time-below-peak"] .risk-summary')?.textContent).toBe('Latest value is at its observed peak.')
  expect(container.querySelector('[data-risk="down-sessions"] .risk-reading')?.textContent).toContain('Unavailable')
  expect(container.querySelector('[data-risk="down-sessions"] .risk-reading')?.textContent).not.toContain('0 of 0')
})

it.each([[29, 'Good', 'lower'], [30, 'To watch', 'watch'], [89, 'To watch', 'watch'], [90, 'High', 'high']] as const)(
  'rates %i days below peak as %s with matching meter bands', async (days, label, status) => {
    const start = Date.parse('2026-01-05T00:00:00+05:30')
    await renderInsights([{ at: start, value: 100, invested: 100 }, { at: start + days * 86400000, value: 90, invested: 100 }])
    const card = container.querySelector('[data-risk="time-below-peak"]')!
    expect(card.classList.contains(`risk-bar--${status}`)).toBe(true)
    expect(card.querySelector('.risk-status')?.textContent).toBe(label)
    expect(card.querySelectorAll('.risk-track-zone')).toHaveLength(3)
    expect(card.querySelector('.risk-help-popover')?.textContent).toContain('Good below 30 days · To watch from 30 days · High from 90 days')
  },
)

it.each([[8, 'Good', 'lower'], [9, 'To watch', 'watch'], [10, 'To watch', 'watch'], [11, 'High', 'high']] as const)(
  'rates %i of 20 down sessions as %s without losing the exact percentage', async (down, label, status) => {
    const points: PortfolioBackcastHistory['points'] = []
    let value = 100
    for (let at = Date.parse('2026-09-01T12:00:00+05:30'); points.length < 21; at += 86400000) {
      if (!isRegularMarketOpen(new Date(at))) continue
      if (points.length) value *= points.length <= down ? 0.99 : 1.01
      points.push({ at, value, invested: 100 })
    }
    await renderInsights(points)
    const card = container.querySelector('[data-risk="down-sessions"]')!
    expect(card.classList.contains(`risk-bar--${status}`)).toBe(true)
    expect(card.querySelector('.risk-status')?.textContent).toBe(label)
    expect(card.querySelector('.risk-reading strong')?.textContent).toBe(`${down} of 20`)
    expect(card.querySelector('.risk-observation')?.textContent).toBe(`${(down * 5).toFixed(1)}%`)
    expect(card.querySelectorAll('.risk-track-zone')).toHaveLength(3)
  },
)

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

it('shows and selects imported holdings beyond the sixteenth allocation tile', async () => {
  const positions: Position[] = Array.from({ length: 17 }, (_, index) => ({
    id: `holding-${index}`, ticker: `HOLDING${index + 1}`, name: `Holding ${index + 1}`, type: 'stock',
    quantity: 1, buyPrice: 100, invested: 100, lastPrice: 200 - index,
  }))
  await renderInsights([], [], positions)
  const tiles = [...container.querySelectorAll<HTMLButtonElement>('.allocation-tile')]
  expect(tiles).toHaveLength(17)
  expect(tiles.map((tile) => tile.querySelector('strong')?.textContent)).toEqual(positions.map((position) => position.ticker))
  await act(async () => tiles[16].dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
  expect(tiles[16].getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.allocation-detail')?.textContent).toContain('HOLDING17')
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
  expect(tiles[0].textContent).toBe('PRICED100.0%')
  expect(container.querySelector('.allocation-detail')?.textContent).toContain('₹200')
  const unmapped = container.querySelector('.allocation-unmapped')!
  expect(unmapped.textContent).toContain('MISSINGUnpriced')
  expect(unmapped.textContent).toContain('ZERONo positive value')
  state.store.settings.hideValues = true
  await act(async () => root!.render(<InsightsView onRequestImport={vi.fn()} />))
  expect(container.querySelector('.allocation-map')).toBeNull()
  expect(container.querySelector('.allocation-unmapped')).toBeNull()
})
