// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MarketCapExposure } from './MarketCapExposure'
import { MARKET_CAP_STORAGE_KEY, type MarketCapRecord } from '../marketCapExposure'
import { getCachedMarketCapReference, loadMarketCapReference } from '../marketCapReference'
import type { LiveQuote, Position } from '../types'

vi.mock('../marketCapReference', () => ({ loadMarketCapReference: vi.fn(), getCachedMarketCapReference: vi.fn() }))
vi.mock('../useMarketCapPositions', () => ({ useMarketCapPositions: (positions: Position[], quotes: Record<string, LiveQuote>) => ({ positions, quotes, loading: false }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const position: Position = { id: 'one', ticker: 'COMPANY', name: 'Private company', isin: 'INE002A01018', type: 'stock', quantity: 10, buyPrice: 80, invested: 800, lastPrice: 100 }
const record: MarketCapRecord = { asOf: '2026-06-30', isin: 'INE002A01018', name: 'Private company', band: 'large', weight: 100, parentIsin: '', source: 'https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx' }
const reference = { asOf: record.asOf, sourceUrl: record.source, records: [record] }
let root: Root | undefined
let container: HTMLDivElement
const highlight = vi.fn()
beforeEach(() => {
  highlight.mockClear()
  localStorage.clear()
  vi.mocked(getCachedMarketCapReference).mockReset().mockReturnValue(null)
  vi.mocked(loadMarketCapReference).mockReset().mockResolvedValue(reference)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root?.unmount()); container.remove(); localStorage.clear() })
async function render(hideValues = false, allowExternalData = true, positions = [position]) {
  await act(async () => root!.render(<MarketCapExposure positions={positions} quotes={{}} hideValues={hideValues} allowExternalData={allowExternalData} onHighlight={highlight} />))
}

it('automatically loads exposure and highlights holdings without a dropdown', async () => {
  await render()
  expect(loadMarketCapReference).toHaveBeenCalledOnce()
  expect(container.querySelector('.market-cap-band--large')?.textContent).toContain('100.0%')
  const ribbon = container.querySelector('.market-cap-ribbon')!
  expect(ribbon.getAttribute('aria-label')).toContain('Large cap 100.0%')
  expect(ribbon.children).toHaveLength(1)
  expect(container.querySelectorAll('.market-cap-band')).toHaveLength(1)
  expect(container.querySelector('.market-cap-band--other')).toBeNull()
  expect(ribbon.getAttribute('aria-label')).not.toContain('Other assets')
  const large = container.querySelector('.market-cap-band--large') as HTMLButtonElement
  await act(async () => large.click())
  expect(large.getAttribute('aria-pressed')).toBe('true')
  expect(highlight).toHaveBeenLastCalledWith({ label: 'Large cap', positionIds: ['one'] })
  expect(container.querySelector('[role="region"]')).toBeNull()
  expect(large.hasAttribute('aria-expanded')).toBe(false)
})

it('shows cached allocation on its first commit without a loading or unclassified flash', async () => {
  vi.mocked(getCachedMarketCapReference).mockReturnValue(reference)
  act(() => root!.render(<MarketCapExposure positions={[position]} quotes={{}} hideValues={false} allowExternalData />))
  expect(container.querySelector('.market-cap-band--large')?.textContent).toContain('100.0%')
  expect(container.querySelector('.market-cap-band--unclassified')).toBeNull()
  expect(container.querySelector('[role="status"]')).toBeNull()
  await act(async () => {})
})

it('does not start reference requests when first rendered in privacy mode', async () => {
  await render(true)
  expect(loadMarketCapReference).not.toHaveBeenCalled()
  expect(getCachedMarketCapReference).not.toHaveBeenCalled()
  expect(container.querySelector('.market-cap-bands')).toBeNull()
})

it('ignores retired manual classifications and provides no extra upload tasks', async () => {
  localStorage.setItem(MARKET_CAP_STORAGE_KEY, JSON.stringify([{ ...record, band: 'small' }]))
  await render()
  expect(container.querySelector('.market-cap-band--large')?.textContent).toContain('100.0%')
  expect(container.querySelector('input[type="file"]')).toBeNull()
  expect(container.textContent).not.toContain('CSV')
  expect(container.querySelector('.market-cap-source')?.textContent).toContain("AMFI's published classifications")
  expect(container.querySelector('.market-cap-source summary')).toBeNull()
})

it('does not fetch or use sourced data with external market data off', async () => {
  await render(false, false)
  expect(loadMarketCapReference).not.toHaveBeenCalled()
  expect(container.textContent).toContain('External market data is off')
  expect(container.querySelector('.market-cap-band--unclassified')?.textContent).toContain('100.0%')
  await render()
  expect(container.querySelector('.market-cap-band--large')?.textContent).toContain('100.0%')
  await render(false, false)
  expect(container.querySelector('.market-cap-band--unclassified')?.textContent).toContain('100.0%')
  expect(container.textContent).not.toContain('2026-06-30')
})

it('keeps unavailable fund look-through and source failures unclassified', async () => {
  await render(false, true, [{ ...position, type: 'mutual-fund' }])
  expect(loadMarketCapReference).not.toHaveBeenCalled()
  expect(container.textContent).not.toContain('Fund look-through is unavailable')
  expect(container.querySelector('.market-cap-band--funds')?.textContent).toContain('ETF + Mutual Funds')
  expect(container.querySelector('.market-cap-band--funds')?.textContent).toContain('100.0%')
  expect(container.querySelector('.market-cap-band--unclassified')).toBeNull()
  vi.mocked(loadMarketCapReference).mockRejectedValue(new Error('Unavailable'))
  await render()
  expect(container.textContent).toContain('AMFI classifications are temporarily unavailable')
  expect(container.querySelector('.market-cap-band--unclassified')?.textContent).toContain('100.0%')
})

it('hides amounts, holding details and source dates with portfolio privacy enabled', async () => {
  await render()
  await act(async () => (container.querySelector('.market-cap-band--large') as HTMLButtonElement).click())
  expect(highlight).toHaveBeenLastCalledWith({ label: 'Large cap', positionIds: ['one'] })
  await render(true)
  expect(container.textContent).not.toContain('Private company')
  expect(container.textContent).not.toContain('2026-06-30')
  expect(container.querySelector('.market-cap-bands')).toBeNull()
  expect(highlight).toHaveBeenLastCalledWith(null)
})

it('keeps missing and conflicting ISINs unclassified instead of guessing from a ticker', async () => {
  await render(false, true, [{ ...position, isin: undefined }])
  expect(loadMarketCapReference).not.toHaveBeenCalled()
  expect(container.querySelector('.market-cap-band--unclassified')?.textContent).toContain('100.0%')
  await render(false, true, [{ ...position, identityIssue: 'ISIN conflict' }])
  expect(loadMarketCapReference).not.toHaveBeenCalled()
  expect(container.querySelector('.market-cap-band--unclassified')?.textContent).toContain('100.0%')
})
