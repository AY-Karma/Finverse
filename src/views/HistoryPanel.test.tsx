// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPoint } from '../live'
import type { Position } from '../types'
import { HistoryPanel } from './HistoryPanel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { history, settings, chart } = vi.hoisted(() => ({
  history: vi.fn<(_position: unknown, _from: Date, _to: Date, _signal?: AbortSignal) => Promise<HistoryPoint[]>>(),
  chart: { rows: [] as { at: number; close: number | undefined }[], props: null as ComponentProps<typeof import('./InteractiveTrendChart').InteractiveTrendChart> | null },
  settings: { allowExternalData: true, hideValues: false, currency: 'INR' },
}))

vi.mock('../marketData', () => ({ marketData: { history } }))
vi.mock('../useStore', () => ({
  useStore: () => ({
    settings,
  }),
}))
vi.mock('./InteractiveTrendChart', () => ({
  InteractiveTrendChart: (props: ComponentProps<typeof import('./InteractiveTrendChart').InteractiveTrendChart>) => {
    chart.props = props
    const { rows, referenceLines, valueFormatter, yAxisLabel } = props
    chart.rows = rows as typeof chart.rows
    return <div data-testid="history-chart" data-references={JSON.stringify(referenceLines ?? [])} data-formatted-value={valueFormatter(100)} data-axis-label={yAxisLabel} />
  },
}))

const defaultPosition: Position = { id: 'fund', ticker: 'FMCGIETF', name: 'FMCGIETF', type: 'etf', quantity: 1, buyPrice: 100, lastPrice: null, invested: 100 }

beforeEach(() => { chart.rows = []; chart.props = null })

let root: Root
let container: HTMLDivElement

async function renderPanel(position: Position = defaultPosition, active = true) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<HistoryPanel position={position} active={active} />) })
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
    expect(container.querySelector('.section-index')).toBeNull()
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
    await act(async () => { root.render(<HistoryPanel position={updated} />) })
    expect(history).toHaveBeenCalledTimes(1)
    expect(signal.aborted).toBe(false)

    await act(async () => { root.render(<HistoryPanel position={updated} active={false} />) })
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
    await act(async () => { root.render(<HistoryPanel position={defaultPosition} active />) })
    expect(history).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="history-chart"]')).not.toBeNull()
  })

  it('keeps a loaded chart visible while revalidating after returning to the page', async () => {
    history.mockResolvedValueOnce([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 120 }])
    await renderPanel(defaultPosition)
    await act(async () => { root.render(<HistoryPanel position={defaultPosition} active={false} />) })
    history.mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => { root.render(<HistoryPanel position={defaultPosition} active />) })
    expect(history).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="history-chart"]')).not.toBeNull()
    expect(container.querySelector('.history-last')?.textContent).toContain('120.00')
  })

  it('cancels changed provider, range and consent requests for the selected holding', async () => {
    history.mockImplementation(() => new Promise(() => {}))
    await renderPanel(defaultPosition)
    const next = { ...defaultPosition, exchange: 'BSE' as const, providerSymbol: 'FMCGIETF.BO' }
    await act(async () => { root.render(<HistoryPanel position={next} />) })
    expect(history.mock.calls[0][3]?.aborted).toBe(true)
    expect(history.mock.lastCall?.[0]).toBe(next)
    expect(history).toHaveBeenCalledTimes(2)
    await act(async () => { container.querySelector<HTMLButtonElement>('.range-btn')!.click() })
    expect(history.mock.calls[1][3]?.aborted).toBe(true)
    expect(history).toHaveBeenCalledTimes(3)
    settings.allowExternalData = false
    await act(async () => { root.render(<HistoryPanel position={next} />) })
    expect(history.mock.calls[2][3]?.aborted).toBe(true)
    expect(history).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain('Market data is paused')
  })

  it.each(['etf', 'mutual-fund'] as const)('keeps %s prices and their fill continuous across market holidays and weekends', async (type) => {
    history.mockResolvedValue([
      { date: '2026-10-19', close: 100 }, { date: '2026-10-22', close: 110 },
      { date: '2026-10-23', close: 112 }, { date: '2026-10-26', close: 115 },
    ])
    await renderPanel({ ...defaultPosition, type })

    expect(chart.rows).toEqual([
      { at: Date.parse('2026-10-19'), close: 100 },
      { at: Date.parse('2026-10-22'), close: 110 },
      { at: Date.parse('2026-10-23'), close: 112 },
      { at: Date.parse('2026-10-26'), close: 115 },
    ])
    const { InteractiveTrendChart } = await vi.importActual<typeof import('./InteractiveTrendChart')>('./InteractiveTrendChart')
    const rendered = document.createElement('div')
    rendered.innerHTML = renderToStaticMarkup(<InteractiveTrendChart {...chart.props!} />)
    const line = rendered.querySelector('.interactive-trend-line')!.getAttribute('d')!
    const area = rendered.querySelector('.interactive-trend-area')!.getAttribute('d')!
    expect(line.match(/M/g)).toHaveLength(1)
    expect(line.match(/L/g)).toHaveLength(3)
    expect(area.startsWith(line)).toBe(true)
  })

  it('still breaks the price line at explicitly invalid observations', async () => {
    history.mockResolvedValue([
      { date: '2026-10-19', close: 100 }, { date: '2026-10-20', close: 0 },
      { date: '2026-10-21', close: 110 }, { date: '2026-10-22', close: 112 },
    ])
    await renderPanel(defaultPosition)
    expect(chart.rows[1].close).toBeUndefined()
    const { InteractiveTrendChart } = await vi.importActual<typeof import('./InteractiveTrendChart')>('./InteractiveTrendChart')
    const rendered = document.createElement('div')
    rendered.innerHTML = renderToStaticMarkup(<InteractiveTrendChart {...chart.props!} />)
    expect(rendered.querySelector('.interactive-trend-line')!.getAttribute('d')!.match(/M/g)).toHaveLength(2)
    expect(rendered.querySelector('.interactive-trend-area')!.getAttribute('d')!.match(/Z/g)).toHaveLength(2)
  })

  it('clears a previous holding series and ignores its late request after selection changes', async () => {
    let resolveOld!: (points: HistoryPoint[]) => void
    let resolveSelected!: (points: HistoryPoint[]) => void
    history.mockResolvedValueOnce([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 120 }])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSelected = resolve }))
    await renderPanel(defaultPosition)
    expect(container.querySelector('.history-last')?.textContent).toBe('₹120.00')
    await act(async () => { root.render(<HistoryPanel position={{ ...defaultPosition, id: 'pending', ticker: 'PENDING' }} />) })
    expect(container.querySelector('[data-testid="history-chart"], .history-cost-summary, .history-last')).toBeNull()
    const next = { ...defaultPosition, id: 'next', ticker: 'NEXT', buyPrice: 50 }
    await act(async () => { root.render(<HistoryPanel position={next} />) })
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
    await act(async () => { root.render(<HistoryPanel position={{ ...fund, ticker: 'REIMPORT', quantity: 20 }} />) })
    expect(history).toHaveBeenCalledTimes(1)
    await act(async () => { root.render(<HistoryPanel position={{ ...fund, name: 'Fund Regular Growth' }} />) })
    expect(history.mock.calls[0][3]?.aborted).toBe(true)
    expect(history).toHaveBeenCalledTimes(2)
  })

  it('shows an unavailable state for an unsupported holding and can retry', async () => {
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

  it('retries a rejected selected-holding request', async () => {
    history.mockRejectedValueOnce(new Error('Network failure')).mockResolvedValueOnce([
      { date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 120 },
    ])
    await renderPanel(defaultPosition)
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
    await act(async () => { root.render(<HistoryPanel position={defaultPosition} />) })
    expect(signal.aborted).toBe(true)
    await act(async () => { container.querySelector<HTMLButtonElement>('.range-btn')!.click() })
    expect(history).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Market data is paused')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it('formats history and average cost in INR', async () => {
    history.mockResolvedValue([{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 120 }])
    await renderPanel({ ...defaultPosition, ticker: 'TCS', currency: 'INR', exchange: 'NSE', providerSymbol: 'TCS.NS' })
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

  it('shows a failed load and retries it', async () => {
    history.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { date: '2026-09-21', close: 100 },
      { date: '2026-09-22', close: 102 },
    ])

    await renderPanel()
    expect(history).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('No price data')
    const retry = container.querySelector<HTMLButtonElement>('[role="alert"] button')!
    expect(retry.textContent).toBe('Retry')

    await act(async () => { retry.click() })
    expect(history).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="history-chart"]')).not.toBeNull()
  })

  it('points an unconfirmed listing to listing review instead of blaming the ticker', async () => {
    history.mockResolvedValue([])
    await renderPanel({ ...defaultPosition, identityIssue: 'Confirm the exchange listing.' })
    expect(container.textContent).toContain('Confirm this listing in Settings to load price history')
    expect(container.textContent).not.toContain('check the ticker')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Retry')).toBe(false)
  })

  it('ends loading and shows a retry when the history request rejects', async () => {
    history.mockRejectedValueOnce(new Error('Network failure'))

    await renderPanel()

    expect(container.textContent).toContain("Couldn't load price history")
    expect(container.textContent).not.toContain('Fetching FMCGIETF')
    expect(container.querySelector('[role="alert"] button')?.textContent).toBe('Retry')
  })
})
