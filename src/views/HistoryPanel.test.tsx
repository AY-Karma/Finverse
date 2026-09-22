// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPoint } from '../live'
import { HistoryPanel } from './HistoryPanel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { history } = vi.hoisted(() => ({
  history: vi.fn<(_position: unknown, _from: Date, _to: Date) => Promise<HistoryPoint[]>>(),
}))

vi.mock('../marketData', () => ({ marketData: { history } }))
vi.mock('../useStore', () => ({
  useStore: () => ({
    positions: [{ id: 'fund', ticker: 'FMCGIETF', name: 'FMCGIETF', type: 'etf', quantity: 1, buyPrice: 100 }],
    settings: { allowExternalData: true },
  }),
}))
vi.mock('./InteractiveTrendChart', () => ({ InteractiveTrendChart: () => <div data-testid="history-chart" /> }))

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
})

describe('Holding Price History', () => {
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
