import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InteractiveTrendChart } from './InteractiveTrendChart'

describe('interactive trend chart', () => {
  it('closes each area segment under its own line instead of drawing diagonal fills across gaps', () => {
    const markup = renderToStaticMarkup(<InteractiveTrendChart
      rows={[{ at: 1, close: 30 }, { at: 2, close: 35 }, { at: 3 }, { at: 4, close: 32 }, { at: 5, close: 36 }]}
      lines={[{ key: 'close', label: 'Close', color: '#5e6ad2' }]}
      valueFormatter={String} yAxisLabel="Price" appearance="price"
    />)
    const line = markup.match(/<path d="([^"]+)" class="interactive-trend-line"/)![1]
    const area = markup.match(/<path d="([^"]+)"[^>]*class="interactive-trend-area"/)![1]
    const lineSegments = line.match(/M[^M]+/g)!
    const areaSegments = area.match(/M[^Z]+Z/g)!
    expect(areaSegments).toHaveLength(lineSegments.length)
    for (const [index, segment] of lineSegments.entries()) {
      const coordinates = [...segment.matchAll(/[ML]([\d.]+),[\d.]+/g)].map((match) => match[1])
      expect(areaSegments[index]).toBe(`${segment.trim()} L${coordinates[coordinates.length - 1]},292.0 L${coordinates[0]},292.0 Z`)
    }
  })

  it('connects only opted-in series across missing observations without extending their endpoints', () => {
    const start = Date.parse('2026-09-01T00:00:00Z')
    const markup = renderToStaticMarkup(<InteractiveTrendChart
      rows={[
        { at: start, portfolio: 0 },
        { at: start + 86_400_000, portfolio: 1, benchmark: 0 },
        { at: start + 2 * 86_400_000 },
        { at: start + 3 * 86_400_000, portfolio: 3, benchmark: 2 },
        { at: start + 4 * 86_400_000, portfolio: 4 },
      ]}
      lines={[{ key: 'portfolio', label: 'Portfolio', color: '#828fff' }, { key: 'benchmark', label: 'Benchmark', color: '#e4b35b', connectGaps: true }]}
      valueFormatter={(value) => `${value}%`}
      yAxisLabel="Return (%)"
      appearance="insight"
    />)
    const portfolioPath = markup.match(/<path d="([^"]+)" class="interactive-trend-line" stroke="#828fff"/)?.[1]
    const benchmarkPath = markup.match(/<path d="([^"]+)" class="interactive-trend-line" stroke="#e4b35b"/)?.[1]
    expect(portfolioPath?.match(/M/g)).toHaveLength(2)
    expect(benchmarkPath?.match(/M/g)).toHaveLength(1)
    expect(benchmarkPath?.match(/L/g)).toHaveLength(1)
  })

  it('keeps an average-cost pointer within the chart even when it is outside the historical price range', () => {
    const at = +new Date('2026-09-21T00:00:00')
    const markup = renderToStaticMarkup(<InteractiveTrendChart
      rows={[{ at, close: 150 }, { at: at + 86_400_000, close: 160 }]}
      lines={[{ key: 'close', label: 'Close', color: '#5e6ad2' }]}
      valueFormatter={(value) => value.toFixed(2)}
      yAxisLabel="Price"
      appearance="price"
      markers={[{ at, value: 100, color: '#f2b53c', label: 'Avg cost', description: 'Average cost reference, not a purchase date.' }]}
    />)
    const markerY = Number(markup.match(/<circle[^>]*cy="([^"]+)"[^>]*class="interactive-trend-marker-dot"/)?.[1])
    expect(markerY).toBeGreaterThanOrEqual(28)
    expect(markerY).toBeLessThanOrEqual(292)
    expect(markup).toContain('<title>Average cost reference, not a purchase date.</title>')
    expect(markup).toContain('Avg cost')
    expect(markup).not.toContain('Select buy point')
  })

  it('shows the latest price window with navigation and hides markers outside that window', () => {
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

    expect(markup).not.toContain('Compare from Bought 01 Jan')
    expect(markup).not.toContain('01 Jan 2025')
    expect(markup).toContain('interactive-trend-current')
    expect(markup).toContain('Drag to explore')
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
