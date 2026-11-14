// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { Position } from '../types'
import { computePortfolioStats, portfolioPulse } from '../valuation'
import { AllocationCard } from './AllocationCard'
import { renderToStaticMarkup } from 'react-dom/server'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('omits empty weight bands while retaining a meaningful no-concentration result and small holdings', () => {
  const positions: Position[] = Array.from({ length: 21 }, (_, index) => ({
    id: String(index), ticker: `HOLD${index}`, name: '', type: 'stock', quantity: 1,
    buyPrice: 100, invested: 100, lastPrice: index === 20 ? 0.01 : 100,
  }))
  const markup = renderToStaticMarkup(<AllocationCard allocations={computePortfolioStats(positions).allocations} pulse={portfolioPulse(positions)} hideValues={false} />)
  expect(markup).toContain('10%+ positions')
  expect(markup).toContain('None')
  expect(markup).not.toContain('10% or more')
  expect(markup).not.toContain('5% to under 10%')
  expect(markup).toContain('Under 5%')
  expect(markup).toContain('21 positions')
  expect(markup).toContain('HOLD20')
})

it('hides allocation geometry and counts, then restores the original allocation when revealed', async () => {
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const positions: Position[] = [900, 100].map((lastPrice, index) => ({
    id: String(index), ticker: `PRIVATE${index}`, name: '', type: 'stock',
    quantity: 1, buyPrice: 100, invested: 100, lastPrice,
  }))
  const allocations = computePortfolioStats(positions).allocations
  const pulse = portfolioPulse(positions)
  const original = JSON.stringify({ allocations, pulse })
  const container = document.createElement('div')
  const root = createRoot(container)
  const render = async (hideValues: boolean) => {
    await act(async () => root.render(<AllocationCard allocations={allocations} pulse={pulse} hideValues={hideValues} />))
  }
  try {
    await render(false)
    expect(container.textContent).toContain('PRIVATE0')
    expect(container.textContent).toContain('90.0%')
    expect(container.querySelector('.alloc-ring-center strong')?.textContent).toBe('2')
    expect(container.querySelector('canvas')).not.toBeNull()
    const details = container.querySelector<HTMLDetailsElement>('details.alloc-more')!
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('Composition details')
    await act(async () => details.querySelector('summary')!.click())
    expect(details.open).toBe(true)
    await render(false)
    expect(details.open).toBe(true)
    await act(async () => details.querySelector('summary')!.click())
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('Weight bands')
    await render(true)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Values are hidden')
    expect(container.textContent).not.toMatch(/PRIVATE|90\.0%|Holdings|10%\+ positions/)
    expect(container.querySelector('canvas, .alloc-ring-center, .alloc-legend, .alloc-summary, .alloc-more')).toBeNull()
    await render(false)
    expect(container.textContent).toContain('PRIVATE0')
    expect(container.textContent).toContain('90.0%')
    expect(container.querySelector('.alloc-ring-center strong')?.textContent).toBe('2')
    expect(container.querySelector('canvas')).not.toBeNull()
    expect(container.querySelector<HTMLDetailsElement>('details.alloc-more')?.open).toBe(false)
    expect(JSON.stringify({ allocations, pulse })).toBe(original)
  } finally {
    await act(async () => root.unmount())
    context.mockRestore()
  }
})
