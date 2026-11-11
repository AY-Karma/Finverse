// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { calculateHoldingMarketMoves, type HoldingPriceHistories } from '../holdingMarketMoves'
import type { Position } from '../types'
import { quoteKey } from '../valuation'
import { HoldingMarketMoveResults, HoldingMarketMoves } from './HoldingMarketMoves'
import { marketData } from '../marketData'

vi.mock('./DitherBar', () => ({ DitherBar: () => <span data-contribution-bar /> }))
vi.mock('../marketData', () => ({ marketData: { history: vi.fn() } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let container: HTMLDivElement

function resultFor(items: { name: string; quantity?: number; priceChange: number }[]) {
  const positions: Position[] = items.map((item, index) => ({
    id: String(index), ticker: item.name, name: item.name, type: 'stock', quantity: item.quantity ?? 1,
    buyPrice: 100, invested: 100 * (item.quantity ?? 1), lastPrice: 100,
  }))
  const histories: HoldingPriceHistories = Object.fromEntries(positions.map((position, index) => [quoteKey(position), [
    { date: '2026-10-28', close: 100 }, { date: '2026-11-04', close: 100 + items[index].priceChange },
  ]]))
  return calculateHoldingMarketMoves(positions, {}, histories, '2026-10-29', '2026-11-04')
}

async function render(result: ReturnType<typeof resultFor>, compact = true) {
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root!.render(<HoldingMarketMoveResults result={result} from="2026-10-29" compact={compact} />))
}

async function toggleDetails() {
  await act(async () => {
    const details = container.querySelector<HTMLDetailsElement>('.holding-move-details')!
    const toggled = new Promise((resolve) => details.addEventListener('toggle', resolve, { once: true }))
    details.querySelector('summary')!.click()
    await toggled
  })
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  vi.restoreAllMocks()
})

it('retains successful period prices when retrying missing holdings fails for an already loaded holding', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-04T12:00:00Z'))
  const positions: Position[] = ['LOADED', 'MISSING'].map((ticker) => ({
    id: ticker, ticker, name: ticker, type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100,
  }))
  const prices = [{ date: '2026-10-30', close: 100 }, { date: '2026-11-04', close: 110 }]
  vi.mocked(marketData.history).mockResolvedValueOnce(prices).mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(prices)
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root!.render(<HoldingMarketMoves positions={positions} quotes={{}} allowExternalData range="month" customFrom="" />))
  expect(container.textContent).toContain('1 of 2 holdings covered')
  await act(async () => container.querySelector<HTMLButtonElement>('.benchmark-retry')!.click())
  expect(container.textContent).toContain('2 of 2 holdings covered')
  expect(container.querySelector('.holding-move-summary strong')?.textContent).toBe('₹20.00')
})

it('ranks the five largest quantity-weighted impacts and reconciles the remainder', async () => {
  const result = resultFor([
    { name: 'MANY', quantity: 100, priceChange: 2 }, { name: 'FALL', quantity: 10, priceChange: -15 },
    { name: 'PRICE', priceChange: 40 }, { name: 'FOUR', priceChange: -30 }, { name: 'FIVE', priceChange: 20 },
    { name: 'REST', priceChange: 10 }, { name: 'SMALL', priceChange: -5 }, { name: 'FLAT', priceChange: 0 },
  ])
  const originalOrder = result.rows.map((row) => row.key)
  await render(result)
  const rows = [...container.querySelectorAll('.holding-move-ranked-row')]
  expect(rows.map((row) => row.querySelector('.holding-move-name')?.textContent)).toEqual(['MANY', 'FALL', 'PRICE', 'FOUR', 'FIVE'])
  expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual(['+₹200.00', '−₹150.00', '+₹40.00', '−₹30.00', '+₹20.00'])
  expect(container.querySelector('.holding-move-remainder')?.textContent).toBe('Other holdings 2+₹5.00')
  expect(result.totalChange).toBe(85)
  expect(result.rows.slice(0, 5).reduce((sum, row) => sum + row.change, 0) + 5).toBe(result.totalChange)
  expect(result.rows.map((row) => row.key)).toEqual(originalOrder)
  expect(container.querySelector('.holding-move-summary')).toBeNull()
  expect(container.textContent).not.toMatch(/holdings covered|through latest available market prices/)

  const disclosure = container.querySelector<HTMLDetailsElement>('.holding-move-details')!
  expect(disclosure.open).toBe(false)
  expect(disclosure.querySelector('table')).toBeNull()
  await toggleDetails()
  expect(disclosure.open).toBe(true)
  expect(container.querySelectorAll('tbody tr')).toHaveLength(8)
  expect(container.querySelector('tbody')?.textContent).toContain('FLAT+0.00%₹0.00')
  expect([...container.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(['Holding', 'Price change', 'Impact'])
  expect(container.textContent).not.toMatch(/2026-10-28|2026-10-29|2026-11-04/)
})

it('keeps a one-sided compact breakdown free of empty gain or loss columns', async () => {
  await render(resultFor([{ name: 'UP', priceChange: 4 }]))
  expect(container.querySelectorAll('.holding-move-ranked-row')).toHaveLength(1)
  expect(container.querySelector('.contribution-columns')).toBeNull()
  expect(container.textContent).not.toMatch(/Positive moves|Negative moves|No positive|No negative/)
  expect(container.querySelector('.holding-move-remainder')).toBeNull()
})

it('opens calculation help on click and closes it with Escape', async () => {
  await render(resultFor([{ name: 'UP', priceChange: 4 }]))
  const help = container.querySelector<HTMLButtonElement>('[aria-label="How market moves are calculated"]')!
  expect(help.getAttribute('aria-expanded')).toBe('false')
  await act(async () => help.click())
  expect(help.getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelector('[role="tooltip"]')?.textContent).toContain('Past trades, payments and quantity changes are excluded')
  await act(async () => help.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(help.getAttribute('aria-expanded')).toBe('false')
})

it('distinguishes unchanged holdings from unavailable prices and retains their rows', async () => {
  await render(resultFor([{ name: 'FLAT', priceChange: 0 }, { name: 'ALSOFLAT', priceChange: 0 }]))
  expect(container.textContent).toContain('No rise or fall over this period.')
  expect(container.textContent).not.toContain('unavailable')
  expect(container.querySelector('.holding-move-ranked-list')).toBeNull()
  expect(container.querySelector('.holding-move-remainder')).toBeNull()
  await toggleDetails()
  const impacts = [...container.querySelectorAll('tbody td:last-child')]
  expect(impacts.map((cell) => cell.textContent)).toEqual(['₹0.00', '₹0.00'])
  expect(impacts.every((cell) => !cell.classList.contains('up') && !cell.classList.contains('down'))).toBe(true)
})

it('retains the total, dates and coverage for the standalone contribution panel', async () => {
  await render(resultFor([{ name: 'UP', quantity: 2, priceChange: 4 }]), false)
  expect(container.querySelector('.holding-move-summary > strong')?.textContent).toBe('₹8.00')
  expect(container.querySelector('.holding-move-summary')?.textContent).toContain('2026-10-29 through latest available market prices')
  expect(container.textContent).toContain('1 of 1 holdings covered')
  expect(container.querySelector('.contribution-columns')).not.toBeNull()
})
