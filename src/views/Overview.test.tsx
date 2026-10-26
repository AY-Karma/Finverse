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
vi.mock('./HistoryPanel', () => ({ HistoryPanel: () => <section data-history-panel>Holding Price History</section> }))
vi.mock('./PortfolioPerformance', () => ({ PortfolioPerformance: ({ scope }: { scope: string }) => <section className="portfolio-performance" data-scope={scope}>Portfolio performance</section> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('overview valuation and visible work', () => {
  it('shows LTP and daily price moves in the ticker and ledger, with neutral missing data and privacy masking', async () => {
    const positions: Position[] = ['DOWN', 'UP', 'FLAT', 'MISSING', 'INVALID', 'REVIEW'].map((ticker) => ({
      id: ticker, ticker, name: ticker, type: 'stock', quantity: 10, buyPrice: 100, invested: 1000, lastPrice: 120,
      ...(ticker === 'REVIEW' ? { identityIssue: 'Confirm venue' } : {}),
    }))
    const folios = [{ id: 'test', name: 'Test', importedAt: Date.now(), positions }]
    const quote = { price: 120, at: Date.now(), source: 'yahoo' as const }
    const quotes = {
      [quoteKey(positions[0])]: { ...quote, change: -5 },
      [quoteKey(positions[1])]: { ...quote, change: 2, changePct: 1.69 },
      [quoteKey(positions[2])]: { ...quote, change: 0, changePct: 0 },
      [quoteKey(positions[4])]: { ...quote, price: NaN, change: 5, changePct: 5 },
      [quoteKey(positions[5])]: { ...quote, change: 5, changePct: 5 },
    }
    state.store = { positions, rawPositions: positions, snapshot: investmentWorkspace.readSnapshot({ folios, quotes }), settings: { ...loadSettings(), hideValues: false, allowExternalData: true }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div')
    const root = createRoot(container)
    const render = () => act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
    try {
      await render()
      const cells = [...container.querySelectorAll('.ticker-item')]
      expect(cells[0].querySelector('.ticker-val')?.textContent).toBe('₹120.00')
      expect(cells[0].querySelector('.ticker-delta')?.textContent).toBe('−₹5.00 (−4.00%)')
      expect(cells[0].querySelector('.ticker-delta')?.classList.contains('down')).toBe(true)
      expect(cells[1].querySelector('.ticker-delta')?.textContent).toBe('+₹2.00 (+1.69%)')
      expect(cells[2].querySelector('.ticker-delta')?.textContent).toBe('₹0.00 (+0.00%)')
      for (const cell of cells.slice(3, 6)) {
        expect(cell.querySelector('.ticker-delta')?.textContent).toBe('— (—)')
        expect(cell.querySelector('.ticker-delta')?.classList.contains('muted')).toBe(true)
      }
      const rows = [...container.querySelectorAll('.table--ledger > tbody > tr')]
      expect(rows[0].querySelector('.ltp-arrow')?.textContent).toBe('▼')
      expect(rows[0].querySelector('.last-trade-move')?.textContent).toBe('−₹5.00')
      expect(rows[1].querySelector('.last-trade-move')?.textContent).toBe('+₹2.00')
      expect(rows[2].querySelector('.ltp-arrow')).toBeNull()
      expect(rows[3].querySelector('.last-trade-move')?.textContent).toBe('—')
      await act(async () => container.querySelector<HTMLButtonElement>('.ledger-mobile-row')!.click())
      expect(container.querySelector('.ledger-mobile-detail .last-trade-move')?.textContent).toBe('−₹5.00')

      state.store = { ...state.store, settings: { ...state.store.settings, hideValues: true } }
      await render()
      expect(container.querySelector('.ticker-item')?.textContent).not.toMatch(/₹|DOWN|4.00/)
      expect(container.querySelector('.last-trade')?.textContent).toBe('••••••••••••')
      expect(container.querySelector('.ltp-arrow')).toBeNull()

      state.store = { ...state.store, settings: { ...state.store.settings, hideValues: false, allowExternalData: false } }
      await render()
      expect(container.querySelector('.ticker-delta')?.textContent).toBe('— (—)')
      expect(container.querySelector('.last-trade-move')?.textContent).toBe('—')
    } finally { await act(async () => root.unmount()) }
  })

  it('groups performance above allocation and keeps their scope in sync with the composition summary', async () => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const positions: Position[] = [
      { id: 'equity', ticker: 'EQUITY', name: 'Equity', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 },
      { id: 'fund', ticker: 'FUND', name: 'Fund', type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 80 },
    ]
    const folios = [{ id: 'test', name: 'Test', importedAt: Date.now(), positions }]
    state.store = { positions, rawPositions: positions, snapshot: investmentWorkspace.readSnapshot({ folios, quotes: {} }), settings: { ...loadSettings(), hideValues: false }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector('[data-history-panel], .history-panel-placeholder')).toBeNull()
      const panel = container.querySelector('.panel--portfolio')!
      expect(panel.firstElementChild?.className).toBe('portfolio-performance')
      expect(panel.lastElementChild?.getAttribute('aria-label')).toBe('Allocation mix')
      expect(panel.querySelector('.portfolio-performance')?.getAttribute('data-scope')).toBe('all')
      expect(panel.querySelector('.alloc-summary')?.textContent).toContain('50% in profit')
      const equity = [...panel.querySelectorAll<HTMLButtonElement>('.scope-btn')].find((button) => button.textContent?.startsWith('Equity'))!
      await act(async () => equity.click())
      expect(panel.querySelector('.portfolio-performance')?.getAttribute('data-scope')).toBe('equity')
      expect(panel.querySelector('.alloc-legend')?.textContent).toContain('EQUITY')
      expect(panel.querySelector('.alloc-legend')?.textContent).not.toContain('FUND')
      expect(panel.querySelector('.alloc-summary')?.textContent).toContain('100% in profit')
      expect(panel.querySelector('.alloc-summary')?.textContent).toContain('100% equity')
    } finally {
      await act(async () => root.unmount())
      canvas.mockRestore()
    }
  })

  it('prompts after 21 days, links to folios, and clears after a review while retaining listing review', async () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-10-20T12:00:00Z')
    vi.setSystemTime(now)
    const position: Position = { id: 'old', ticker: 'ABC', name: 'ABC', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120, exchangeSource: 'inferred' }
    const folios = ['old-account', 'other-account'].map((id) => ({ id, name: 'Private account', importedAt: now - 21 * 86_400_000, positions: [{ ...position, id: `${id}-holding` }] }))
    state.store = { positions: [position], rawPositions: [position], snapshot: investmentWorkspace.readSnapshot({ folios, quotes: {} }), settings: { ...loadSettings(), hideValues: true }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false } as unknown as ReturnType<typeof useStore>
    const onGoTo = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)
    const render = () => act(async () => root.render(<Overview onGoTo={onGoTo} onRequestImport={vi.fn()} />))
    try {
      await render()
      expect(container.querySelector('.overview-review--folios')).toBeNull()
      await act(async () => vi.advanceTimersByTime(30_000))
      const notice = container.querySelector('.overview-review--folios')!
      expect(notice.textContent).toContain('Update folios')
      expect(notice.textContent).not.toContain('Private account')
      await act(async () => notice.querySelector('button')!.click())
      expect(onGoTo).toHaveBeenCalledWith('settings', 'manage-holdings')
      state.store = { ...state.store, snapshot: investmentWorkspace.readSnapshot({ folios: [{ ...folios[0], reviewedAt: Date.now() }, folios[1]], quotes: {} }) }
      await render()
      expect(container.querySelector('.overview-review--folios')).not.toBeNull()
      state.store = { ...state.store, snapshot: investmentWorkspace.readSnapshot({ folios: folios.map((folio) => ({ ...folio, reviewedAt: Date.now() })), quotes: {} }) }
      await render()
      expect(container.querySelector('.overview-review--folios')).toBeNull()
      expect(container.querySelector('.overview-review')?.textContent).toContain('Review listings')
    } finally { await act(async () => root.unmount()); vi.useRealTimers() }
  })

  it('shows pending imported listings, links to their review, and clears the notice after approval', async () => {
    const onGoTo = vi.fn()
    const positions: Position[] = [
      { id: 'inferred', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120, exchangeSource: 'inferred' },
      { id: 'unresolved', ticker: 'SBIN', name: 'State Bank', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120, exchangeSource: 'explicit', identityIssue: 'Confirm the venue' },
      { id: 'reviewed', ticker: 'RELIANCE', name: 'Reliance', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120, exchangeSource: 'explicit' },
      { id: 'fund', ticker: 'Fund', name: 'Fund', type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 },
    ]
    const folios = [{ id: 'test', name: 'Test', importedAt: Date.now(), positions }]
    state.store = { positions: [], rawPositions: [], snapshot: investmentWorkspace.readSnapshot({ folios: [], quotes: {} }), settings: { ...loadSettings(), allowExternalData: true }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div')
    const root = createRoot(container)
    const render = () => act(async () => root.render(<Overview onGoTo={onGoTo} onRequestImport={vi.fn()} />))
    try {
      await render()
      expect(container.querySelector('.overview-review')).toBeNull()
      state.store = { ...state.store, positions, rawPositions: positions, snapshot: investmentWorkspace.readSnapshot({ folios, quotes: {} }) }
      await render()
      const notice = container.querySelector('.page-head .overview-review')!
      const reviewButton = notice.querySelector('button')!
      expect(reviewButton.textContent).toBe('Review listings')
      expect(reviewButton.nextElementSibling?.textContent).toBe('Approve listings to confirm prices & calibration.')
      expect(notice.textContent).not.toContain('awaiting approval')
      expect(container.querySelector('.overview-title-row > .page-title')?.textContent).toBe('Overview')
      expect(container.querySelector('#instrument-review')).toBeNull()
      await act(async () => notice.querySelector('button')!.click())
      expect(onGoTo).toHaveBeenCalledWith('settings', 'instrument-review')
      state.store = { ...state.store, settings: { ...state.store.settings, allowExternalData: false } }
      await render()
      expect(notice.querySelector('[role="status"]')?.textContent).toBe('Approve listings to confirm prices & calibration.')
      state.store = { ...state.store, positions: positions.map((position) => ({ ...position, exchangeSource: 'explicit', identityIssue: undefined })) }
      await render()
      expect(container.querySelector('.overview-review')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps imported fund XIRRs in the ledger without averaging a portfolio XIRR', async () => {
    const positions: Position[] = [12, 24].map((xirr, index) => ({ id: String(index), ticker: `Fund ${index}`, name: `Fund ${index}`, type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120, xirr }))
    const folios = [{ id: 'funds', name: 'Funds', importedAt: Date.now(), positions }]
    state.store = { positions, rawPositions: positions, folios, snapshot: investmentWorkspace.readSnapshot({ folios, quotes: {} }), liveQuotes: {}, settings: { ...loadSettings(), allowExternalData: false }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      await act(async () => container.querySelectorAll<HTMLButtonElement>('.scope-btn')[2].click())
      const summary = container.querySelector('.mf-summary')
      expect(summary?.textContent).toContain('Portfolio XIRR')
      expect(summary?.textContent).toContain('Requires dated cash flows')
      expect(summary?.textContent).not.toContain('18.00%')
      expect(container.textContent).toContain('+12.00%')
      expect(container.textContent).toContain('+24.00%')
      const mergedPositions = positions.map((position) => ({ ...position, ticker: 'Combined Fund', name: 'Combined Fund' }))
      const mergedFolios = [{ ...folios[0], positions: mergedPositions }]
      const snapshot = investmentWorkspace.readSnapshot({ folios: mergedFolios, quotes: {} })
      state.store = { ...state.store, positions: snapshot.positions, rawPositions: mergedPositions, folios: mergedFolios, snapshot }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector('.panel--ledger .table tbody tr td:nth-child(6)')?.textContent).toBe('—')
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Show the 2 merged entries for Combined Fund"]')?.click())
      expect([...container.querySelectorAll('.trow--nested .ledger-members [data-label="XIRR"]')].map((node) => node.textContent)).toEqual(['+12.00%', '+24.00%'])
      expect(container.textContent).toContain('A merged XIRR requires dated cash flows')
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps market metadata compact while retaining the price timestamp and expandable calendar', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T06:00:00Z'))
    const positions: Position[] = [
      { id: 'test', ticker: 'RELIANCE', name: 'Reliance', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120 },
    ]
    const folios = [{ id: 'test', name: 'Test', importedAt: Date.now(), positions }]
    const liveQuotes = { [quoteKey(positions[0])]: { price: 120, at: Date.parse('2026-10-01T10:00:02Z'), source: 'yahoo' as const } }
    const snapshot = investmentWorkspace.readSnapshot({ folios, quotes: liveQuotes })
    state.store = { positions, rawPositions: positions, folios, snapshot, liveQuotes, settings: { ...loadSettings(), allowExternalData: true }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null } as unknown as ReturnType<typeof useStore>
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
    const snapshot = investmentWorkspace.readSnapshot({ folios, quotes: {} })
    state.store = { positions, rawPositions: positions, folios, snapshot, liveQuotes: {}, settings: { ...loadSettings(), allowExternalData: false }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null } as unknown as ReturnType<typeof useStore>
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
    const quotes = {
      [quoteKey(positions[0])]: { price: 120, change: -8, at: Date.parse('2026-10-01T10:00:00Z'), source: 'yahoo' as const },
      [quoteKey(positions[1])]: { price: 90, change: 1, at: Date.parse('2026-10-01T10:00:00Z'), source: 'yahoo' as const },
    }
    const snapshot = investmentWorkspace.readSnapshot({ folios, quotes })
    state.store = { positions, rawPositions: positions, folios, snapshot, liveQuotes: quotes, settings: { ...loadSettings(), currency: 'INR', hideValues: false, allowExternalData: true }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      const summary = container.querySelector('[aria-label="Portfolio summary"]')!
      expect([...summary.querySelectorAll('.score > .score-value')].map((node) => node.textContent)).toEqual(['₹210.00', '₹200.00', '+₹10.00'])
      expect(summary.querySelector('.current-value-move')?.getAttribute('aria-label')).toBe('Latest session · 01 Oct 2026 portfolio move: −₹7.00')
      expect(container.querySelector('.daily-brief-copy strong')?.textContent).toBe('Your portfolio lost ₹7.00 in this session.')
      expect(container.querySelector('.daily-brief-copy .hint')?.textContent).toBe('Open Insights to understand more.')
      expect(container.querySelector('.daily-brief')?.textContent).not.toContain('Today')
      expect([...summary.querySelectorAll('.performer-half')].map((node) => node.textContent)).toEqual(['Best performerWIN+20.00%', 'Worst performerLOSS-10.00%'])
      expect(summary.textContent).not.toContain('Total market exposure')
      expect(summary.textContent).not.toContain('Cost basis deployed')
      expect(summary.textContent).not.toContain('on cost')

      const gainQuotes = { ...quotes, [quoteKey(positions[0])]: { ...quotes[quoteKey(positions[0])], change: 7 } }
      state.store = { ...state.store, snapshot: investmentWorkspace.readSnapshot({ folios, quotes: gainQuotes }) }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector('.daily-brief-copy strong')?.textContent).toBe('Your portfolio gained ₹8.00 in this session.')
      expect(container.querySelector('.daily-brief-stat strong')?.textContent).toBe('+₹8.00')

      const flatQuotes = Object.fromEntries(Object.entries(quotes).map(([key, quote]) => [key, { ...quote, change: 0 }]))
      state.store = { ...state.store, snapshot: investmentWorkspace.readSnapshot({ folios, quotes: flatQuotes }) }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector('.daily-brief-copy strong')?.textContent).toBe('Your portfolio is unchanged in this session.')
      expect(container.querySelector('.daily-brief-stat strong')?.textContent).toBe('+₹0.00')

      state.store = { ...state.store, settings: { ...state.store.settings, hideValues: true } }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect([...summary.querySelectorAll('.score-value')].every((node) => node.textContent === '••••••')).toBe(true)
      expect(summary.querySelector('.current-value-move')?.getAttribute('aria-label')).toBe('Portfolio session move hidden')
      expect(summary.querySelector('.current-value-move-arrow')?.textContent).toBe('')
      expect([...summary.querySelectorAll('.performer-half .score-value')].every((node) => node.getAttribute('title') === '••••••')).toBe(true)
      expect(summary.textContent).not.toMatch(/₹|WIN|LOSS|20\.00|10\.00/)
      const labels = [...container.querySelectorAll('[title], [aria-label]')].map(element => `${element.getAttribute('title') || ''} ${element.getAttribute('aria-label') || ''}`).join(' ')
      expect(labels).not.toMatch(/WIN|LOSS/)
      expect(container.querySelector('.daily-brief-copy strong')?.textContent).toBe('Session movement hidden.')
      expect(container.querySelector('.daily-brief')?.textContent).not.toMatch(/gained|lost|₹/)
    } finally { await act(async () => root.unmount()) }
  })

  it('does not describe a partial session change as a portfolio gain', async () => {
    const positions: Position[] = ['A', 'B'].map((ticker) => ({
      id: ticker, ticker, name: ticker, type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110,
    }))
    positions[1] = { ...positions[1], type: 'mutual-fund', mfScheme: { code: 123, name: 'B', source: 'confirmed' } }
    const folios = [{ id: 'f', name: 'Portfolio', importedAt: 1, positions }]
    const quotes = { [quoteKey(positions[0])]: { price: 110, change: 10, at: Date.parse('2026-10-01T10:00:00Z'), source: 'yahoo' as const } }
    const snapshot = investmentWorkspace.readSnapshot({ folios, quotes })
    state.store = { positions, rawPositions: positions, folios, snapshot, liveQuotes: quotes, settings: { ...loadSettings(), hideValues: false, allowExternalData: true }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector('.current-value-move')).toBeNull()
      const brief = container.querySelector('.daily-brief')!
      expect(brief.textContent).toContain('Reporting holdings gained ₹10.00')
      expect(brief.querySelector('.daily-brief-copy .hint')?.textContent).toContain('1 of 2 holdings included')
      expect(brief.textContent).toContain('1 fund awaiting session updates')
      expect(brief.textContent).toContain('01 Oct 2026')
      expect(brief.textContent).not.toMatch(/tailwind|Today|Your portfolio gained/)
      expect(brief.querySelector('.daily-brief-stat strong')?.textContent).toBe('+₹10.00')
      state.store = { ...state.store, settings: { ...state.store.settings, hideValues: true } }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(brief.querySelector('.daily-brief-stat strong')?.textContent).toBe('••••••')
      expect(brief.textContent).not.toMatch(/gained|lost|₹/)
    } finally { await act(async () => root.unmount()) }
  })
})
