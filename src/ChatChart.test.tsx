import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatChart } from './ChatChart'

describe('chat charts', () => {
  it.each(['bar', 'line', 'pie'] as const)('renders an accessible %s chart with its values', (kind) => {
    const markup = renderToStaticMarkup(
      <ChatChart
        spec={{ kind, title: 'Allocation', data: [{ label: 'Equity', value: 60 }, { label: 'Funds', value: 40 }] }}
      />,
    )

    expect(markup).toContain('role="img"')
    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain('Allocation')
    expect(markup).toContain('Equity')
    expect(markup).toContain('₹60')
  })
})
