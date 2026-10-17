// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPoint } from '../live'
import type { Position } from '../types'
import { HistoryPanel } from './HistoryPanel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { history, settings, store } = vi.hoisted(() => ({
  history: vi.fn<(_position: unknown, _from: Date, _to: Date, _signal?: AbortSignal) => Promise<HistoryPoint[]>>(),
  settings: { allowExternalData: true, hideValues: false, currency: 'INR' },
  store: { positions: [] as Position[] },
}))

vi.mock('../marketData', () => ({ marketData: { history } }))
vi.mock('../useStore', () => ({
  useStore: () => ({
    positions: store.positions,
    settings,
  }),
}))
vi.mock('./InteractiveTrendChart', () => ({
  InteractiveTrendChart: ({ referenceLines, valueFormatter, yAxisLabel }: { referenceLines?: unknown[]; valueFormatter: (value: number) => string; yAxisLabel: string }) => (
    <div data-testid="history-chart" data-references={JSON.stringify(referenceLines ?? [])} data-formatted-value={valueFormatter(100)} data-axis-label={yAxisLabel} />
  ),
}))

const defaultPosition: Position = { id: 'fund', ticker: 'FMCGIETF', name: 'FMCGIETF', type: 'etf', quantity: 1, buyPrice: 100, lastPrice: null, invested: 100 }

beforeEach(() => { store.positions = [defaultPosition] })

let root: Root
let container: HTMLDivElement

async function renderPanel() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<HistoryPanel scope="all" />) })
}

async function trackHolding(label: string) {
  const input = container.querySelector<HTMLInputElement>('.history-input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, label)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { container.querySelector<HTMLButtonElement>('.history-track')!.click() })
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  history.mockReset()
  settings.hideValues = false
  settings.allowExternalData = true
})

describe('Holding Price History', () => {
  it('aborts pending history and blocks range requests when effective external access is disabled', async () => {
    let signal!: AbortSignal
    history.mockImplementation((_position, _from, _to, requestSignal) => {
      signal = requestSignal!
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    await renderPanel()
    expect(signal.aborted).toBe(false)
    settings.allowExternalData = false
    await act(async () => { root.render(<HistoryPanel scope="all" />) })
    expect(signal.aborted).toBe(true)
    await act(async () => { container.querySelector<HTMLButtonElement>('.range-btn')!.click() })
    expect(history).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Enable external market data')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it('tracks the second listing of a shared ticker and keeps it when the range changes', async () => {
    store.positions = [
      { ...defaultPosition, id: 'nse-listing', ticker: 'TWIN', exchange: 'NSE', currency: 'INR', providerSymbol: 'TWIN.NS' },
      { ...defaultPosition, id: 'bse-listing', ticker: 'TWIN', exchange: 'BSE', currency: 'INR', providerSymbol: 'TWIN.BO' },
    ]
    history.mockImplementation(async (position) => [
      { date: '2026-09-21', close: 100 },
      { date: '2026-09-22', close: (position as Position).id === 'bse-listing' ? 210 : 110 },
    ])
    await renderPanel()
    const labels = [...container.querySelectorAll<HTMLOptionElement>('datalist option')].map((option) => option.value)
    expect(labels).toEqual(['TWIN · NSE · INR · TWIN.NS', 'TWIN · BSE · INR · TWIN.BO'])
    expect(labels.join(' ')).not.toMatch(/nse-listing|bse-listing/)

    await trackHolding(labels[1])
    expect(history.mock.lastCall?.[0]).toBe(store.positions[1])
    expect(container.querySelector('.history-last')?.textContent).toBe('₹210.00')
    expect(container.querySelector('.history-source')?.textContent).toContain('TWIN.BO')

    await act(async () => { container.querySelector<HTMLButtonElement>('.range-btn')!.click() })
    expect(history.mock.lastCall?.[0]).toBe(store.positions[1])
  })

  it('tracks the second mapped mutual fund scheme when the holding names match', async () => {
    store.positions = [
      { ...defaultPosition, id: 'direct-fund', type: 'mutual-fund', name: 'Example Fund', mfScheme: { code: 101, name: 'Example Fund Direct Growth', source: 'confirmed' } },
      { ...defaultPosition, id: 'regular-fund', type: 'mutual-fund', name: 'Example Fund', mfScheme: { code: 202, name: 'Example Fund Regular Growth', source: 'confirmed' } },
    ]
    history.mockResolvedValue([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 102 }])
    await renderPanel()
    const labels = [...container.querySelectorAll<HTMLOptionElement>('datalist option')].map((option) => option.value)
    expect(labels[0]).toContain('Direct Growth · Scheme 101')
    expect(labels[1]).toContain('Regular Growth · Scheme 202')

    await trackHolding(labels[1])
    expect(history.mock.lastCall?.[0]).toBe(store.positions[1])
    expect(container.querySelector<HTMLInputElement>('.history-input')?.value).toBe(labels[1])
  })

  it('defaults to the current scope when the committed holding leaves it', async () => {
    store.positions = [
      defaultPosition,
      { ...defaultPosition, id: 'mutual', name: 'Example Fund', type: 'mutual-fund' },
    ]
    history.mockResolvedValue([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 102 }])
    await renderPanel()
    await trackHolding('Example Fund')
    expect(history.mock.lastCall?.[0]).toBe(store.positions[1])

    await act(async () => { root.render(<HistoryPanel scope="equity" />) })
    expect(history.mock.lastCall?.[0]).toBe(defaultPosition)
    expect(container.querySelector<HTMLInputElement>('.history-input')?.value).toBe('FMCGIETF')

    await act(async () => { root.render(<HistoryPanel scope="all" />) })
    expect(container.querySelector<HTMLInputElement>('.history-input')?.value).toBe('Example Fund')
  })

  it('formats USD history and average cost in the native currency while display settings use INR', async () => {
    store.positions = [{ ...defaultPosition, ticker: 'AAPL', currency: 'USD', exchange: 'NASDAQ', providerSymbol: 'AAPL' }]
    history.mockResolvedValue([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 120 }])
    await renderPanel()
    expect(container.querySelector('.history-last')?.textContent).toBe('$120.00')
    expect(container.querySelector('.history-delta')?.textContent).toContain('+$20.00')
    const chart = container.querySelector('[data-testid="history-chart"]')!
    expect(chart.getAttribute('data-formatted-value')).toBe('$100.00')
    expect(chart.getAttribute('data-axis-label')).toBe('Price (USD)')
    expect(JSON.parse(chart.getAttribute('data-references')!)[0]).toMatchObject({ value: 100, label: 'Avg cost' })
    expect(container.querySelector('.history-cost-summary')?.textContent).toContain('Avg cost $100.00')
    expect(container.querySelector('.history-cost-summary')?.textContent).toContain('+$20.00 (+20.0%)')
    expect(container.textContent).not.toContain('₹')
  })

  it('shows the actual average cost as a reference without implying a purchase date', async () => {
    history.mockResolvedValue([
      { date: '2026-09-21', close: 90 },
      { date: '2026-09-22', close: 103 },
      { date: '2026-09-23', close: 120 },
    ])
    await renderPanel()
    const references = JSON.parse(container.querySelector('[data-testid="history-chart"]')!.getAttribute('data-references')!)
    expect(references).toHaveLength(1)
    expect(references[0]).toMatchObject({ value: 100, label: 'Avg cost' })
    expect(references[0]).not.toHaveProperty('at')
    expect(container.textContent).toContain('Latest close vs cost +₹20.00 (+20.0%)')
    expect(container.textContent).not.toMatch(/since you|Bought|started this investment/)
  })

  it('hides holdings, prices, purchase details, and chart interactions, then restores them', async () => {
    history.mockResolvedValue([
      { date: '2026-09-21', close: 100 },
      { date: '2026-09-22', close: 102 },
    ])
    await renderPanel()
    expect(container.querySelector('.history-cost-summary')).not.toBeNull()
    expect(container.querySelector('[data-testid="history-chart"]')).not.toBeNull()

    settings.hideValues = true
    await act(async () => { root.render(<HistoryPanel scope="all" />) })
    expect(container.textContent).toContain('Values are hidden')
    expect(container.textContent).not.toContain('FMCGIETF')
    expect(container.querySelector('.history-tools, .history-quote, .history-cost-summary, [data-testid="history-chart"]')).toBeNull()
    expect(container.innerHTML).not.toContain('FMCGIETF')

    settings.hideValues = false
    await act(async () => { root.render(<HistoryPanel scope="all" />) })
    expect(container.querySelector<HTMLInputElement>('.history-input')?.value).toBe('FMCGIETF')
    expect(container.querySelector('.history-cost-summary')).not.toBeNull()
    expect(container.querySelector('[data-testid="history-chart"]')).not.toBeNull()
  })

  it('hides holding names in load errors when masking is already enabled', async () => {
    settings.hideValues = true
    history.mockResolvedValue([])
    await renderPanel()
    expect(container.textContent).toContain('Values are hidden')
    expect(container.innerHTML).not.toContain('FMCGIETF')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows a failed default load and retries it', async () => {
    history.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { date: '2026-09-21', close: 100 },
      { date: '2026-09-22', close: 102 },
    ])

    await renderPanel()
    expect(history).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('No price data')
    expect(container.querySelector<HTMLButtonElement>('.history-track')?.textContent).toBe('Retry')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.history-track')?.click()
    })
    expect(history).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="history-chart"]')).not.toBeNull()
  })

  it('ends loading and shows a retry when the history request rejects', async () => {
    history.mockRejectedValueOnce(new Error('Network failure'))

    await renderPanel()

    expect(container.textContent).toContain("Couldn't load price history")
    expect(container.textContent).not.toContain('Fetching FMCGIETF')
    expect(container.querySelector<HTMLButtonElement>('.history-track')?.textContent).toBe('Retry')
  })
})
