// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { Position } from '../types'
import { computePortfolioStats, portfolioPulse } from '../valuation'
import { AllocationCard } from './AllocationCard'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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
    expect(container.querySelector('details, summary')).toBeNull()
    expect(container.textContent).not.toContain('More detail')
    expect(container.querySelectorAll('.alloc-more-section')).toHaveLength(3)
    expect(container.textContent).not.toContain('Large positions')
    await render(true)
    expect(container.textContent).toContain('Values are hidden')
    expect(container.textContent).not.toMatch(/PRIVATE|90\.0%|Holdings|10%\+ positions/)
    expect(container.querySelector('canvas, .alloc-ring-center, .alloc-more')).toBeNull()
    await render(false)
    expect(container.textContent).toContain('PRIVATE0')
    expect(container.textContent).toContain('90.0%')
    expect(container.querySelector('.alloc-ring-center strong')?.textContent).toBe('2')
    expect(container.querySelector('canvas')).not.toBeNull()
    expect(JSON.stringify({ allocations, pulse })).toBe(original)
  } finally {
    await act(async () => root.unmount())
    context.mockRestore()
  }
})
