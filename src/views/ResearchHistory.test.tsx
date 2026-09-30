// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPoint } from '../live'
import type { Position } from '../types'
import { ResearchHistory } from './ResearchHistory'

const state = vi.hoisted(() => ({ history: vi.fn(), rows: [] as { at: number; price: number | undefined }[], showArea: true }))
vi.mock('../marketData', () => ({ marketData: { history: state.history } }))
vi.mock('./InteractiveTrendChart', () => ({ InteractiveTrendChart: (props: { rows: typeof state.rows; showArea: boolean }) => {
  state.rows = props.rows
  state.showArea = props.showArea
  return <div data-testid="history-chart" />
} }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const position: Position = { id: 'merged:EQ:TCS', ticker: 'TCS', name: 'TCS', type: 'stock', exchange: 'NSE', providerSymbol: 'TCS.NS', quantity: 10, buyPrice: 100, invested: 1000, lastPrice: 120 }
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  state.history.mockReset()
  state.rows = []
  state.showArea = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function render(nextPosition = position, active = true, allowed = true) {
  await act(async () => root.render(<ResearchHistory position={nextPosition} active={active} allowed={allowed} format={String} />))
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === text)
  expect(button).toBeDefined()
  await act(async () => button!.click())
}

describe('research history', () => {
  it('keeps a pending request stable across quote, quantity and stock name changes, then cancels it when inactive', async () => {
    let resolveHistory: (points: HistoryPoint[]) => void = () => {}
    state.history.mockImplementation(() => new Promise<HistoryPoint[]>((resolve) => { resolveHistory = resolve }))
    await render()
    expect(state.history).not.toHaveBeenCalled()
    await click('Load price history')
    const signal = state.history.mock.calls[0][3] as AbortSignal
    await render({ ...position, name: 'Tata Consultancy Services', quantity: 20, lastPrice: 150 })
    expect(state.history).toHaveBeenCalledTimes(1)
    expect(signal.aborted).toBe(false)
    await render({ ...position }, false)
    expect(signal.aborted).toBe(true)
    await act(async () => resolveHistory([{ date: '2026-01-01', close: 100 }, { date: '2026-01-02', close: 110 }]))
    expect(container.querySelector('[data-testid="history-chart"]')).toBeNull()
  })

  it('cancels obsolete listing requests and refetches for a changed provider, range or permission', async () => {
    state.history.mockImplementation(() => new Promise(() => {}))
    await render()
    await click('Load price history')
    const firstSignal = state.history.mock.calls[0][3] as AbortSignal
    const next = { ...position, exchange: 'BSE' as const, providerSymbol: 'TCS.BO' }
    await render(next)
    expect(firstSignal.aborted).toBe(true)
    expect(state.history).toHaveBeenCalledTimes(2)
    expect(state.history.mock.calls[1][0]).toEqual(next)
    await click('3 months')
    expect((state.history.mock.calls[1][3] as AbortSignal).aborted).toBe(true)
    expect(state.history).toHaveBeenCalledTimes(3)
    await render(next, true, false)
    expect((state.history.mock.calls[2][3] as AbortSignal).aborted).toBe(true)
    expect(state.history).toHaveBeenCalledTimes(3)
  })

  it('uses a mutual fund scheme name as request identity', async () => {
    state.history.mockImplementation(() => new Promise(() => {}))
    const fund = { ...position, type: 'mutual-fund' as const, name: 'Fund Direct Growth' }
    await render(fund)
    await click('Load NAV history')
    await render({ ...fund, ticker: 'REIMPORT', quantity: 20 })
    expect(state.history).toHaveBeenCalledTimes(1)
    await render({ ...fund, name: 'Fund Regular Growth' })
    expect((state.history.mock.calls[0][3] as AbortSignal).aborted).toBe(true)
    expect(state.history).toHaveBeenCalledTimes(2)
  })

  it('breaks invalid observations and sparse dates while preserving ordinary weekend closures', async () => {
    state.history.mockResolvedValue([
      { date: '2026-01-02', close: 100 }, { date: '2026-01-05', close: 110 },
      { date: '2026-01-06', close: Number.NaN }, { date: '2026-01-07', close: 120 },
      { date: '2026-02-01', close: 130 }, { date: 'not-a-date', close: 140 },
      { date: '2026-02-02', close: 150 }, { date: '2026-02-03', close: 0 }, { date: '2026-02-04', close: 160 },
    ])
    await render()
    await click('Load price history')
    expect(state.rows.map((row) => row.price)).toEqual([100, 110, undefined, 120, undefined, 130, undefined, 150, undefined, 160])
    expect(state.rows.every((row) => Number.isFinite(row.at))).toBe(true)
    expect(state.showArea).toBe(false)
    expect(container.textContent).toContain('weekends may be connected')
  })

  it('breaks a short Tuesday-to-Thursday gap without assuming the missing weekday was a holiday', async () => {
    state.history.mockResolvedValue([{ date: '2026-01-06', close: 100 }, { date: '2026-01-08', close: 110 }])
    await render()
    await click('Load price history')
    expect(state.rows).toEqual([
      { at: Date.parse('2026-01-06'), price: 100 },
      { at: Date.parse('2026-01-07'), price: undefined },
      { at: Date.parse('2026-01-08'), price: 110 },
    ])
  })

  it('retains an invalid observation break when downsampling would skip that date', async () => {
    const history = Array.from({ length: 500 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10), close: 100 + index,
    }))
    history[249].close = Number.NaN
    state.history.mockResolvedValue(history)
    await render()
    await click('Load price history')
    const gapIndex = state.rows.findIndex((row) => row.price === undefined)
    expect(gapIndex).toBeGreaterThan(0)
    expect(gapIndex).toBeLessThan(state.rows.length - 1)
    expect(state.rows[gapIndex].at).toBe(Date.parse(history[249].date))
    expect(state.rows.filter((row) => row.price !== undefined)).toHaveLength(180)
    expect(state.rows[0].price).toBe(100)
    expect(state.rows[state.rows.length - 1]?.price).toBe(599)
    expect(state.rows.every((row) => row.price === undefined || history.some((point) => Date.parse(point.date) === row.at && point.close === row.price))).toBe(true)
  })
})
