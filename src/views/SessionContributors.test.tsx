// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { investmentWorkspace, type InvestmentSnapshot } from '../investmentWorkspace'
import type { Position } from '../types'
import { quoteKey } from '../valuation'
import { SessionContributors } from './SessionContributors'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let container: HTMLDivElement

function snapshotFor(items: { symbol: string; quantity?: number; change?: number; type?: Position['type'] }[]) {
  const positions: Position[] = items.map((item, index) => ({
    id: String(index), ticker: item.symbol, name: item.symbol, type: item.type ?? 'stock',
    quantity: item.quantity ?? 1, buyPrice: 100, invested: 100 * (item.quantity ?? 1), lastPrice: 100,
  }))
  return investmentWorkspace.readSnapshot({
    folios: [{ id: 'f', name: 'Portfolio', importedAt: 1, positions }],
    quotes: Object.fromEntries(positions.map((position, index) => [quoteKey(position), {
      price: 100, change: items[index].change, at: Date.parse('2026-10-01T10:00:00Z'), source: 'yahoo',
    }])),
    fxRate: null,
  })
}

async function render(snapshot: InvestmentSnapshot) {
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root!.render(<SessionContributors snapshot={snapshot} formatValue={(amount) => `₹${amount.toFixed(2)}`} />))
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  vi.restoreAllMocks()
})

it('ranks quantity-weighted contributions by absolute impact and reconciles the remaining holdings', async () => {
  const snapshot = snapshotFor([
    { symbol: 'MANY', quantity: 100, change: 2 },
    { symbol: 'FALL', quantity: 10, change: -15 },
    { symbol: 'PRICE', change: 40 },
    { symbol: 'FOUR', change: -30 },
    { symbol: 'FIVE', change: 20 },
    { symbol: 'REST', change: 10 },
    { symbol: 'FLAT', change: 0 },
  ])
  const originalOrder = snapshot.contributions.map((item) => item.symbol)
  await render(snapshot)
  const rows = [...container.querySelectorAll('.session-contributors-row')]
  expect(rows.map((row) => row.querySelector('.session-contributors-name > span')?.textContent))
    .toEqual(['MANY', 'FALL', 'PRICE', 'FOUR', 'FIVE'])
  expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual(['+₹200.00', '−₹150.00', '+₹40.00', '−₹30.00', '+₹20.00'])
  expect(rows[1].className).toContain('row--down')
  expect(container.querySelector('.session-contributors-remainder')?.textContent).toBe('Other reporting holdings 2 holdings+₹10.00')
  expect(container.querySelector('.session-contributors-total')?.textContent).toBe('All holdings combined+₹90.00')
  expect(snapshot.contributions.map((item) => item.symbol)).toEqual(originalOrder)
})

it('shows fewer contributors and labels an incomplete move using only reported finite amounts', async () => {
  const snapshot = snapshotFor([{ symbol: 'UP', change: 5 }, { symbol: 'DOWN', change: -10 }, { symbol: 'MISSING' }, { symbol: 'INVALID', change: 2 }])
  snapshot.contributions.find((item) => item.symbol === 'INVALID')!.dailyContribution = Number.NaN
  snapshot.dailyChange = null
  await render(snapshot)
  expect(container.querySelectorAll('.session-contributors-row')).toHaveLength(2)
  expect(container.textContent).toContain('whole-portfolio move is unavailable until every holding reports')
  expect(container.querySelector('.session-contributors-total')?.textContent).toBe('Reported holdings combined−₹5.00')
  expect(container.textContent).not.toContain('MISSING')
  expect(container.textContent).not.toContain('INVALID')
  expect(container.textContent).not.toContain('NaN')
})

it('distinguishes unchanged reporting holdings from unavailable changes', async () => {
  await render(snapshotFor([{ symbol: 'FLAT', change: 0 }, { symbol: 'ALSO FLAT', change: 0 }]))
  expect(container.textContent).toContain('No rise or fall reported')
  expect(container.querySelector('.session-contributors-total')?.textContent).toBe('All holdings combined₹0.00')
  expect(container.querySelectorAll('.session-contributors-row')).toHaveLength(0)
})

it('gives quote and settings guidance when no change amounts are reported', async () => {
  await render(snapshotFor([{ symbol: 'MISSING' }]))
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Change amounts unavailable')
  expect(container.textContent).toContain('Refresh prices on Overview')
  expect(container.textContent).toContain('enable it in Settings')
  expect(container.querySelector('.session-contributors-total')).toBeNull()
})

it('keeps same-label holdings of different asset types separate without duplicate keys', async () => {
  const errors = vi.spyOn(console, 'error')
  await render(snapshotFor([{ symbol: 'SAME', type: 'stock', change: 5 }, { symbol: 'SAME', type: 'mutual-fund', change: -3 }]))
  expect(container.querySelectorAll('.session-contributors-row')).toHaveLength(2)
  expect(container.textContent).toContain('Equity')
  expect(container.textContent).toContain('Mutual fund')
  expect(errors.mock.calls.flat().join(' ')).not.toContain('same key')
})
