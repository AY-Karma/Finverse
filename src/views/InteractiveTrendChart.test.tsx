import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InteractiveTrendChart } from './InteractiveTrendChart'

describe('interactive trend chart', () => {
  it('shows the full selected range and keeps an early purchase marker visible', () => {
    const start = new Date('2025-01-01T00:00:00').getTime()
    const rows = Array.from({ length: 250 }, (_, index) => ({
      at: start + index * 86_400_000,
      close: 100 + index,
    }))

    const markup = renderToStaticMarkup(<InteractiveTrendChart
      rows={rows}
      lines={[{ key: 'close', label: 'Close', color: '#5e6ad2' }]}
      valueFormatter={(value) => value.toFixed(2)}
      yAxisLabel="Price"
      appearance="price"
      markers={[{ at: rows[0].at, value: rows[0].close, color: '#f2b53c', label: 'Bought 01 Jan', comparable: true }]}
    />)

    expect(markup).toContain('Compare from Bought 01 Jan')
    expect(markup).toContain('01 Jan 2025')
    expect(markup).toContain('interactive-trend-current')
    expect(markup).not.toContain('Drag to explore')
  })

  it('keeps insight series distinct without coloring the whole gap by the latest result', () => {
    const rows = [
      { at: new Date('2025-01-01T00:00:00').getTime(), portfolio: 0, benchmark: 0 },
      { at: new Date('2025-01-02T00:00:00').getTime(), portfolio: 3, benchmark: 2 },
    ]

    const markup = renderToStaticMarkup(<InteractiveTrendChart
      rows={rows}
      lines={[{ key: 'portfolio', label: 'Portfolio', color: '#828fff' }, { key: 'benchmark', label: 'Benchmark', color: '#e4b35b' }]}
      valueFormatter={(value) => `${value}%`}
      yAxisLabel="Return (%)"
      includeZero
      showArea={false}
      appearance="insight"
    />)

    expect(markup).not.toContain('interactive-trend-gap')
    expect(markup).not.toContain('interactive-trend-area')
    expect(markup.match(/class="interactive-trend-endpoint"/g)).toHaveLength(2)
  })
})
