// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPoint } from '../live'
import type { Position } from '../types'
import { HistoryPanel } from './HistoryPanel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { history, settings, store, chart } = vi.hoisted(() => ({
  history: vi.fn<(_position: unknown, _from: Date, _to: Date, _signal?: AbortSignal) => Promise<HistoryPoint[]>>(),
  chart: { rows: [] as { at: number; close: number | undefined }[] },
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
  InteractiveTrendChart: ({ rows, referenceLines, valueFormatter, yAxisLabel }: { rows: typeof chart.rows; referenceLines?: unknown[]; valueFormatter: (value: number) => string; yAxisLabel: string }) => {
    chart.rows = rows
    return <div data-testid="history-chart" data-references={JSON.stringify(referenceLines ?? [])} data-formatted-value={valueFormatter(100)} data-axis-label={yAxisLabel} />
  },
}))

const defaultPosition: Position = { id: 'fund', ticker: 'FMCGIETF', name: 'FMCGIETF', type: 'etf', quantity: 1, buyPrice: 100, lastPrice: null, invested: 100 }

beforeEach(() => { store.positions = [defaultPosition]; chart.rows = [] })

let root: Root
let container: HTMLDivElement

async function renderPanel(position?: Position, active = true) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<HistoryPanel scope="all" position={position} active={active} />) })
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
  it.each(['stock', 'etf', 'mutual-fund', 'other'] as const)('binds directly to a supplied %s holding while keeping chart controls and average cost', async (type) => {
    const selected = { ...defaultPosition, id: 'selected', ticker: 'SELECTED', name: 'Selected holding', type }
    history.mockResolvedValue([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 120 }])
    await renderPanel(selected)

    expect(history.mock.lastCall?.[0]).toBe(selected)
    expect(container.querySelector('.history-picker, .section-index')).toBeNull()
    expect(container.textContent).not.toContain('FMCGIETF')
    expect(container.querySelectorAll('.range-btn')).toHaveLength(5)
    expect(container.querySelector('.history-cost-summary')?.textContent).toContain('Avg cost ₹100.00')
    expect(container.querySelector('[data-testid="history-chart"]')).not.toBeNull()

    await act(async () => { container.querySelector<HTMLButtonElement>('.range-btn')!.click() })
    expect(history.mock.lastCall?.[0]).toBe(selected)
  })

  it('keeps a request stable across quotes, quantity and stock name changes, then cancels it when inactive', async () => {
    let resolveHistory!: (points: HistoryPoint[]) => void
    history.mockImplementation(() => new Promise((resolve) => { resolveHistory = resolve }))
    await renderPanel(defaultPosition)
    const signal = history.mock.calls[0][3]!
    const updated = { ...defaultPosition, name: 'Updated holding name', quantity: 20, lastPrice: 150 }
    await act(async () => { root.render(<HistoryPanel scope="all" position={updated} />) })
    expect(history).toHaveBeenCalledTimes(1)
    expect(signal.aborted).toBe(false)

    await act(async () => { root.render(<HistoryPanel scope="all" position={updated} active={false} />) })
    expect(signal.aborted).toBe(true)
    await act(async () => resolveHistory([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 120 }]))
    expect(container.querySelector('[data-testid="history-chart"]')).toBeNull()
    expect(container.textContent).not.toContain('Fetching')
  })

  it('blocks initial and range requests while inactive and loads when activated', async () => {
    history.mockResolvedValue([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 120 }])
    await renderPanel(defaultPosition, false)
    await act(async () => { container.querySelector<HTMLButtonElement>('.range-btn')!.click() })
    expect(history).not.toHaveBeenCalled()
    await act(async () => { root.render(<HistoryPanel scope="all" position={defaultPosition} active />) })
    expect(history).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="history-chart"]')).not.toBeNull()
  })

  it('cancels changed provider, range and consent requests for the selected holding', async () => {
    history.mockImplementation(() => new Promise(() => {}))
    await renderPanel(defaultPosition)
    const next = { ...defaultPosition, exchange: 'BSE' as const, providerSymbol: 'FMCGIETF.BO' }
    await act(async () => { root.render(<HistoryPanel scope="all" position={next} />) })
    expect(history.mock.calls[0][3]?.aborted).toBe(true)
    expect(history.mock.lastCall?.[0]).toBe(next)
    expect(history).toHaveBeenCalledTimes(2)
    await act(async () => { container.querySelector<HTMLButtonElement>('.range-btn')!.click() })
    expect(history.mock.calls[1][3]?.aborted).toBe(true)
    expect(history).toHaveBeenCalledTimes(3)
    settings.allowExternalData = false
    await act(async () => { root.render(<HistoryPanel scope="all" position={next} />) })
    expect(history.mock.calls[2][3]?.aborted).toBe(true)
    expect(history).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain('Enable external market data')
  })

  it('breaks missing weekdays and connects ordinary weekend gaps', async () => {
    history.mockResolvedValue([
      { date: '2026-10-19', close: 100 }, { date: '2026-10-22', close: 110 },
      { date: '2026-10-23', close: 112 }, { date: '2026-10-26', close: 115 },
    ])
    await renderPanel(defaultPosition)

    expect(chart.rows).toEqual([
      { at: Date.parse('2026-10-19'), close: 100 },
      { at: Date.parse('2026-10-19') + (Date.parse('2026-10-22') - Date.parse('2026-10-19')) / 2, close: undefined },
      { at: Date.parse('2026-10-22'), close: 110 },
      { at: Date.parse('2026-10-23'), close: 112 },
      { at: Date.parse('2026-10-26'), close: 115 },
    ])
  })

  it('clears a previous holding series and ignores its late request after selection changes', async () => {
    let resolveOld!: (points: HistoryPoint[]) => void
    let resolveSelected!: (points: HistoryPoint[]) => void
    history.mockResolvedValueOnce([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 120 }])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSelected = resolve }))
    await renderPanel(defaultPosition)
    expect(container.querySelector('.history-last')?.textContent).toBe('₹120.00')
    await act(async () => { root.render(<HistoryPanel scope="all" position={{ ...defaultPosition, id: 'pending', ticker: 'PENDING' }} />) })
    expect(container.querySelector('[data-testid="history-chart"], .history-cost-summary, .history-last')).toBeNull()
    const next = { ...defaultPosition, id: 'next', ticker: 'NEXT', buyPrice: 50 }
    await act(async () => { root.render(<HistoryPanel scope="all" position={next} />) })
    expect(history.mock.calls[1][3]?.aborted).toBe(true)
    expect(container.querySelector('[data-testid="history-chart"], .history-cost-summary, .history-last')).toBeNull()
    await act(async () => resolveOld([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 999 }]))
    expect(container.textContent).not.toContain('999')
    expect(container.querySelector('[data-testid="history-chart"]')).toBeNull()
    await act(async () => resolveSelected([{ date: '2026-09-21', close: 50 }, { date: '2026-09-22', close: 75 }]))
    expect(container.querySelector('.history-last')?.textContent).toBe('₹75.00')
    expect(container.querySelector('.history-cost-summary')?.textContent).toContain('Avg cost ₹50.00')
  })

  it('uses the mutual fund scheme name as request identity without refetching for ticker or quantity changes', async () => {
    history.mockImplementation(() => new Promise(() => {}))
    const fund = { ...defaultPosition, type: 'mutual-fund' as const, name: 'Fund Direct Growth' }
    await renderPanel(fund)
    await act(async () => { root.render(<HistoryPanel scope="all" position={{ ...fund, ticker: 'REIMPORT', quantity: 20 }} />) })
    expect(history).toHaveBeenCalledTimes(1)
    await act(async () => { root.render(<HistoryPanel scope="all" position={{ ...fund, name: 'Fund Regular Growth' }} />) })
    expect(history.mock.calls[0][3]?.aborted).toBe(true)
    expect(history).toHaveBeenCalledTimes(2)
  })

  it('shows an unavailable state for an unsupported holding and can retry without a portfolio picker', async () => {
    const selected = { ...defaultPosition, id: 'other', type: 'other' as const, ticker: 'OTHER' }
    history.mockResolvedValue([])
    await renderPanel(selected)
    expect(history.mock.lastCall?.[0]).toBe(selected)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Price history is unavailable for “OTHER” from the current provider.')
    expect(container.querySelector('[data-testid="history-chart"]')).toBeNull()
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!
    await act(async () => { retry.click() })
    expect(history).toHaveBeenCalledTimes(2)
    expect(history.mock.lastCall?.[0]).toBe(selected)
  })

  it('retries a rejected selected-holding request without the portfolio picker', async () => {
    history.mockRejectedValueOnce(new Error('Network failure')).mockResolvedValueOnce([
      { date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 120 },
    ])
    await renderPanel(defaultPosition)
    expect(container.querySelector('.history-picker')).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load price history")
    const retry = container.querySelector<HTMLButtonElement>('[role="alert"] button')!
    expect(retry.textContent).toBe('Retry')
    await act(async () => { retry.click() })
    expect(history).toHaveBeenCalledTimes(2)
    expect(history.mock.lastCall?.[0]).toBe(defaultPosition)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[data-testid="history-chart"]')).not.toBeNull()
  })

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

  it('formats history and average cost in INR', async () => {
    store.positions = [{ ...defaultPosition, ticker: 'TCS', currency: 'INR', exchange: 'NSE', providerSymbol: 'TCS.NS' }]
    history.mockResolvedValue([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 120 }])
    await renderPanel()
    expect(container.querySelector('.history-last')?.textContent).toBe('₹120.00')
    expect(container.querySelector('.history-delta')?.textContent).toContain('+₹20.00')
    const chart = container.querySelector('[data-testid="history-chart"]')!
    expect(chart.getAttribute('data-formatted-value')).toBe('₹100.00')
    expect(chart.getAttribute('data-axis-label')).toBe('Price (INR)')
    expect(JSON.parse(chart.getAttribute('data-references')!)[0]).toMatchObject({ value: 100, label: 'Avg cost' })
    expect(container.querySelector('.history-cost-summary')?.textContent).toContain('Avg cost ₹100.00')
    expect(container.querySelector('.history-cost-summary')?.textContent).toContain('+₹20.00 (+20.0%)')
    expect(container.textContent).toContain('₹')
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
