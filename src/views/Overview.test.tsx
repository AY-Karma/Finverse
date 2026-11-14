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
vi.mock('./PortfolioPerformance', () => ({ PortfolioPerformance: ({ scope }: { scope: string }) => <section className="portfolio-performance" data-scope={scope}>Portfolio performance</section> }))
vi.mock('./MarketIndexTicker', () => ({ MarketIndexTicker: ({ allowed }: { allowed: boolean }) => <div className="tiker-wrap" data-indices-allowed={allowed}>{['Bank Nifty', 'NIFTY 50'].map((name) => <span className="ticker-item" key={name}>{name}</span>)}</div> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('overview valuation and visible work', () => {
  it.each(['stock', 'mutual-fund'] as const)('can leave an empty scope in a single-%s portfolio', async (type) => {
    const holding: Position = { id: 'only', ticker: 'ONLY', name: 'Only holding', type, quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110 }
    const folios = [{ id: 'single', name: 'Single', importedAt: Date.now(), positions: [holding] }]
    state.store = { positions: [holding], rawPositions: [holding], folios, snapshot: investmentWorkspace.readSnapshot({ folios, quotes: {} }), settings: { ...loadSettings(), allowExternalData: false }, refreshNow: vi.fn() } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div'), root = createRoot(container)
    const choose = (label: string) => act(async () => [...container.querySelectorAll<HTMLButtonElement>('.panel--ledger .scope-btn')].find((button) => button.textContent?.startsWith(label))!.click())
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      await choose(type === 'stock' ? 'Mutual Funds' : 'Equity')
      expect(container.querySelector('.ledger-empty')?.textContent).toContain('No ')
      expect(container.querySelector('.page-title')?.textContent).toBe('Overview')
      await choose('All')
      expect(container.querySelector('.ledger-empty')).toBeNull()
      expect(container.querySelectorAll('.panel--ledger tbody > tr')).toHaveLength(1)
    } finally { await act(async () => root.unmount()) }
  })

  it.each(['stock', 'mutual-fund'] as const)('keeps %s sorting and 25-row paging together with keyboard and outside dismissal', async (type) => {
    const positions: Position[] = Array.from({ length: 26 }, (_, index) => ({ id: `toolbar-${index}`, ticker: `HOLD${index}`, name: `Holding ${index}`, type, quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110 + index, ...(type === 'mutual-fund' ? { xirr: index, mfScheme: { code: 100000 + index, name: `Holding ${index}`, source: 'confirmed' as const } } : {}) }))
    const folios = [{ id: 'toolbar', name: 'Toolbar', importedAt: Date.now(), positions }]
    state.store = { positions, rawPositions: positions, folios, snapshot: investmentWorkspace.readSnapshot({ folios, quotes: {} }), settings: { ...loadSettings(), allowExternalData: false }, refreshNow: vi.fn(), marketDataRefreshing: false } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      if (type === 'mutual-fund') await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.scope-btn')].find((button) => button.textContent?.startsWith('Mutual Funds'))!.click())
      const toolbar = container.querySelector<HTMLElement>('.ledger-toolbar')!
      expect(toolbar.previousElementSibling).toBe(container.querySelector('.panel--ledger .scope-switch'))
      expect(toolbar.closest('.ledger-controls')).not.toBeNull()
      const menu = toolbar.querySelector<HTMLDetailsElement>('details')!
      const trigger = menu.querySelector('summary')!
      const pager = toolbar.querySelector('.ledger-pagination')!
      expect(pager.textContent).toContain('1–25 / 26')
      expect(menu.querySelectorAll('.benchmark-menu-group button')).toHaveLength(13)
      expect(menu.querySelector('.is-selected')?.textContent).toBe('Import order')
      expect(menu.querySelector('.is-selected')?.getAttribute('aria-current')).toBe('true')
      await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
      expect(menu.open).toBe(true)
      expect(document.activeElement).toBe(menu.querySelector('.is-selected'))
      const bounds = vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ left: 20, right: 140, top: window.innerHeight - 190, bottom: window.innerHeight - 150 } as DOMRect)
      await act(async () => menu.dispatchEvent(new Event('toggle')))
      expect(menu.querySelector<HTMLElement>('.benchmark-menu-popover')?.style.bottom).toBe('calc(100% + 8px)')
      expect(menu.querySelector<HTMLElement>('.benchmark-menu-popover')?.style.left).toBe('-4px')
      bounds.mockRestore()
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(menu.open).toBe(false)
      await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
      await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(menu.open).toBe(false)
      expect(document.activeElement).toBe(trigger)
      await act(async () => trigger.click())
      await act(async () => [...menu.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Value: high to low')!.click())
      expect(menu.open).toBe(false)
      expect(trigger.textContent).toBe('Value ↓')
      expect(document.activeElement).toBe(trigger)
      expect(container.querySelector('.panel--ledger tbody')?.textContent).toContain(type === 'mutual-fund' ? 'Holding 25' : 'HOLD25')
      await act(async () => pager.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click())
      expect(pager.textContent).toContain('26–26 / 26')
      expect(container.querySelectorAll('.panel--ledger tbody > tr')).toHaveLength(1)
      expect(trigger.textContent).toBe('Value ↓')
      if (type === 'mutual-fund') {
        const quotes = { [quoteKey(positions[0])]: { price: 999, at: Date.now(), source: 'nav' as const } }
        state.store = { ...state.store, snapshot: investmentWorkspace.readSnapshot({ folios, quotes }), settings: { ...state.store.settings, allowExternalData: true } }
        await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
        expect(container.querySelector('.panel--ledger tbody')?.textContent).toContain('Holding 1')
        await act(async () => pager.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')!.click())
        expect(container.querySelector('.panel--ledger tbody tr td:first-child')?.textContent).toContain('Holding 0')
      }
      await act(async () => trigger.click())
      await act(async () => document.body.click())
      expect(menu.open).toBe(false)
    } finally { await act(async () => root.unmount()); container.remove() }
  })

  it('keeps the refresh hover text stable throughout the cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-30T06:00:00Z'))
    const holding: Position = { id: 'a', ticker: 'AAA', name: 'AAA', type: 'stock', quantity: 1, buyPrice: 80, invested: 80, lastPrice: 100 }
    const folios = [{ id: 'f', name: 'Portfolio', importedAt: Date.now(), positions: [holding] }]
    const refreshNow = vi.fn().mockResolvedValue({ ok: true, retryInMs: 5000 })
    state.store = { positions: [holding], rawPositions: [holding], snapshot: investmentWorkspace.readSnapshot({ folios, quotes: {} }), settings: loadSettings(), refreshNow, marketDataRefreshing: false } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div'), root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      const button = container.querySelector<HTMLButtonElement>('[aria-label="Refresh prices now"]')!
      const tooltip = button.closest('.overview-refresh-control')!
      const title = tooltip.getAttribute('title')
      await act(async () => button.click())
      expect(button.disabled).toBe(true)
      await act(async () => vi.advanceTimersByTime(1000))
      expect(button.closest('.overview-refresh-control')).toBe(tooltip)
      expect(tooltip.getAttribute('title')).toBe(title)
      await act(async () => vi.advanceTimersByTime(4000))
      expect(button.disabled).toBe(false)
      expect(tooltip.getAttribute('title')).toBe(title)
    } finally { await act(async () => root.unmount()); vi.useRealTimers() }
  })

  it('identifies an unmatched BSE portfolio as imported values in the collapsed view', async () => {
    const holding: Position = { id: 'bse-only', ticker: 'UNMATCHED', name: 'Unmatched company', type: 'stock', exchange: 'BSE', currency: 'INR', providerSymbol: 'UNMATCHED.BO', identityVersion: 2, exchangeSource: 'explicit', quantity: 1, buyPrice: 80, invested: 80, lastPrice: 100 }
    const folios = [{ id: 'bse', name: 'Imported file', importedAt: Date.now(), positions: [holding] }]
    state.store = { positions: [holding], rawPositions: [holding], snapshot: investmentWorkspace.readSnapshot({ folios, quotes: {} }), settings: loadSettings(), refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div'), root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector('.scoreboard')?.textContent).not.toContain('Imported value')
      expect(container.querySelector('.overview-market-strip .score--session')).not.toBeNull()
      expect(container.querySelector('.overview-market-strip .tiker-wrap')).not.toBeNull()
      expect(container.querySelector('.overview-meta')?.textContent).toContain('1 BSE holding uses imported prices')
      expect(container.querySelector('.overview-meta')?.textContent).toContain('NSE match is needed')
      expect(container.querySelector('.last-trade-source')?.textContent).toBe('Imported')
      expect(container.querySelector('.ledger-mobile-value')?.textContent).toContain('Imported')
      state.store = { ...state.store, settings: { ...state.store.settings, hideValues: true } }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector('.overview-meta')?.textContent).not.toContain('BSE')
      expect(container.querySelector('.ledger-mobile-value')?.textContent).not.toContain('Imported')
    } finally { await act(async () => root.unmount()) }
  })

  it('masks mutual-fund return colours on mobile while retaining visible returns when unmasked', async () => {
    const fund: Position = { id: 'fund', ticker: 'Fund', name: 'Test Fund Growth', type: 'mutual-fund', quantity: 10, buyPrice: 100, invested: 1000, lastPrice: 120, currency: 'INR' }
    const folios = [{ id: 'fund-folio', name: 'Fund', importedAt: Date.now(), positions: [fund] }]
    state.store = { positions: [fund], rawPositions: [fund], snapshot: investmentWorkspace.readSnapshot({ folios, quotes: {} }), settings: { ...loadSettings(), hideValues: false, allowExternalData: false }, refreshNow: vi.fn(), marketDataRefreshing: false } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div'), root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector<HTMLButtonElement>('[aria-label="Refresh prices now"]')?.disabled).toBe(true)
      expect(container.querySelector('.overview-refresh-control')?.getAttribute('title')).toContain('NAVs update at scheduled publication checks')
      await act(async () => container.querySelectorAll<HTMLButtonElement>('.scope-switch button')[2].click())
      expect(container.querySelector('.ledger-mobile-list .up')).not.toBeNull()
      state.store = { ...state.store, settings: { ...state.store.settings, hideValues: true } }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector('.ledger-mobile-list .up, .ledger-mobile-list .down')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it('opens the existing import flow from the empty portfolio welcome', async () => {
    const refreshNow = vi.fn()
    const onRequestImport = vi.fn()
    state.store = {
      positions: [], rawPositions: [],
      snapshot: investmentWorkspace.readSnapshot({ folios: [], quotes: {} }),
      settings: loadSettings(), refreshNow, marketDataRefreshing: false,
    } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={onRequestImport} />))
      const importButton = container.querySelector<HTMLButtonElement>('button')!
      await act(async () => importButton.click())
      expect(onRequestImport).toHaveBeenCalledOnce()
      expect(refreshNow).not.toHaveBeenCalled()
      expect(container.querySelector('.scoreboard')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it('shows holding price moves in the ledger while the quick view stays on public indices', async () => {
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
      expect(cells.map((cell) => cell.textContent)).toEqual(['Bank Nifty', 'NIFTY 50'])
      expect(container.querySelector('.tiker-wrap')?.textContent).not.toMatch(/DOWN|MISSING|REVIEW/)
      const rows = [...container.querySelectorAll('.table--ledger > tbody > tr')]
      expect(rows[0].querySelector('.ltp-arrow')?.textContent).toBe('▼')
      expect(rows[0].querySelector('.last-trade-move')?.textContent).toBe('−₹5.00')
      expect(rows[1].querySelector('.last-trade-move')?.textContent).toBe('+₹2.00')
      expect(rows[2].querySelector('.ltp-arrow')).toBeNull()
      expect(rows[3].querySelector('.last-trade-move')?.textContent).toBe('—')
      const mobileLtp = container.querySelector('.ledger-mobile-last-trade')!
      expect(mobileLtp.querySelector('.ltp-arrow')?.textContent).toBe('▼')
      expect(mobileLtp.querySelector('.last-trade-move')?.textContent).toBe('−₹5.00')
      expect(container.querySelector('.ledger-mobile-row')?.tagName).toBe('DIV')
      expect(container.querySelector('.ledger-mobile-row[aria-expanded], .ledger-mobile-detail, .ledger-mobile-chevron')).toBeNull()
      expect(container.querySelector('.table--ledger .ledger-caret')).toBeNull()

      state.store = { ...state.store, settings: { ...state.store.settings, hideValues: true } }
      await render()
      expect(container.querySelector('.ticker-item')?.textContent).toBe('Bank Nifty')
      expect(container.querySelector('.last-trade')?.textContent).toBe('••••••••••••')
      expect(container.querySelector('.ltp-arrow')).toBeNull()

      expect(container.querySelector('.ledger-mobile-list .up, .ledger-mobile-list .down')).toBeNull()
      expect(container.querySelector('.ledger-mobile-last-trade')?.textContent).not.toContain('₹')

      state.store = { ...state.store, settings: { ...state.store.settings, hideValues: false, allowExternalData: false } }
      await render()
      expect(container.querySelector('[data-indices-allowed]')?.getAttribute('data-indices-allowed')).toBe('false')
      expect(container.querySelector('.last-trade-move')?.textContent).toBe('—')
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps performance in sync with Ledger scope without duplicating the moved allocation', async () => {
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
      expect(container.querySelector('[aria-label="Allocation mix"], .alloc-summary, .alloc-more')).toBeNull()
      expect(panel.querySelector('.portfolio-performance')?.getAttribute('data-scope')).toBe('all')
      const equity = [...container.querySelectorAll<HTMLButtonElement>('.panel--ledger .scope-btn')].find((button) => button.textContent?.startsWith('Equity'))!
      await act(async () => equity.click())
      expect(panel.querySelector('.portfolio-performance')?.getAttribute('data-scope')).toBe('equity')
    } finally {
      await act(async () => root.unmount())
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
      const allFund = container.querySelector<HTMLButtonElement>('.table--ledger [aria-label="Show details for Fund 0"]')!
      expect(allFund).not.toBeNull()
      await act(async () => allFund.click())
      expect(allFund.getAttribute('aria-expanded')).toBe('true')
      expect(container.querySelector('.table--ledger .ledger-fund-detail')?.textContent).toContain('Imported XIRR')
      await act(async () => allFund.click())
      const allMobileFund = container.querySelector<HTMLButtonElement>('.ledger-mobile-row--fund')!
      await act(async () => allMobileFund.click())
      expect(allMobileFund.getAttribute('aria-expanded')).toBe('true')
      await act(async () => allMobileFund.click())
      await act(async () => container.querySelectorAll<HTMLButtonElement>('.scope-btn')[2].click())
      const mobileFund = container.querySelector<HTMLButtonElement>('.ledger-mobile-row')!
      await act(async () => mobileFund.click())
      expect(mobileFund.getAttribute('aria-expanded')).toBe('true')
      expect(container.querySelector('.ledger-mobile-detail')?.textContent).toContain('Imported XIRR')
      await act(async () => mobileFund.click())
      expect(container.querySelector('.ledger-mobile-detail')).toBeNull()
      const summary = container.querySelector('.mf-summary')
      expect(summary?.textContent).not.toContain('Portfolio XIRR')
      expect(summary?.textContent).not.toContain('Requires dated cash flows')
      expect(summary?.textContent).not.toContain('18.00%')
      expect(container.textContent).toContain('+12.00%')
      expect(container.textContent).toContain('+24.00%')
      const mergedPositions = positions.map((position) => ({ ...position, ticker: 'Combined Fund', name: 'Combined Fund' }))
      const mergedFolios = [{ ...folios[0], positions: mergedPositions }]
      const snapshot = investmentWorkspace.readSnapshot({ folios: mergedFolios, quotes: {} })
      state.store = { ...state.store, positions: snapshot.positions, rawPositions: mergedPositions, folios: mergedFolios, snapshot }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector('.panel--ledger .table tbody tr td:nth-child(6)')?.textContent).toBe('—')
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Show details for Combined Fund"]')?.click())
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
      expect(card.querySelector('.market-status-copy')?.textContent).toBe('Market closed')
      expect(card.querySelector('.market-refresh-details')).toBeNull()
      expect(container.querySelector('.quote-freshness')).toBeNull()
      expect(card.querySelector('.market-status-copy')?.children).toHaveLength(0)
      expect([...card.querySelectorAll('.market-session time')].map((node) => node.getAttribute('datetime'))).toEqual(['2026-10-01T10:00:00.000Z', '2026-10-05T03:45:00.000Z'])
      expect(card.querySelector<HTMLDetailsElement>('.market-calendar-details')?.open).toBe(false)
      expect(card.querySelector('.market-calendar-details summary')?.textContent).toBe('Market calendarSessions & holidays')
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

  it('excludes unpriced holdings from P&L and keeps index work independent of holding count', async () => {
    const positions: Position[] = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), ticker: `HOLD${i}`, name: `Holding ${i}`, type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: i === 4999 ? null : 120 }))
    const folios = [{ id: 'test', name: 'Test', importedAt: Date.now(), positions }]
    const snapshot = investmentWorkspace.readSnapshot({ folios, quotes: {} })
    state.store = { positions, rawPositions: positions, folios, snapshot, liveQuotes: {}, settings: { ...loadSettings(), allowExternalData: false }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null } as unknown as ReturnType<typeof useStore>
    state.format.mockClear()
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(container.querySelector('.score--session .score-value')?.textContent).toBe('—')
      expect(container.querySelector('.score--session')?.textContent).toContain('Awaiting updates')
      expect(snapshot.unpricedCount).toBe(1)
      expect(snapshot.pnl).toBe(99_980)
      expect(container.querySelectorAll('.ticker-item')).toHaveLength(2)
      expect(state.format.mock.calls.length).toBeLessThan(1500)
      expect(container.querySelectorAll('.panel--ledger tbody > tr')).toHaveLength(25)
      const pager = container.querySelector('[aria-label="Ledger pages"]')!
      expect(pager.textContent).toContain('1–25 / 5000')
      await act(async () => [...pager.querySelectorAll('button')].find((button) => button.textContent === 'Next')!.click())
      expect(pager.textContent).toContain('26–50 / 5000')
      expect(container.querySelector('.panel--ledger tbody')?.textContent).toContain('HOLD25')
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps only the session summary beside public indices and masks private movement data', async () => {
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
    const onGoTo = vi.fn()
    try {
      await act(async () => root.render(<Overview onGoTo={onGoTo} onRequestImport={vi.fn()} />))
      const summary = container.querySelector('.overview-market-strip .scoreboard')!
      const session = summary.querySelector('[aria-label="Session summary"]')!
      expect([...summary.querySelectorAll('.score > .score-value')].map((node) => node.textContent)).toEqual(['−₹7.00'])
      expect(container.querySelector('.overview-market-strip .tiker-wrap')?.getAttribute('data-indices-allowed')).toBe('true')
      expect(container.querySelector('.score--current')).toBeNull()
      expect(container.querySelector('.score--secondary')).toBeNull()
      expect(session.querySelector('.score-value')?.getAttribute('aria-label')).toBe('Latest session · 01 Oct 2026 portfolio move: −₹7.00')
      expect(session.querySelector('.score-value')?.classList.contains('down')).toBe(true)
      expect(session.querySelector('time')?.dateTime).toBe('2026-10-01')
      expect(session.textContent).toBe('Session move−₹7.0001 Oct 2026')
      expect(session.querySelector('.score-label button')?.getAttribute('aria-label')).toBeNull()
      expect(session.querySelector('.score-label button')?.getAttribute('title')).toBe('Open Insights')
      expect(session.lastElementChild?.classList.contains('score-session-basis')).toBe(true)
      expect(container.querySelector('.daily-brief, .performer-half, .score-move')).toBeNull()
      await act(async () => session.querySelector<HTMLButtonElement>('button')!.click())
      expect(onGoTo).toHaveBeenCalledExactlyOnceWith('insights')
      const orderedPanels = [...container.querySelectorAll('.span-grid > *')].map((node) => node.classList.contains('panel--ledger') ? 'ledger' : 'portfolio')
      expect(orderedPanels).toEqual(['ledger', 'portfolio'])
      const portfolioPanel = container.querySelector('.panel--portfolio')!
      expect(portfolioPanel.querySelector('.portfolio-performance')).not.toBeNull()
      expect(portfolioPanel.querySelector('.portfolio-allocation')).toBeNull()

      const gainQuotes = { ...quotes, [quoteKey(positions[0])]: { ...quotes[quoteKey(positions[0])], change: 7 } }
      state.store = { ...state.store, snapshot: investmentWorkspace.readSnapshot({ folios, quotes: gainQuotes }) }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(session.querySelector('.score-value')?.textContent).toBe('+₹8.00')
      expect(session.querySelector('.score-value')?.classList.contains('up')).toBe(true)

      const flatQuotes = Object.fromEntries(Object.entries(quotes).map(([key, quote]) => [key, { ...quote, change: 0 }]))
      state.store = { ...state.store, snapshot: investmentWorkspace.readSnapshot({ folios, quotes: flatQuotes }) }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(session.querySelector('.score-value')?.textContent).toBe('+₹0.00')
      expect(session.querySelector('.score-value')?.classList.contains('up')).toBe(false)
      expect(session.querySelector('.score-value')?.classList.contains('down')).toBe(false)

      state.store = { ...state.store, settings: { ...state.store.settings, hideValues: true } }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect([...summary.querySelectorAll('.score-value')].every((node) => node.textContent === '••••••')).toBe(true)
      expect(session.querySelector('.score-value')?.getAttribute('aria-label')).toBe('Session movement hidden')
      expect(session.querySelector('.score-session-basis')?.getAttribute('title')).toBeNull()
      expect(summary.textContent).not.toMatch(/₹|WIN|LOSS|20\.00|10\.00/)
      const labels = [...container.querySelectorAll('[title], [aria-label]')].map(element => `${element.getAttribute('title') || ''} ${element.getAttribute('aria-label') || ''}`).join(' ')
      expect(labels).not.toMatch(/WIN|LOSS/)
      expect(session.textContent).not.toMatch(/gained|lost|₹/)
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps mixed session moves stock/ETF-only and restores the scoped published NAV move', async () => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const positions: Position[] = [
      { id: 'stock', ticker: 'STOCK', name: 'Stock', type: 'stock', quantity: 2, buyPrice: 100, invested: 200, lastPrice: 110 },
      { id: 'etf', ticker: 'ETF', name: 'ETF', type: 'etf', quantity: 3, buyPrice: 45, invested: 135, lastPrice: 50 },
      { id: 'fund', ticker: 'FUND', name: 'Fund', type: 'mutual-fund', quantity: 5, buyPrice: 100, invested: 500, lastPrice: 120, mfScheme: { code: 123, name: 'Fund', source: 'confirmed' } },
    ]
    const folios = [{ id: 'scope', name: 'Scope', importedAt: Date.now(), positions }]
    const quotes = {
      [quoteKey(positions[0])]: { price: 110, change: 5, at: Date.now(), source: 'yahoo' as const },
      [quoteKey(positions[1])]: { price: 50, change: 2, at: Date.now(), source: 'yahoo' as const },
      [quoteKey(positions[2])]: { price: 120, change: 2, at: Date.now(), source: 'nav' as const },
    }
    state.store = { positions, rawPositions: positions, snapshot: investmentWorkspace.readSnapshot({ folios, quotes }), settings: { ...loadSettings(), hideValues: false, allowExternalData: true }, refreshNow: vi.fn(), marketDataRefreshing: false } as unknown as ReturnType<typeof useStore>
    expect(state.store.snapshot.dailyChange).toBe(26)
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      const movement = () => container.querySelector('.score--session .score-value')?.textContent
      expect(movement()).toBe('+₹16.00')
      expect(container.querySelector('.score--session')?.textContent).toContain('2 of 2 stocks + ETFs')
      expect(container.querySelector('.score--session .score-value')?.getAttribute('aria-label')).toContain('stocks + ETFs move')
      const symbolHeader = container.querySelector<HTMLTableCellElement>('.table--ledger th')!
      const sortButton = symbolHeader.querySelector('button')!
      const scopeButton = container.querySelector('.overview-actions .scope-btn')
      expect(symbolHeader.getAttribute('aria-sort')).toBe('none')
      await act(async () => sortButton.click())
      expect(container.querySelector('.table--ledger th')?.getAttribute('aria-sort')).toBe('ascending')
      expect(container.querySelector('.table--ledger th button')).toBe(sortButton)
      expect(container.querySelector('.overview-actions .scope-btn')).toBe(scopeButton)
      await act(async () => container.querySelector<HTMLButtonElement>('.table--ledger th button')!.click())
      expect(container.querySelector('.table--ledger th')?.getAttribute('aria-sort')).toBe('descending')
      const choose = async (label: string) => act(async () => [...container.querySelectorAll<HTMLButtonElement>('.overview-actions .scope-btn')].find((button) => button.textContent?.startsWith(label))!.click())
      await choose('Mutual Funds')
      expect(movement()).toBe('+₹10.00')
      expect(container.querySelector('.score--session')?.textContent).toContain('NAV move')
      expect(container.querySelector('.score--session')?.textContent).toContain('1 of 1 published NAVs')
      expect(container.querySelector('.score--session .score-value')?.getAttribute('aria-label')).toContain('published NAV move')
      expect(container.querySelectorAll('.scoreboard > .score')).toHaveLength(1)
      expect(container.querySelector('.portfolio-performance')?.getAttribute('data-scope')).toBe('mutual')
      expect(container.querySelector('.panel--ledger')?.textContent).not.toContain('XIRR')
      await choose('Equity')
      expect(movement()).toBe('+₹16.00')
      await choose('All')
      expect(movement()).toBe('+₹16.00')
    } finally { await act(async () => root.unmount()); canvas.mockRestore() }
  })

  it('labels incomplete session coverage without presenting it as a portfolio-wide move', async () => {
    const positions: Position[] = ['A', 'B', 'FUND'].map((ticker) => ({
      id: ticker, ticker, name: ticker, type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110,
    }))
    positions[1] = { ...positions[1], type: 'etf' }
    positions[2] = { ...positions[2], type: 'mutual-fund', mfScheme: { code: 123, name: 'FUND', source: 'confirmed' } }
    const folios = [{ id: 'f', name: 'Portfolio', importedAt: 1, positions }]
    const quotes = { [quoteKey(positions[0])]: { price: 110, change: 10, at: Date.parse('2026-10-01T10:00:00Z'), source: 'yahoo' as const } }
    const snapshot = investmentWorkspace.readSnapshot({ folios, quotes })
    state.store = { positions, rawPositions: positions, folios, snapshot, liveQuotes: quotes, settings: { ...loadSettings(), hideValues: false, allowExternalData: true }, setSettings: vi.fn(), refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null } as unknown as ReturnType<typeof useStore>
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      const brief = container.querySelector('.score--session')!
      expect(brief.querySelector('.score-label')?.textContent).toBe('Reported move')
      expect(brief.textContent).toContain('1 of 2 stocks + ETFs')
      expect(brief.querySelector('.score-session-basis')?.getAttribute('title')).toContain('Remaining updates pending')
      expect(brief.textContent).toContain('01 Oct 2026')
      expect(brief.textContent).not.toMatch(/tailwind|Today|Your portfolio gained/)
      expect(brief.querySelector('.score-value')?.textContent).toBe('+₹10.00')
      expect(brief.querySelector('.score-value')?.getAttribute('aria-label')).toContain('reported holdings move')
      const equityComplete = { ...quotes, [quoteKey(positions[1])]: { ...quotes[quoteKey(positions[0])], change: -1 } }
      state.store = { ...state.store, snapshot: investmentWorkspace.readSnapshot({ folios, quotes: equityComplete }) }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(brief.querySelector('.score-label')?.textContent).toBe('Session move')
      expect(brief.textContent).toContain('2 of 2 stocks + ETFs')
      expect(brief.querySelector('.score-value')?.textContent).toBe('+₹9.00')
      expect(brief.querySelector('.score-session-basis')?.getAttribute('title')).not.toContain('pending')
      state.store = { ...state.store, settings: { ...state.store.settings, hideValues: true } }
      await act(async () => root.render(<Overview onGoTo={vi.fn()} onRequestImport={vi.fn()} />))
      expect(brief.querySelector('.score-value')?.textContent).toBe('••••••')
      expect(brief.textContent).not.toContain('1 of 2 stocks + ETFs')
      expect(brief.textContent).not.toContain('2 of 2 stocks + ETFs')
      expect(brief.textContent).not.toMatch(/gained|lost|₹/)
    } finally { await act(async () => root.unmount()) }
  })
})
