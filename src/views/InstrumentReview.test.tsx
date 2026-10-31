// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InstrumentReview } from './InstrumentReview'
import type { Position } from '../types'

const { initialPosition, state } = vi.hoisted(() => {
  const initialPosition: Position = { id: 'holding', ticker: '500112', name: 'State Bank', type: 'stock', quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100, exchange: 'NSE', currency: 'INR', providerSymbol: '500112.NS', exchangeSource: 'inferred', identityIssue: 'Confirm the venue', reportedExchange: 'BSE' }
  return { initialPosition, state: { positions: [initialPosition] as Position[], confirmInstrument: vi.fn(), confirmNsePricing: vi.fn(), lookupNse: vi.fn(), settings: { hideValues: false, allowExternalData: true } } }
})
vi.mock('../useStore', () => ({ useStore: () => state }))
vi.mock('../nsePricing', () => ({ loadNsePricingCandidates: (...args: unknown[]) => state.lookupNse(...args) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true }) })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false }) })
})
afterEach(() => { state.positions = [initialPosition]; state.settings.hideValues = false; state.settings.allowExternalData = true; vi.restoreAllMocks(); vi.resetAllMocks() })

it('shows listings needing confirmation before ready listings', async () => {
  state.positions = [
    { ...initialPosition, id: 'ready', name: 'Ready listing', exchangeSource: 'explicit', identityIssue: undefined },
    { ...initialPosition, id: 'pending', name: 'Pending listing' },
  ]
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<InstrumentReview />))
    const rows = [...container.querySelectorAll('.instrument-review-item')]
    expect(rows.map((row) => row.querySelector('.sym')?.textContent)).toEqual(['Pending listing', 'Ready listing'])
    expect(rows.map((row) => row.querySelector('.listing-item-status')?.textContent)).toEqual(['Needs review', 'Ready'])
  } finally { await act(async () => root.unmount()) }
})

it('allows reviewing a mistaken foreign venue when the amounts are explicitly INR', async () => {
  state.positions = [{ ...initialPosition, exchange: 'LSE', currency: 'INR' }]
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<InstrumentReview />))
    const review = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Review listing')!
    expect(review.disabled).toBe(false)
    await act(async () => review.click())
    expect(container.querySelector('form')).not.toBeNull()
  } finally { await act(async () => root.unmount()) }
})

it('explains that unsupported amounts need a corrected INR statement and disables listing edits', async () => {
  state.positions = [{ ...initialPosition, currency: undefined, reportedCurrency: 'EUR' }]
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<InstrumentReview />))
    const review = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Review listing')!
    expect(review.disabled).toBe(true)
    expect(container.textContent).toContain('Import a corrected INR statement')
    expect(state.confirmInstrument).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})

it('hides listing identities and editing fields while masked, then restores them', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<InstrumentReview />))
    expect(container.textContent).toContain('State Bank')
    state.settings.hideValues = true
    await act(async () => root.render(<InstrumentReview />))
    expect(container.textContent).toContain('Values are hidden')
    expect(container.textContent).not.toMatch(/State Bank|500112/)
    expect(container.querySelector('input, select, .instrument-review-item')).toBeNull()
    state.settings.hideValues = false
    await act(async () => root.render(<InstrumentReview />))
    expect(container.textContent).toContain('State Bank')
  } finally { await act(async () => root.unmount()) }
})

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
    expect(container.textContent).toContain('1 listing needs confirmation')
    expect(container.textContent).toContain('Statement metadata: exchange BSE')
    await act(async () => button('Review listing').click())
    await change('Exchange', 'BSE')
    expect((field('Price symbol, required') as HTMLInputElement).required).toBe(true)
    expect(container.textContent).toContain('Numeric BSE codes need a confirmed price symbol ending in .BO')
    expect(container.textContent).toContain('Reviewed listing: 500112 · Stock · BSE · INR · Price symbol required')
    await change('Price symbol, required', 'SBIN.BO')
    await change('ISIN, optional', 'INE062A01020')
    await change('Sector, optional', 'Financials')
    expect(container.textContent).toContain('Reviewed listing: 500112 · Stock · BSE · INR · SBIN.BO')
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(state.confirmInstrument).toHaveBeenCalledWith('holding', { ticker: '500112', type: 'stock', exchange: 'BSE', currency: 'INR', providerSymbol: 'SBIN.BO', isin: 'INE062A01020', sector: 'Financials' })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('storage is full')
    expect(field('Exchange').value).toBe('BSE')
    expect(field('Price symbol, required').value).toBe('SBIN.BO')
    expect(field('Sector, optional').value).toBe('Financials')
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Listing correction saved')
  } finally { await act(async () => root.unmount()) }
})

it('opens the editor directly below the selected listing and moves it when another listing is selected', async () => {
  state.positions = [initialPosition, { ...initialPosition, id: 'second', ticker: 'SECOND', name: 'Second listing' }, { ...initialPosition, id: 'third', ticker: 'THIRD', name: 'Third listing' }]
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<InstrumentReview />))
    const rows = container.querySelectorAll('.instrument-review-item')
    await act(async () => rows[1].querySelector('button')!.click())
    const editor = container.querySelector('form')!
    expect(editor.parentElement).toBe(rows[1])
    expect(editor.previousElementSibling?.classList.contains('folio-row')).toBe(true)
    expect(editor.parentElement?.nextElementSibling).toBe(rows[2])
    expect(rows[1].querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    await act(async () => rows[0].querySelector('button')!.click())
    expect(container.querySelectorAll('form')).toHaveLength(1)
    expect(container.querySelector('form')?.parentElement).toBe(rows[0])
    expect(rows[1].querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
  } finally { await act(async () => root.unmount()) }
})

it('approves all pending listings with their current defaults, excluding reviewed listings and mutual funds', async () => {
  state.positions = [
    { ...initialPosition, reportedCurrency: undefined },
    { ...initialPosition, id: 'default', ticker: 'DEFAULT', name: 'Default listing', exchange: undefined, providerSymbol: undefined, isin: undefined, sector: undefined, reportedCurrency: undefined },
    { ...initialPosition, id: 'reviewed', exchangeSource: 'explicit', identityIssue: undefined },
    { ...initialPosition, id: 'fund', type: 'mutual-fund' },
  ]
  const container = document.createElement('div')
  const root = createRoot(container)
  state.confirmInstrument.mockImplementation(async (id: string) => {
    state.positions = state.positions.map((position) => position.id === id ? { ...position, exchangeSource: 'explicit', identityIssue: undefined } : position)
    root.render(<InstrumentReview />)
  })
  try {
    await act(async () => root.render(<InstrumentReview />))
    expect(container.querySelector('#instrument-review')?.classList.contains('review-required')).toBe(true)
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Approve all default listings')!.click())
    expect(state.confirmInstrument.mock.calls).toEqual([
      ['holding', { ticker: '500112', type: 'stock', exchange: 'NSE', currency: 'INR', providerSymbol: '500112.NS', isin: '', sector: '' }],
      ['default', { ticker: 'DEFAULT', type: 'stock', exchange: 'OTHER', currency: 'INR', providerSymbol: '', isin: '', sector: '' }],
    ])
    expect(container.querySelector('[role="status"]')?.textContent).toContain('2 default listings approved')
    expect(container.querySelector('#instrument-review')?.classList.contains('review-required')).toBe(false)
    expect(container.textContent).toContain('No listings need review')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Approve all default listings')).toBe(false)
  } finally { await act(async () => root.unmount()) }
})

it('keeps failed listing edits and approves other defaults after a validation failure', async () => {
  state.positions = [{ ...initialPosition, reportedCurrency: undefined }, { ...initialPosition, id: 'second', ticker: 'SECOND', name: 'Second listing', reportedCurrency: undefined }]
  state.confirmInstrument.mockRejectedValueOnce(new Error('The provider symbol conflicts with the exchange.')).mockResolvedValueOnce(undefined)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<InstrumentReview />))
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Review listing')!.click())
    const sector = [...container.querySelectorAll('label')].find((label) => label.firstChild?.textContent === 'Sector, optional')!.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(sector, 'Unsaved sector')
      sector.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Approve all default listings')!.click())
    expect(state.confirmInstrument).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('1 default listing approved')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('1 listing still needs review. State Bank: The provider symbol conflicts with the exchange.')
    expect(container.querySelector('form')).not.toBeNull()
    expect(sector.value).toBe('Unsaved sector')
    expect(state.confirmInstrument.mock.calls[0][1].sector).toBe('')
    expect(container.querySelector('form strong')?.textContent).toBe('State Bank')
    expect(container.querySelector('#instrument-review')?.classList.contains('review-required')).toBe(true)
  } finally { await act(async () => root.unmount()) }
})

it('requires manual currency review before bulk approval can clear unresolved currency metadata', async () => {
  state.positions = [
    { ...initialPosition, id: 'missing', name: 'Unknown currency', exchange: 'LSE', currency: undefined, reportedCurrency: undefined },
    { ...initialPosition, id: 'reported', name: 'Sterling listing', exchange: 'LSE', reportedCurrency: 'GBP' },
  ]
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<InstrumentReview />))
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Approve all default listings')!.click())
    expect(state.confirmInstrument).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('2 listings still need review')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Import a corrected INR statement')
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(state.positions[0].currency).toBeUndefined()
    expect(state.positions[1].reportedCurrency).toBe('GBP')
    expect(container.querySelector('#instrument-review')?.classList.contains('review-required')).toBe(true)
  } finally { await act(async () => root.unmount()) }
})

const nseCandidate = { exchange: 'NSE' as const, isin: 'INE062A01020', type: 'stock' as const, providerSymbol: 'SBIN.NS' }
const bseHolding: Position = { ...initialPosition, exchange: 'BSE', reportedExchange: undefined, ticker: '500112', providerSymbol: 'SBIN.BO', isin: nseCandidate.isin }

async function mountNseReview() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<InstrumentReview />))
  return {
    container, root,
    button: (label: string) => [...container.querySelectorAll('button')].find((button) => button.textContent === label)!,
    close: async () => { await act(async () => root.unmount()); container.remove() },
  }
}

it('requires acknowledgment before switching BSE pricing and leaves unmatched holdings for review', async () => {
  state.positions = [bseHolding, { ...bseHolding, id: 'missing', name: 'Unidentified holding', isin: undefined }]
  state.lookupNse.mockResolvedValue([nseCandidate])
  state.confirmNsePricing.mockResolvedValue(undefined)
  const view = await mountNseReview()
  try {
    await act(async () => view.button('Auto-approve NSE matches').click())
    expect(state.lookupNse.mock.calls[0][0]).toEqual([bseHolding])
    expect(state.confirmNsePricing).not.toHaveBeenCalled()
    expect(view.container.querySelector('dialog')!.open).toBe(true)
    expect(view.container.querySelector('dialog')!.textContent).toContain('SBIN.NS')
    expect(view.container.querySelector('dialog')!.textContent).toContain('1 unmatched holding needs individual review')
    await act(async () => view.button('Use NSE prices & approve').click())
    expect(state.confirmNsePricing).toHaveBeenCalledExactlyOnceWith('holding', nseCandidate)
    expect(state.confirmInstrument).not.toHaveBeenCalled()
    expect(view.container.querySelector('dialog')!.open).toBe(false)
    expect(view.container.querySelector('[role="status"]')!.textContent).toContain('1 NSE pricing match approved. 1 needs review.')
    expect(bseHolding.exchange).toBe('BSE')
  } finally { await view.close() }
})

it('approves an exact NSE match directly and reports a failed save without losing the holding', async () => {
  state.positions = [{ ...bseHolding, ticker: 'SBIN', exchange: 'NSE', providerSymbol: 'SBIN.NS' }]
  state.lookupNse.mockResolvedValue([nseCandidate])
  state.confirmNsePricing.mockRejectedValueOnce(new Error('Storage is full.')).mockResolvedValueOnce(undefined)
  const view = await mountNseReview()
  try {
    await act(async () => view.button('Auto-approve NSE matches').click())
    expect(view.container.querySelector('dialog')!.open).toBe(false)
    expect(state.confirmNsePricing).toHaveBeenCalledOnce()
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('Storage is full')
    await act(async () => view.button('Auto-approve NSE matches').click())
    expect(state.confirmNsePricing).toHaveBeenCalledTimes(2)
    expect(view.container.querySelector('[role="status"]')!.textContent).toContain('1 NSE pricing match approved')
  } finally { await view.close() }
})

it('keeps ambiguous or wrong-ISIN candidates out of auto-approval', async () => {
  state.positions = [bseHolding]
  state.lookupNse.mockResolvedValue([nseCandidate, { ...nseCandidate, providerSymbol: 'OTHER.NS' }, { ...nseCandidate, isin: 'INE009A01021' }])
  const view = await mountNseReview()
  try {
    await act(async () => view.button('Auto-approve NSE matches').click())
    expect(state.confirmNsePricing).not.toHaveBeenCalled()
    expect(view.container.querySelector('dialog')!.open).toBe(false)
    expect(view.container.querySelector('[role="status"]')!.textContent).toContain('0 NSE pricing matches approved. 1 needs review.')
  } finally { await view.close() }
})

it('cancels lookup when external data is disabled and ignores a late response', async () => {
  state.positions = [bseHolding]
  let resolve!: (value: unknown) => void
  state.lookupNse.mockImplementation(() => new Promise((done) => { resolve = done }))
  const view = await mountNseReview()
  try {
    await act(async () => view.button('Auto-approve NSE matches').click())
    const signal = state.lookupNse.mock.calls[0][1] as AbortSignal
    state.settings.allowExternalData = false
    await act(async () => view.root.render(<InstrumentReview />))
    expect(signal.aborted).toBe(true)
    await act(async () => resolve([nseCandidate]))
    expect(state.confirmNsePricing).not.toHaveBeenCalled()
    expect(view.container.querySelector('dialog')!.open).toBe(false)
    expect(view.button('Auto-approve NSE matches').disabled).toBe(true)
  } finally { await view.close() }
})

it('opens individual review without saving when the NSE acknowledgment is declined', async () => {
  state.positions = [bseHolding]
  state.lookupNse.mockResolvedValue([nseCandidate])
  const view = await mountNseReview()
  try {
    await act(async () => view.button('Auto-approve NSE matches').click())
    await act(async () => view.button('Review individually').click())
    expect(view.container.querySelector('dialog')!.open).toBe(false)
    expect(state.confirmNsePricing).not.toHaveBeenCalled()
    expect(view.container.querySelector('form')?.textContent).toContain('State Bank')
    const exchangeLabel = [...view.container.querySelectorAll('form label')].find((label) => label.firstChild?.textContent === 'Exchange')!
    expect(exchangeLabel.querySelector('select')!.value).toBe('BSE')
  } finally { await view.close() }
})

it('labels saved NSE pricing without rewriting the displayed imported exchange', async () => {
  state.positions = [{ ...bseHolding, pricingListing: { ...nseCandidate, source: 'nse-master', verifiedAt: Date.now() } }]
  const view = await mountNseReview()
  try {
    expect(view.container.textContent).toContain('Priced via NSE')
    expect(view.container.textContent).toContain('Imported exchange: BSE')
    expect(view.container.querySelector('.listing-facts')!.textContent).toContain('SBIN.NS')
    expect([...view.container.querySelectorAll('button')].some((button) => button.textContent === 'Auto-approve NSE matches')).toBe(false)
  } finally { await view.close() }
})
