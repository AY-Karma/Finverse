// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketIndexTicker } from './MarketIndexTicker'
import type { MarketIndexSnapshot } from '../marketIndexQuotes'

const state = vi.hoisted(() => ({ hook: vi.fn(), open: true }))
vi.mock('../useMarketIndexQuotes', () => ({ useMarketIndexQuotes: state.hook }))
vi.mock('../live', async (original) => ({ ...await original<typeof import('../live')>(), isMarketOpen: () => state.open }))
vi.mock('./TickerTape', () => ({ TickerTape: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
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

describe('indices-only quick view', () => {
  it('keeps five public index labels and inline plain levels with signed daily changes', async () => {
    await render()
    expect(container.querySelectorAll('.ticker-item')).toHaveLength(5)
    expect(container.textContent).toContain('NIFTY 50')
    expect(container.textContent).toContain('S&P BSE Sensex')
    expect(container.textContent).toContain('NIFTY Bank')
    expect(container.textContent).toContain('NIFTY Next 50')
    expect(container.textContent).toContain('NIFTY Midcap 50')
    expect(container.querySelector('.ticker-val')?.textContent).toBe('25,001.50')
    expect(container.querySelector('.ticker-delta')?.textContent).toBe('+101.50 (+0.41%)')
    expect(container.querySelectorAll('.ticker-val')[1].textContent).toBe('Unavailable')
    expect(container.textContent).not.toContain('₹')
    expect(container.querySelector('.ticker-item')?.getAttribute('title')).toContain('As of 6 Nov, 11:30 am IST')
    expect(state.hook).toHaveBeenCalledWith(true)
  })

  it('shows signed losses, neutral unavailable moves and visible delayed or saved qualifiers', async () => {
    snapshot.quotes['^NSEI'] = { price: 24_000, change: -50, pct: -0.21, at: Date.now() - 600_000 }
    snapshot.quotes['^BSESN'] = { price: 80_000, change: null, pct: null, at: Date.now() }
    snapshot.unavailable = ['^BSESN']
    await render()
    expect(container.querySelector('.ticker-delta.down')?.textContent).toBe('-50.00 (-0.21%)')
    expect(container.textContent).toContain('Delayed')
    expect(container.textContent).toContain('Saved')
    expect(container.querySelector('.ticker-delta.muted')?.textContent).toBe('— (—)')
  })

  it('leaves named neutral placeholders during the first load', async () => {
    snapshot = { quotes: {}, checkedAt: 0, unavailable: [], loading: true }
    await render()
    expect(container.querySelectorAll('.ticker-item')).toHaveLength(5)
    expect(container.querySelectorAll('.ticker-delta')).toHaveLength(0)
    expect(container.textContent?.match(/Loading/g)).toHaveLength(5)
  })
})
