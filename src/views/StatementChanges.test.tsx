// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Position } from '../types'
import { StatementChanges } from './StatementChanges'

const holding: Position = { id: 'one', ticker: 'PRIVATE', name: 'Private holding', type: 'stock', quantity: 10, invested: 1000, buyPrice: 100, lastPrice: 120, currency: 'INR', exchange: 'NSE' }

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
beforeEach(() => localStorage.clear())

describe('statement change details', () => {
  it('renders quantities and weight shifts as statement comparisons', () => {
    const html = renderToStaticMarkup(<StatementChanges before={[holding]} after={[{ ...holding, quantity: 8 }]} beforeDate="2026-01-01" afterDate="2026-02-01" hideValues={false} />)
    expect(html.replace(/<[^>]*>/g, '')).toContain('Quantity 10 → 8')
    expect(html).toContain('100.00% → 100.00%')
    expect(html).toContain('Statement balances, not a record of trades')
  })

  it('does not retain private holding details in the DOM when values are hidden', () => {
    const html = renderToStaticMarkup(<StatementChanges before={[holding]} after={[]} beforeDate="2026-01-01" hideValues />)
    expect(html).toContain('Statement changes hidden')
    expect(html).not.toContain('PRIVATE')
    expect(html).not.toContain('1,200')
    expect(html).not.toContain('2026-01-01')
  })

  it('uses gain and loss colors for signed weight changes', () => {
    const other = { ...holding, id: 'two', ticker: 'OTHER' }
    const html = renderToStaticMarkup(<StatementChanges before={[holding, other]} after={[{ ...holding, quantity: 15 }, other]} hideValues={false} />)
    expect(html).toContain('<small class="up">+10.00 pts</small>')
    expect(html).toContain('<small class="down">-10.00 pts</small>')
  })

  it('allows dismissal only after opening, persists it, and shows the next update', async () => {
    const container = document.createElement('div')
    let root = createRoot(container)
    const render = (importedAt: number) => act(async () => root.render(<StatementChanges before={[holding]} after={[]} hideValues={false} folio={{ id: 'folio', importedAt }} />))
    try {
      await render(1)
      expect(container.querySelector('[aria-label="Dismiss import changes"]')).toBeNull()
      await act(async () => {
        const details = container.querySelector('details')!
        details.open = true
        details.dispatchEvent(new Event('toggle'))
      })
      expect(container.querySelector('.statement-changes--unread')).toBeNull()
      await act(async () => (container.querySelector('[aria-label="Dismiss import changes"]') as HTMLButtonElement).click())
      expect(container.querySelector('details')).toBeNull()
      await act(async () => root.unmount())
      root = createRoot(container)
      await render(1)
      expect(container.querySelector('details')).toBeNull()
      await render(2)
      expect(container.querySelector('.statement-changes--unread')).not.toBeNull()
      expect(container.querySelector('[aria-label="Dismiss import changes"]')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it('does not treat an opening with privacy enabled as a review', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<StatementChanges before={[holding]} after={[]} hideValues folio={{ id: 'folio', importedAt: 1 }} />))
      await act(async () => {
        const details = container.querySelector('details')!
        details.open = true
        details.dispatchEvent(new Event('toggle'))
      })
      expect(container.textContent).not.toContain('1 holding changed')
      expect(container.querySelector('[aria-label="Dismiss import changes"]')).toBeNull()
      expect(container.textContent).not.toContain('PRIVATE')
    } finally { await act(async () => root.unmount()) }
  })
})
