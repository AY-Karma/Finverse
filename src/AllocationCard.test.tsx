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
  it('keeps full and compact summaries with expandable large-position detail', () => {
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

    expect(markup).toContain('70% of priced holdings in profit')
    expect(markup).toContain('70% in profit')
    expect(markup).toContain('3 positions at 10%+')
    expect(markup).toContain('3 at 10%+')
    expect(markup).toContain('See large positions')
    expect(markup).toContain('Quant Mid Cap Fund Direct Growth')
  })
})
