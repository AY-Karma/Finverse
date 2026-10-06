import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { calculatePortfolioRisk } from '../portfolioRisk'
import { WorstDrawdownChart } from './WorstDrawdownChart'

const point = (date: string, value: number) => ({ at: Date.parse(`${date}T00:00:00+05:30`), value })
const formatValue = (value: number) => `INR ${value.toFixed(2)}`

function render(points: { at: number; value: number }[]) {
  return renderToStaticMarkup(<WorstDrawdownChart points={points} risk={calculatePortfolioRisk(points)} formatValue={formatValue} />)
}

describe('worst drawdown chart', () => {
  it('marks the recovered historical peak and trough, with percentage units and real values', () => {
    const markup = render([
      point('2026-09-21', 100),
      point('2026-09-22', 90),
      point('2026-09-23', 80),
      point('2026-09-24', 120),
    ])

    expect(markup.match(/<circle /g)).toHaveLength(2)
    expect(markup).toContain('Peak: INR 100.00, 21 Sept 2026, 0.0% baseline')
    expect(markup).toContain('Trough: INR 80.00, 23 Sept 2026, -20.0% from peak')
    expect(markup).toContain('role="img"')
    expect(markup).toContain('measured in percent')
    expect(markup).toContain('20.0% fall')
    expect(markup).not.toContain('INR 120.00')
    const path = markup.match(/class="worst-drawdown-line" d="([^"]+)"/)?.[1]
    expect(path?.match(/[ML]/g)).toHaveLength(3)
  })

  it('retains unsampled extrema and every observation inside the drawdown interval', () => {
    const start = Date.parse('2026-01-01T00:00:00+05:30')
    const points = Array.from({ length: 420 }, (_, index) => ({ at: start + index * 86_400_000, value: 100 }))
    points[119].value = 120
    points[121].value = 110
    points[247].value = 60
    const markup = render(points)

    expect(markup).toContain('Peak: INR 120.00')
    expect(markup).toContain('Trough: INR 60.00')
    expect(markup).toContain('-50.0% from peak')
    const path = markup.match(/class="worst-drawdown-line" d="([^"]+)"/)?.[1]
    expect(path?.match(/[ML]/g)).toHaveLength(129)
    expect(markup.match(/<circle /g)).toHaveLength(2)
  })

  it('accepts a peak timestamp of zero', () => {
    const markup = render([{ at: 0, value: 100 }, { at: 86_400_000, value: 75 }])
    expect(markup).toContain('01 Jan 1970')
    expect(markup).toContain('25.0% fall')
    expect(markup.match(/<circle /g)).toHaveLength(2)
  })

  it('explains missing history and histories without a decline without inventing dates or loading status', () => {
    const missing = render([])
    const increasing = render([point('2026-09-21', 100), point('2026-09-22', 110)])
    const flat = render([point('2026-09-21', 100), point('2026-09-22', 100)])

    expect(missing).toContain('At least two historical observations')
    expect(increasing).toContain('No decline from an earlier peak')
    expect(flat).toContain('No decline from an earlier peak')
    for (const markup of [missing, increasing, flat]) {
      expect(markup).not.toContain('<svg')
      expect(markup).not.toContain('<time')
      expect(markup).not.toContain('loading')
    }
  })

  it('shows an unavailable state when the selected extremum is absent', () => {
    const points = [point('2026-09-21', 100), point('2026-09-22', 75), point('2026-09-23', 80)]
    const risk = calculatePortfolioRisk(points)
    const markup = renderToStaticMarkup(<WorstDrawdownChart points={points.slice(1)} risk={risk} formatValue={formatValue} />)
    expect(markup).toContain('Peak and trough observations are unavailable')
    expect(markup).not.toContain('<svg')
  })
})
