// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { Position } from '../types'
import { computePortfolioStats } from '../valuation'
import { AllocationCard } from './AllocationCard'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('hides allocation geometry and counts, then restores the original allocation when revealed', async () => {
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const positions: Position[] = [900, 100].map((lastPrice, index) => ({
    id: String(index), ticker: `PRIVATE${index}`, name: '', type: 'stock',
    quantity: 1, buyPrice: 100, invested: 100, lastPrice,
  }))
  const allocations = computePortfolioStats(positions).allocations
  const original = JSON.stringify(allocations)
  const container = document.createElement('div')
  const root = createRoot(container)
  const render = async (hideValues: boolean) => {
    await act(async () => root.render(<AllocationCard allocations={allocations} hideValues={hideValues} />))
  }
  try {
    await render(false)
    expect(container.textContent).toContain('PRIVATE0')
    expect(container.textContent).toContain('90.0%')
    expect(container.querySelector('.alloc-ring-center strong')?.textContent).toBe('2')
    expect(container.querySelector('.allocation-donut-slice')).not.toBeNull()
    await render(true)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Values are hidden')
    expect(container.textContent).not.toMatch(/PRIVATE|90\.0%|Holdings/)
    expect(container.querySelector('.allocation-donut, .alloc-ring-center')).toBeNull()
    await render(false)
    expect(container.textContent).toContain('PRIVATE0')
    expect(container.textContent).toContain('90.0%')
    expect(container.querySelector('.alloc-ring-center strong')?.textContent).toBe('2')
    expect(container.querySelector('.allocation-donut-slice')).not.toBeNull()
    expect(JSON.stringify(allocations)).toBe(original)
  } finally {
    await act(async () => root.unmount())
    context.mockRestore()
  }
})
