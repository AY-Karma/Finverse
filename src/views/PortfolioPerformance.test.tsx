// @vitest-environment jsdom
import { Activity, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { investmentWorkspace } from '../investmentWorkspace'
import type { PortfolioBackcastHistory } from '../portfolioBackcast'
import { loadSettings } from '../store'
import type { Position, PortfolioSnapshot } from '../types'
import type { useStore } from '../useStore'
import { quoteKey } from '../valuation'
import { isRegularMarketOpen } from '../marketCalendar'
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

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })

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
  expect(container.querySelector('[data-risk="below-high"] .risk-reading strong')?.textContent).toBe('18.2%')
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

it('retries unavailable history from the same screen without changing holding scope', async () => {
  await renderPerformance([])
  expect(container.textContent).toContain('Historical prices are unavailable')
  state.build.mockResolvedValueOnce({ points: points(), coveredPositions: defaultPositions, holdingsIncluded: 1, holdingsTotal: 1 })
  await act(async () => button('Retry history').click())
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('220')
  expect(state.build).toHaveBeenCalledTimes(2)
  expect(state.build.mock.calls[1][0]).toEqual(state.build.mock.calls[0][0])
})

it('retains useful history after failure and cancels a retry without accepting its late result', async () => {
  await renderPerformance()
  state.build.mockRejectedValueOnce(new Error('Network unavailable'))
  await act(async () => button('Earlier history').click())
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('220')
  expect(container.textContent).toContain('History update failed. Showing saved prices.')
  let resolve!: (history: PortfolioBackcastHistory) => void
  state.build.mockImplementationOnce(() => new Promise<PortfolioBackcastHistory>((done) => { resolve = done }))
  await act(async () => button('Retry history').click())
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('220')
  const signal = state.build.mock.lastCall?.[3] as AbortSignal
  await act(async () => button('Cancel update').click())
  expect(signal.aborted).toBe(true)
  await act(async () => resolve({ points: points([800, 900]), coveredPositions: defaultPositions, holdingsIncluded: 1, holdingsTotal: 1 }))
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('220')
  expect(container.textContent).not.toContain('Updating historical prices')
})

it('formats compact chart labels in INR', async () => {
  await renderPerformance(points([200000, 220000]))
  await rerender()
  expect(container.querySelector('[data-chart]')?.getAttribute('data-axis')).toBe('₹2.2L')
  expect(container.querySelector('.insight-chart-metric--value strong')?.textContent).toBe('₹2,20,000')
})

it('places risk after performance and keeps it on shared market history when viewing tracked balances', async () => {
  const history = [100, 1000].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: value, pnl: 0, holdingCount: index + 1 }))
  await renderPerformance(points([200, 180]), { history })
  const performance = container.querySelector('.portfolio-performance')!
  const risk = performance.nextElementSibling!
  expect(risk.querySelector('.panel-title')?.textContent).toBe('Portfolio risk checks')
  expect(risk.querySelector('[data-risk="below-high"] .risk-reading strong')?.textContent).toBe('10.0%')
  expect(state.build).toHaveBeenCalledTimes(1)
  await act(async () => button('Tracked').click())
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('1000')
  expect(risk.querySelector('[data-risk="below-high"] .risk-reading strong')?.textContent).toBe('10.0%')
  expect(state.build).toHaveBeenCalledTimes(1)
})

it('does not substitute tracked balances for loading or unavailable risk history', async () => {
  let resolve!: (history: PortfolioBackcastHistory) => void
  state.build.mockImplementationOnce(() => new Promise<PortfolioBackcastHistory>((done) => { resolve = done }))
  const history = [100, 1000].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: value, pnl: 0, holdingCount: index + 1 }))
  await renderPerformance([], { history })
  const risk = container.querySelector('.portfolio-performance')!.nextElementSibling!
  expect(risk.textContent).toMatch(/loading/i)
  expect(risk.querySelector('[data-risk]')).toBeNull()
  await act(async () => button('Tracked').click())
  expect(container.querySelector('[data-chart]')?.getAttribute('data-latest')).toBe('1000')
  expect(risk.querySelector('[data-risk]')).toBeNull()
  await act(async () => resolve({ points: [], coveredPositions: [], holdingsIncluded: 0, holdingsTotal: 1 }))
  expect(risk.textContent).toMatch(/unavailable/i)
  expect(risk.querySelector('[data-risk]')).toBeNull()
  expect(state.build).toHaveBeenCalledTimes(1)
})

it('describes a same-day drop as less than one day below peak instead of claiming recovery', async () => {
  await renderPerformance([
    { at: Date.parse('2026-11-04T09:00:00+05:30'), value: 120, invested: 100 },
    { at: Date.parse('2026-11-04T12:00:00+05:30'), value: 110, invested: 100 },
  ])
  const time = container.querySelector('[data-risk="time-below-peak"]')!
  expect(time.querySelector('.risk-reading > strong')?.textContent).toBe('Less than 1 day')
  expect(time.textContent).toContain('Below peak since today.')
  expect(time.textContent).not.toContain('Latest value is at its observed peak.')
})

it('does not annualize sparse monthly observations as daily returns', async () => {
  await renderPerformance([100, 80, 110].map((value, index) => ({ at: Date.UTC(2026, index, 1) - 5.5 * 3600000, value, invested: 100 })))
  const volatility = container.querySelectorAll('.risk-reading')[2]
  expect(volatility?.textContent).toContain('Unavailable')
  expect(volatility?.textContent).not.toMatch(/\d+\.\d+%/)
  expect(container.textContent).toContain('Daily closes are required')
})

it('shows the exact peak, latest value and rupee drop behind the current drawdown', async () => {
  await renderPerformance([12000.75, 15000.5, 13400.25].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: 100 })))
  const calculation = container.querySelector('.risk-calculation')!
  expect([...calculation.querySelectorAll('dt')].map((label) => label.textContent)).toEqual(['Peak value', 'Below peak', 'Latest value'])
  expect([...calculation.querySelectorAll('dd')].map((reading) => reading.textContent)).toEqual(['₹15,000.50', '₹1,600.25', '₹13,400.25'])
  expect(calculation.querySelector('.risk-calculation-result--loss')).not.toBeNull()
  expect(calculation.closest('.risk-bar')?.querySelector('.risk-reading strong')?.textContent).toBe('10.7%')
  state.store.settings.hideValues = true
  await act(async () => root!.render(<PortfolioPerformance />))
  expect(calculation.querySelectorAll('strong')).toHaveLength(3)
  expect([...calculation.querySelectorAll('strong')].every((element) => element.textContent === '••••')).toBe(true)
  expect(calculation.innerHTML).not.toMatch(/₹|15000|13400|1600/)
  expect(calculation.querySelector('.risk-calculation-result--loss')).toBeNull()
})

it('labels partial historical coverage without substituting the full portfolio value', async () => {
  const positions: Position[] = ['AAA', 'BBB'].map((ticker) => ({ id: ticker, ticker, name: ticker, type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }))
  const points = [150, 120].map((value, index) => ({ at: Date.UTC(2026, 0, 1 + index), value, invested: 100 }))
  state.build.mockResolvedValueOnce({ points, coveredPositions: [positions[0]], holdingsIncluded: 1, holdingsTotal: 2 })
  await renderPerformance(points, { positions })
  expect(container.querySelector('.risk-calculation-stat:last-child dd')?.textContent).toBe('₹120.00')
  expect(container.querySelector('.risk-calculation-basis')?.textContent).toBe('History covers 1 of 2 holdings · 50% of priced INR value.')
})

it('replaces duplicate risk cards with peak duration and exact eligible down-session counts', async () => {
  const dates = ['21', '22', '23', '24', '25', '29', '30']
  await renderPerformance([100, 100, 90, 95, 80, 60, 50].map((value, index) => ({
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
  expect(sessions.querySelector('.risk-session-ratio')?.getAttribute('aria-label')).toBe('2 lower closes and 2 higher or unchanged closes')
  expect(duration.querySelector('.risk-status')?.textContent).toBe('Good')
  expect(duration.querySelector('.risk-track canvas')).not.toBeNull()
  expect(duration.querySelector('.risk-track')?.getAttribute('aria-label')).toBe('Time below peak: 8 days, Good. Bar scale 0 to 180 days.')
  expect(sessions.querySelector('.risk-status')?.textContent).toBe('To watch')
  expect(container.querySelector('.risk-history-basis')?.textContent).toContain('30 Sept 2026')

  state.store.settings.hideValues = true
  await act(async () => root!.render(<PortfolioPerformance />))
  for (const card of [duration, sessions]) {
    expect(card.querySelector('.risk-reading strong')?.textContent).toBe('••••')
    expect(card.innerHTML).not.toMatch(/2 of 4|50\.0%|22 Sept 2026|8 days/)
  }
  expect(sessions.querySelector('.risk-session-split')).toBeNull()
  expect(duration.querySelector('.risk-track')?.getAttribute('aria-label')).toBe('Time below peak: hidden')
  expect(duration.querySelector('.risk-timeline time')).toBeNull()
  expect(duration.innerHTML).not.toMatch(/2026-09-22|2026-09-30/)
  expect(container.querySelector('.risk-history-basis')).toBeNull()
})

it('shows recovery as zero days and leaves down-session frequency unavailable for sparse history', async () => {
  await renderPerformance([100, 80, 100].map((value, index) => ({ at: Date.UTC(2026, index, 1), value, invested: 100 })))
  expect(container.querySelector('[data-risk="time-below-peak"] .risk-reading strong')?.textContent).toBe('0 days')
  expect(container.querySelector('[data-risk="time-below-peak"] .risk-summary')?.textContent).toBe('Latest value is at its observed peak.')
  expect(container.querySelector('[data-risk="down-sessions"] .risk-reading')?.textContent).toContain('Unavailable')
  expect(container.querySelector('[data-risk="down-sessions"] .risk-reading')?.textContent).not.toContain('0 of 0')
})

it.each([[29, 'Good', 'lower'], [30, 'To watch', 'watch'], [89, 'To watch', 'watch'], [90, 'High', 'high']] as const)(
  'rates %i days below peak as %s with matching meter bands', async (days, label, status) => {
    const start = Date.parse('2026-01-05T00:00:00+05:30')
    await renderPerformance([{ at: start, value: 100, invested: 100 }, { at: start + days * 86400000, value: 90, invested: 100 }])
    const card = container.querySelector('[data-risk="time-below-peak"]')!
    expect(card.classList.contains(`risk-bar--${status}`)).toBe(true)
    expect(card.querySelector('.risk-status')?.textContent).toBe(label)
    expect(card.querySelectorAll('.risk-track-zone')).toHaveLength(3)
    const help = card.querySelector<HTMLButtonElement>('.risk-help')!
    await act(async () => help.click())
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(help.getAttribute('aria-controls')!)?.textContent).toContain('Good below 30 days · To watch from 30 days · High from 90 days')
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
    await renderPerformance(points)
    const card = container.querySelector('[data-risk="down-sessions"]')!
    expect(card.classList.contains(`risk-bar--${status}`)).toBe(true)
    expect(card.querySelector('.risk-status')?.textContent).toBe(label)
    expect(card.querySelector('.risk-reading strong')?.textContent).toBe(`${down} of 20`)
    expect(card.querySelector('.risk-observation')?.textContent).toBe(`${(down * 5).toFixed(1)}%`)
    expect(card.querySelector('.risk-session-ratio')?.getAttribute('aria-label')).toBe(`${down} lower closes and ${20 - down} higher or unchanged closes`)
  },
)
