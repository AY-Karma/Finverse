// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { InstrumentReview } from './InstrumentReview'

const state = vi.hoisted(() => ({
  positions: [{ id: 'holding', ticker: '500112', name: 'State Bank', type: 'stock', exchange: 'NSE', currency: 'INR', providerSymbol: '500112.NS', exchangeSource: 'inferred', identityIssue: 'Confirm the venue', reportedExchange: 'BSE', reportedCurrency: 'INR' }],
  confirmInstrument: vi.fn(),
}))
vi.mock('../useStore', () => ({ useStore: () => state }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => vi.clearAllMocks())

it('previews an explicit listing correction and keeps the edits after a save failure', async () => {
  state.confirmInstrument.mockRejectedValueOnce(new Error('Browser storage is full. Correction not saved.')).mockResolvedValueOnce(undefined)
  const container = document.createElement('div')
  const root = createRoot(container)
  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!
  const field = (label: string) => [...container.querySelectorAll('label')].find((item) => item.firstChild?.textContent === label)!.querySelector('input,select') as HTMLInputElement | HTMLSelectElement
  async function change(label: string, value: string) {
    const element = field(label)
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event(element instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true }))
    })
  }
  try {
    await act(async () => root.render(<InstrumentReview />))
    expect(container.textContent).toContain('1 inferred or unresolved')
    expect(container.textContent).toContain('Statement metadata: exchange BSE, currency INR')
    await act(async () => button('Review listing').click())
    await change('Exchange', 'BSE')
    await change('Provider symbol, optional', '500112.BO')
    await change('ISIN, optional', 'INE062A01020')
    await change('Sector, optional', 'Financials')
    expect(container.textContent).toContain('Reviewed listing: 500112 · Stock · BSE · INR · 500112.BO')
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(state.confirmInstrument).toHaveBeenCalledWith('holding', { ticker: '500112', type: 'stock', exchange: 'BSE', currency: 'INR', providerSymbol: '500112.BO', isin: 'INE062A01020', sector: 'Financials' })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('storage is full')
    expect(field('Exchange').value).toBe('BSE')
    expect(field('Provider symbol, optional').value).toBe('500112.BO')
    expect(field('Sector, optional').value).toBe('Financials')
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Listing correction saved')
  } finally { await act(async () => root.unmount()) }
})
