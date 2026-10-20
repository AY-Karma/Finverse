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
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
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

it.each([{ currency: 'USD' as const }, { currency: 'INR' as const, reportedCurrency: 'EUR' }])('blocks scheme search and confirmation for an unsupported fund currency %j', async (metadata) => {
  state.positions = [{ ...state.positions[0], ...metadata }]
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FundSchemeReview />))
    const search = container.querySelector<HTMLButtonElement>('button')!
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
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(container.querySelector('[aria-label="Review fund scheme"]')).not.toBeNull()
    state.positions = [{ ...state.positions[0], currency: 'USD' }]
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
    expect(container.querySelector('details')!.classList.contains('review-required')).toBe(true)
    expect(container.querySelector('summary')!.textContent).toContain('1 need confirmation')
    state.positions = [{ ...state.positions[0], mfScheme: { code: 2, name: 'Example Equity Fund Direct IDCW', source: 'confirmed' } }]
    await act(async () => root.render(<FundSchemeReview />))
    expect(container.querySelector('details')!.classList.contains('review-required')).toBe(false)
    expect(container.querySelector('summary')!.textContent).toContain('0 need confirmation')
  } finally { await act(async () => root.unmount()) }
})
