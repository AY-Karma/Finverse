// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Position } from '../types'
import { FundSchemeReview } from './FundSchemeReview'

const state = vi.hoisted(() => ({
  positions: [] as Position[],
  settings: { allowExternalData: true, hideValues: false }, confirmFundScheme: vi.fn(), search: vi.fn(),
}))
vi.mock('../useStore', () => ({ useStore: () => state }))
vi.mock('../marketData', () => ({ marketData: { reviewFundScheme: state.search } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
beforeEach(() => {
  vi.clearAllMocks()
  state.positions = [{ id: 'fund', name: 'Example Equity Fund Direct IDCW', ticker: 'Example', type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 }]
  state.settings.allowExternalData = true
  state.settings.hideValues = false
})

it('hides fund identities and aborts an in-flight lookup when masking turns on', async () => {
  let resolveSearch!: (value: unknown) => void
  state.search.mockImplementation(() => new Promise((resolve) => { resolveSearch = resolve }))
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FundSchemeReview />))
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Find scheme')!.click())
    const signal = state.search.mock.calls[0][1] as AbortSignal
    state.settings.hideValues = true
    await act(async () => root.render(<FundSchemeReview />))
    expect(signal.aborted).toBe(true)
    expect(container.innerHTML).not.toContain(state.positions[0].name)
    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
    await act(async () => resolveSearch({ candidates: [{ schemeCode: 987654, schemeName: 'Private provider scheme' }], reason: 'Private match' }))
    expect(container.innerHTML).not.toContain('Private')
    state.settings.hideValues = false
    await act(async () => root.render(<FundSchemeReview />))
    expect(container.querySelector('[aria-label="Review fund scheme"]')).toBeNull()
    expect(state.confirmFundScheme).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})

it('requires explicit confirmation, blocks Growth for an IDCW holding and retains review after a save failure', async () => {
  const growth = { schemeCode: 1, schemeName: 'Example Equity Fund Direct Plan Growth Option' }
  const idcw = { schemeCode: 2, schemeName: 'Example Equity Fund Direct Plan IDCW Option' }
  state.search.mockResolvedValue({ status: 'review', candidates: [growth, idcw], reason: 'Choose the exact scheme.' })
  state.confirmFundScheme.mockRejectedValueOnce(new Error('Storage is full. Scheme not saved.')).mockResolvedValueOnce(undefined)
  const container = document.createElement('div')
  const root = createRoot(container)
  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!
  try {
    await act(async () => root.render(<FundSchemeReview />))
    await act(async () => button('Find scheme').click())
    expect(state.confirmFundScheme).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLOptionElement>('option[value="1"]')!.disabled).toBe(true)
    const select = container.querySelector('select')!
    await act(async () => { select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => button('Confirm scheme').click())
    expect(container.textContent).toContain('Scheme not saved')
    expect(container.querySelector('[aria-label="Review fund scheme"]')).not.toBeNull()
    await act(async () => button('Confirm scheme').click())
    expect(state.confirmFundScheme).toHaveBeenLastCalledWith('fund', idcw)
    expect(container.textContent).toContain('NAV and history will use this scheme')
  } finally { await act(async () => root.unmount()) }
})

it.each([{ reportedCurrency: 'EUR' }, { currency: 'INR' as const, reportedCurrency: 'EUR' }])('blocks scheme search and confirmation for an unsupported fund currency %j', async (metadata) => {
  state.positions = [{ ...state.positions[0], ...metadata }]
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FundSchemeReview />))
    const search = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Find scheme')!
    expect(search.disabled).toBe(true)
    expect(container.textContent).toContain('MFAPI supports INR mutual funds only')
    await act(async () => search.click())
    expect(state.search).not.toHaveBeenCalled()
    expect(state.confirmFundScheme).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="Review fund scheme"]')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})

it('closes a provider confirmation when the holding currency changes after the search', async () => {
  const idcw = { schemeCode: 2, schemeName: 'Example Equity Fund Direct Plan IDCW Option' }
  state.search.mockResolvedValue({ status: 'matched', match: idcw, candidates: [idcw], reason: 'One complete scheme matches.' })
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FundSchemeReview />))
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Find scheme')!.click())
    expect(container.querySelector('[aria-label="Review fund scheme"]')).not.toBeNull()
    state.positions = [{ ...state.positions[0], reportedCurrency: 'EUR' }]
    await act(async () => root.render(<FundSchemeReview />))
    expect(container.querySelector('[aria-label="Review fund scheme"]')).toBeNull()
    expect(state.confirmFundScheme).not.toHaveBeenCalled()
    expect(container.textContent).toContain('MFAPI supports INR mutual funds only')
  } finally { await act(async () => root.unmount()) }
})

it('highlights scheme review only while funds need confirmation', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FundSchemeReview />))
    expect(container.querySelector('details')!.classList.contains('listing-review--pending')).toBe(true)
    expect(container.querySelector('summary')!.textContent).toContain('1 scheme needs your confirmation')
    state.positions = [{ ...state.positions[0], mfScheme: { code: 2, name: 'Example Equity Fund Direct IDCW', source: 'confirmed' } }]
    await act(async () => root.render(<FundSchemeReview />))
    expect(container.querySelector('details')!.classList.contains('listing-review--pending')).toBe(false)
    expect(container.querySelector('summary')!.textContent).toContain('No schemes need review')
  } finally { await act(async () => root.unmount()) }
})


it('auto-approves only exact schemes and skips confirmed or unsupported holdings', async () => {
  const exact = { schemeCode: 2, schemeName: 'Example Equity Fund Direct Plan IDCW Option' }
  const ambiguous = { schemeCode: 3, schemeName: 'Another Equity Fund Direct Plan Growth Option' }
  state.positions = [
    state.positions[0],
    { ...state.positions[0], id: 'ambiguous', name: 'Another Equity Fund Direct Growth' },
    { ...state.positions[0], id: 'confirmed', mfScheme: { code: 2, name: exact.schemeName, source: 'confirmed' } },
    { ...state.positions[0], id: 'unsupported', reportedCurrency: 'EUR' },
  ]
  state.search.mockResolvedValueOnce({ status: 'matched', candidates: [exact], match: exact })
    .mockResolvedValueOnce({ status: 'review', candidates: [ambiguous, { ...ambiguous, schemeCode: 4 }] })
  state.confirmFundScheme.mockResolvedValue(undefined)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FundSchemeReview />))
    const approve = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Auto-approve schemes')!
    await act(async () => approve.click())
    expect(state.search).toHaveBeenCalledTimes(2)
    expect(state.confirmFundScheme).toHaveBeenCalledExactlyOnceWith('fund', exact)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('1')
  } finally { await act(async () => root.unmount()) }
})

it('disables bulk approval when external market data is off', async () => {
  state.settings.allowExternalData = false
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FundSchemeReview />))
    const approve = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Auto-approve schemes')!
    expect(approve.disabled).toBe(true)
    await act(async () => approve.click())
    expect(state.search).not.toHaveBeenCalled()
    expect(state.confirmFundScheme).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})

it('continues bulk approval after a save failure and reports the failure', async () => {
  const exact = { schemeCode: 2, schemeName: 'Example Equity Fund Direct Plan IDCW Option' }
  state.positions = [state.positions[0], { ...state.positions[0], id: 'second' }]
  state.search.mockResolvedValue({ status: 'matched', candidates: [exact], match: exact })
  state.confirmFundScheme.mockRejectedValueOnce(new Error('Storage is full.')).mockResolvedValueOnce(undefined)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FundSchemeReview />))
    const approve = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Auto-approve schemes')!
    await act(async () => approve.click())
    expect(state.confirmFundScheme).toHaveBeenCalledTimes(2)
    expect(state.confirmFundScheme).toHaveBeenLastCalledWith('second', exact)
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/failed|could not|not saved/i)
  } finally { await act(async () => root.unmount()) }
})

it('aborts bulk approval without saving when external data is disabled during lookup', async () => {
  const exact = { schemeCode: 2, schemeName: 'Example Equity Fund Direct Plan IDCW Option' }
  let resolveSearch!: (value: unknown) => void
  state.search.mockImplementation(() => new Promise((resolve) => { resolveSearch = resolve }))
  state.positions = [state.positions[0], { ...state.positions[0], id: 'second' }]
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FundSchemeReview />))
    const approve = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Auto-approve schemes')!
    await act(async () => approve.click())
    expect(approve.disabled).toBe(true)
    const signal = state.search.mock.calls[0][1] as AbortSignal
    state.settings.allowExternalData = false
    await act(async () => root.render(<FundSchemeReview />))
    expect(signal.aborted).toBe(true)
    await act(async () => resolveSearch({ status: 'matched', candidates: [exact], match: exact }))
    expect(state.confirmFundScheme).not.toHaveBeenCalled()
    expect(state.search).toHaveBeenCalledTimes(1)
  } finally { await act(async () => root.unmount()) }
})
