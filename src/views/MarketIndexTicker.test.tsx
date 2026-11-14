// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketIndexTicker } from './MarketIndexTicker'
import type { MarketIndexSnapshot } from '../marketIndexQuotes'

const state = vi.hoisted(() => ({ hook: vi.fn(), open: true }))
vi.mock('../useMarketIndexQuotes', () => ({ useMarketIndexQuotes: state.hook }))
vi.mock('../live', async (original) => ({ ...await original<typeof import('../live')>(), isMarketOpen: () => state.open }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root, container: HTMLDivElement
let snapshot: MarketIndexSnapshot & { loading: boolean }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-06T06:00:00Z'))
  state.open = true
  snapshot = { quotes: { '^NSEI': { price: 25_001.5, change: 101.5, pct: 0.41, at: Date.now() } }, checkedAt: Date.now(), unavailable: [], loading: false }
  state.hook.mockReset().mockImplementation(() => snapshot)
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })
const render = () => act(async () => root.render(<MarketIndexTicker allowed />))

describe('fixed static index strip', () => {
  it('shows only Bank Nifty and NIFTY 50 as plain labels with signed quotes', async () => {
    await render()
    expect([...container.querySelectorAll('.ticker-sym')].map((label) => label.textContent)).toEqual(['Bank Nifty', 'NIFTY 50'])
    expect(container.querySelectorAll('.ticker-item')).toHaveLength(2)
    expect(container.querySelectorAll('.ticker-val')[0].textContent).toBe('—')
    expect(container.querySelector('.ticker-status')?.textContent).toBe('Unavailable')
    expect(container.querySelectorAll('.ticker-val')[1].textContent).toBe('25,001.50')
    expect(container.querySelector('.ticker-delta')?.textContent).toBe('+101.50 (+0.41%)')
    expect(container.textContent).not.toContain('₹')
    expect(container.querySelectorAll('.ticker-item')[1].getAttribute('title')).toContain('As of 6 Nov, 11:30 am IST')
    expect(state.hook).toHaveBeenCalledWith(true, undefined)
  })

  it('preserves signed losses and neutral saved or delayed quote qualifications', async () => {
    snapshot.quotes['^NSEBANK'] = { price: 50_000, change: -50, pct: -0.21, at: Date.now() - 600_000 }
    snapshot.quotes['^NSEI'] = { price: 25_000, change: null, pct: null, at: Date.now() }
    snapshot.unavailable = ['^NSEI']
    await render()
    expect(container.querySelector('.ticker-delta.down')?.textContent).toBe('-50.00 (-0.21%)')
    expect(container.textContent).toContain('Delayed')
    expect(container.textContent).toContain('Saved')
    expect(container.querySelector('.ticker-delta.muted')?.textContent).toBe('— (—)')
  })

  it('does not show quote changes before index prices arrive', async () => {
    snapshot = { quotes: {}, checkedAt: 0, unavailable: [], loading: true }
    await render()
    expect(container.querySelectorAll('.ticker-item')).toHaveLength(2)
    expect(container.querySelectorAll('.ticker-delta')).toHaveLength(0)
  })
})
