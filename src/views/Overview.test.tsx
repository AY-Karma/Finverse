// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { investmentWorkspace } from '../investmentWorkspace'
import { quoteKey } from '../valuation'
import { loadSettings } from '../store'
import type { Position } from '../types'
import type { useStore } from '../useStore'
import { Overview } from './Overview'

const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore>, format: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('../valuation', async (original) => {
  const actual = await original<typeof import('../valuation')>()
  return { ...actual, formatCurrency: (...args: Parameters<typeof actual.formatCurrency>) => { state.format(); return actual.formatCurrency(...args) } }
})
vi.mock('./HistoryPanel', () => ({ HistoryPanel: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('overview valuation and visible work', () => {
  it('keeps market metadata compact while retaining the price timestamp and expandable calendar', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T06:00:00Z'))
    const positions: Position[] = [
      { id: 'test', ticker: 'RELIANCE', name: 'Reliance', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 },
    ]
    const folios = [{ id: 'test', name: 'Test', importedAt: Date.now(), positions }]
    const liveQuotes = { [quoteKey(positions[0])]: { price: 120, at: Date.parse('2026-10-01T10:00:02Z'), source: 'yahoo' as const } }
    const snapshot = investmentWorkspace.readSnapshot({ folios, quotes: liveQuotes, fxRate: null })
    state.store = { positions, rawPositions: positions, folios, snapshot, liveQuotes, fxRate: null, settings: { ...loadSettings(), allowExternalData: true }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      const card = container.querySelector('.overview-meta')!
      expect(card.textContent).not.toContain('Net position')
      expect(card.querySelector('.market-status-copy')?.textContent).toBe('Market Closed - showing prices as of 01 Oct, 15:30:02 IST')
      expect(card.querySelector('.market-status-copy')?.getAttribute('title')).toBe('best-effort quotes')
      expect(card.querySelector('.market-status-copy')?.children).toHaveLength(0)
      expect([...card.querySelectorAll('.market-session time')].map((node) => node.getAttribute('datetime'))).toEqual(['2026-10-01T10:00:00.000Z', '2026-10-05T03:45:00.000Z'])
      expect(card.querySelector('details')?.open).toBe(false)
      expect(card.querySelector('summary')?.textContent).toBe('Market calendarSessions & holidays')
      expect([...card.querySelectorAll('.market-session time')].every((node) => node.closest('details'))).toBe(true)
      expect(card.querySelector('[aria-label="Next market holiday"]')?.textContent).toBe('Upcoming Holiday - Tue 20 Oct, Dussehra in 16 days')
      expect(card.querySelector('.market-holiday time')?.getAttribute('datetime')).toBe('2026-10-20')
      expect(card.querySelector('a')).toBeNull()
      expect(card.querySelector('.market-calendar-note')).toBeNull()

      state.store = { ...state.store, settings: { ...state.store.settings, allowExternalData: false } }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(card.querySelector('.market-status-copy')?.textContent).toBe('External market data off · showing imported prices')
      expect(card.querySelector('[aria-label="NSE market calendar"]')).not.toBeNull()

      await act(async () => { vi.setSystemTime(new Date('2027-01-04T04:00:00Z')); vi.advanceTimersByTime(30_000) })
      expect(card.textContent).toContain('2027 holiday calendar unavailable. Check NSE for dates.')
      expect(card.querySelectorAll('.market-session time')).toHaveLength(0)
    } finally {
      await act(async () => root.unmount())
      vi.useRealTimers()
    }
  })

  it('labels incomplete values, calculates covered P&L and formats only visible ledger/ticker data', async () => {
    const positions: Position[] = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), ticker: `HOLD${i}`, name: `Holding ${i}`, type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: i === 4999 ? null : 120 }))
    const folios = [{ id: 'test', name: 'Test', importedAt: Date.now(), positions }]
    const snapshot = investmentWorkspace.readSnapshot({ folios, quotes: {}, fxRate: null })
    state.store = { positions, rawPositions: positions, folios, snapshot, liveQuotes: {}, fxRate: null, settings: { ...loadSettings(), allowExternalData: false }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null } as unknown as ReturnType<typeof useStore>
    state.format.mockClear()
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.textContent).toContain('Priced holdings value')
      expect(container.textContent).toContain('1 holding unpriced')
      expect(container.textContent).toContain('Priced holdings P&L')
      expect(container.querySelector('.scoreboard')?.textContent).toContain('+20.00% on priced cost')
      expect([...container.querySelectorAll('.performer-half .score-value')].map((node) => node.textContent)).toEqual(['HOLD0', 'HOLD4998'])
      expect(snapshot.pnl).toBe(99_980)
      expect(container.querySelectorAll('.ticker-item')).toHaveLength(48)
      expect(state.format.mock.calls.length).toBeLessThan(1500)
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps summary totals, daily move and performer returns accurate when values are revealed or hidden', async () => {
    const positions: Position[] = [
      { id: 'winner', ticker: 'WIN', name: 'Winner', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 },
      { id: 'loser', ticker: 'LOSS', name: 'Loser', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 90 },
    ]
    const folios = [{ id: 'test', name: 'Test', importedAt: Date.now(), positions }]
    const snapshot = { ...investmentWorkspace.readSnapshot({ folios, quotes: {}, fxRate: null }), dailyChange: -7 }
    state.store = { positions, rawPositions: positions, folios, snapshot, liveQuotes: {}, fxRate: null, settings: { ...loadSettings(), currency: 'INR', hideValues: false, allowExternalData: false }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      const summary = container.querySelector('[aria-label="Portfolio summary"]')!
      expect([...summary.querySelectorAll('.score > .score-value')].map((node) => node.textContent)).toEqual(['₹210.00', '₹200.00', '+₹10.00'])
      expect(summary.querySelector('.current-value-move')?.getAttribute('aria-label')).toBe("Today's portfolio move: −₹7.00")
      expect([...summary.querySelectorAll('.performer-half')].map((node) => node.textContent)).toEqual(['Best performerWIN+20.00%', 'Worst performerLOSS-10.00%'])
      expect(summary.textContent).not.toContain('Total market exposure')
      expect(summary.textContent).not.toContain('Cost basis deployed')
      expect(summary.textContent).not.toContain('on cost')

      state.store = { ...state.store, settings: { ...state.store.settings, hideValues: true } }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect([...summary.querySelectorAll('.score-value')].every((node) => node.textContent === '••••••')).toBe(true)
      expect(summary.querySelector('.current-value-move')?.getAttribute('aria-label')).toBe("Today's portfolio move hidden")
      expect(summary.querySelector('.current-value-move-arrow')?.textContent).toBe('')
      expect([...summary.querySelectorAll('.performer-half .score-value')].every((node) => node.getAttribute('title') === '••••••')).toBe(true)
      expect(summary.textContent).not.toMatch(/₹|WIN|LOSS|20\.00|10\.00/)
    } finally { await act(async () => root.unmount()) }
  })
})
