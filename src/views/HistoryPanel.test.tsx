// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPoint } from '../live'
import { HistoryPanel } from './HistoryPanel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { history, settings } = vi.hoisted(() => ({
  history: vi.fn<(_position: unknown, _from: Date, _to: Date) => Promise<HistoryPoint[]>>(),
  settings: { allowExternalData: true, hideValues: false },
}))

vi.mock('../marketData', () => ({ marketData: { history } }))
vi.mock('../useStore', () => ({
  useStore: () => ({
    positions: [{ id: 'fund', ticker: 'FMCGIETF', name: 'FMCGIETF', type: 'etf', quantity: 1, buyPrice: 100 }],
    settings,
  }),
}))
vi.mock('./InteractiveTrendChart', () => ({ InteractiveTrendChart: ({ markers }: { markers?: unknown[] }) => <div data-testid="history-chart" data-markers={JSON.stringify(markers ?? [])} /> }))

let root: Root
let container: HTMLDivElement

async function renderPanel() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<HistoryPanel scope="all" />) })
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  history.mockReset()
  settings.hideValues = false
})

describe('Holding Price History', () => {
  it('marks the actual average cost and explains that the nearest chart date is not a purchase date', async () => {
    history.mockResolvedValue([
      { date: '2026-09-21', close: 90 },
      { date: '2026-09-22', close: 103 },
      { date: '2026-09-23', close: 120 },
    ])
    await renderPanel()
    const markers = JSON.parse(container.querySelector('[data-testid="history-chart"]')!.getAttribute('data-markers')!)
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ at: +new Date('2026-09-22T00:00:00'), value: 100, label: 'Avg cost' })
    expect(markers[0].description).toContain('not a purchase date')
    expect(markers[0].comparable).not.toBe(true)
    expect(container.textContent).toContain('20.0% above your average cost')
    expect(container.textContent).toContain('closest historical close for placement, not a purchase date')
    expect(container.textContent).not.toMatch(/since you|Bought|started this investment/)
  })

  it('hides holdings, prices, purchase details, and chart interactions, then restores them', async () => {
    history.mockResolvedValue([
      { date: '2026-09-21', close: 100 },
      { date: '2026-09-22', close: 102 },
    ])
    await renderPanel()
    expect(container.querySelector('.history-purchase')).not.toBeNull()
    expect(container.querySelector('[data-testid="history-chart"]')).not.toBeNull()

    settings.hideValues = true
    await act(async () => { root.render(<HistoryPanel scope="all" />) })
    expect(container.textContent).toContain('Values are hidden')
    expect(container.textContent).not.toContain('FMCGIETF')
    expect(container.querySelector('.history-tools, .history-quote, .history-purchase, [data-testid="history-chart"]')).toBeNull()
    expect(container.innerHTML).not.toContain('FMCGIETF')

    settings.hideValues = false
    await act(async () => { root.render(<HistoryPanel scope="all" />) })
    expect(container.querySelector<HTMLInputElement>('.history-input')?.value).toBe('FMCGIETF')
    expect(container.querySelector('.history-purchase')).not.toBeNull()
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
