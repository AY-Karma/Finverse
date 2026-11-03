// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMarketCapPositions } from './useMarketCapPositions'
import { loadNseInstrumentTypes, type NsePricingCandidate } from './nsePricing'
import { quoteKey } from './valuation'
import type { LiveQuote, Position } from './types'

vi.mock('./nsePricing', () => ({ loadNseInstrumentTypes: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let sequence = 0
let positions: Position[]
let quotes: Record<string, LiveQuote>
let allowExternalData: boolean
let hideValues: boolean
let renders: ReturnType<typeof useMarketCapPositions>[]
const latest = () => renders[renders.length - 1]
const candidate = (type: 'stock' | 'etf' = 'etf'): NsePricingCandidate => ({
  exchange: 'NSE', type, isin: positions[0].isin!, providerSymbol: 'FUND.NS',
})
function Capture() {
  renders.push(useMarketCapPositions(positions, quotes, allowExternalData, hideValues))
  return null
}
const render = () => act(async () => root.render(<Capture />))

beforeEach(() => {
  sequence += 1
  positions = [{ id: 'imported', name: 'Imported fund', ticker: 'FUND', type: 'stock',
    isin: `INE000A0101${sequence}`, exchange: 'NSE', currency: 'INR', quantity: 2,
    buyPrice: 80, invested: 160, lastPrice: 100 }]
  quotes = { [quoteKey(positions[0])]: { price: 105, at: Date.now(), source: 'yahoo' } }
  allowExternalData = true
  hideValues = false
  renders = []
  root = createRoot(document.createElement('div'))
  vi.mocked(loadNseInstrumentTypes).mockReset().mockResolvedValue([candidate()])
})
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks() })

it('keeps imported identities while a pending lookup resolves into view-only ETF copies', async () => {
  let resolve!: (value: NsePricingCandidate[]) => void
  vi.mocked(loadNseInstrumentTypes).mockReturnValue(new Promise((done) => { resolve = done }))
  await render()
  expect(latest().loading).toBe(true)
  expect(latest().positions[0]).toBe(positions[0])
  await act(async () => resolve([candidate()]))
  const corrected = latest().positions[0]
  expect(corrected.type).toBe('etf')
  expect(corrected.id).toBe(positions[0].id)
  expect(latest().quotes[quoteKey(corrected)]).toBe(quotes[quoteKey(positions[0])])
  expect(positions[0].type).toBe('stock')
  expect(latest().loading).toBe(false)
})

it('uses cached ETF types on the first remount render without a loading flash or request', async () => {
  await render()
  await act(async () => root.unmount())
  root = createRoot(document.createElement('div'))
  renders = []
  await render()
  expect(renders[0].positions[0].type).toBe('etf')
  expect(renders.every((result) => !result.loading)).toBe(true)
  expect(loadNseInstrumentTypes).toHaveBeenCalledOnce()
})

it('does not reuse expired cached types on a remount', async () => {
  const at = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(at)
  await render()
  await act(async () => root.unmount())
  vi.mocked(Date.now).mockReturnValue(at + 6 * 60 * 60_000)
  vi.mocked(loadNseInstrumentTypes).mockResolvedValue([candidate('stock')])
  root = createRoot(document.createElement('div'))
  renders = []
  await render()
  expect(renders[0].positions[0].type).toBe('stock')
  expect(loadNseInstrumentTypes).toHaveBeenCalledTimes(2)
})

it('skips verified stock listings but still checks a mismatched listing', async () => {
  positions = [{ ...positions[0], pricingListing: { ...candidate('stock'), source: 'nse-master', verifiedAt: Date.now() } }]
  await render()
  expect(loadNseInstrumentTypes).not.toHaveBeenCalled()
  expect(latest().loading).toBe(false)
  positions = [{ ...positions[0], pricingListing: { ...positions[0].pricingListing!, isin: 'INE467B01029' } }]
  await render()
  expect(loadNseInstrumentTypes).toHaveBeenCalledOnce()
})

it('does not load or apply cached corrections with external data off or values hidden', async () => {
  allowExternalData = false
  await render()
  hideValues = true
  allowExternalData = true
  await render()
  expect(loadNseInstrumentTypes).not.toHaveBeenCalled()
  expect(latest()).toMatchObject({ positions, quotes, loading: false })
  hideValues = false
  await render()
  expect(latest().positions[0].type).toBe('etf')
  hideValues = true
  await render()
  expect(latest().positions).toBe(positions)
  expect(latest().quotes).toBe(quotes)
  expect(latest().loading).toBe(false)
  expect(loadNseInstrumentTypes).toHaveBeenCalledOnce()
})
