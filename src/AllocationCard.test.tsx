import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PortfolioPulse } from './valuation'
import { AllocationCard } from './views/AllocationCard'

const pulse: PortfolioPulse = {
  up: 14,
  down: 6,
  flat: 0,
  avgWinPct: 57.2,
  avgLossPct: -15,
  best: { symbol: 'KRN', pct: 450.3 },
  worst: { symbol: 'TMPV', pct: -34.7 },
  equityValue: 228_362,
  mutualValue: 271_152,
  equityCount: 18,
  mutualCount: 2,
  bands: { heavy: 3, mid: 1, light: 16 },
  bandWeight: { heavy: 70, mid: 6, light: 24 },
  bandMembers: {
    heavy: ['Nippon India Small Cap Fund Direct Growth', 'Quant Mid Cap Fund Direct Growth', 'KRN'],
    mid: ['ITBEES'],
    light: [],
  },
}

describe('allocation card', () => {
  it('shows three compact takeaways with supporting figures in one disclosure', () => {
    const markup = renderToStaticMarkup(
      <AllocationCard
        allocations={[
          { symbol: 'Nippon India Small Cap Fund Direct Growth', value: 200_000, type: 'mutual-fund' },
          { symbol: 'KRN', value: 100_000, type: 'stock' },
        ]}
        hideValues={false}
        currency="INR"
        pulse={pulse}
      />,
    )

    expect(markup.match(/class="alloc-summary-row"/g)).toHaveLength(3)
    expect(markup).toContain('70% in profit')
    expect(markup).toContain('46% equity')
    expect(markup).toContain('54% funds')
    expect(markup).toContain('3 hold')
    expect(markup).toContain('<details class="alloc-more"><summary>More detail</summary>')
    expect(markup).toContain('Average gain')
    expect(markup).toContain('Weight bands')
    expect(markup).toContain('Quant Mid Cap Fund Direct Growth')
  })

  it('masks holding names and percentages in the summary and detail', () => {
    const markup = renderToStaticMarkup(
      <AllocationCard
        allocations={[{ symbol: 'Private Fund', value: 100_000, type: 'mutual-fund' }]}
        hideValues
        currency="INR"
        pulse={{ ...pulse, best: { symbol: 'Private Fund', pct: 50 } }}
      />,
    )

    const visibleText = markup.replace(/<[^>]+>/g, '')
    expect(markup).not.toContain('Private Fund')
    expect(visibleText).not.toContain('70%')
    expect(markup).toContain('••••••')
  })
})
