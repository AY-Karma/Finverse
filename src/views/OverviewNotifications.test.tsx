// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useMonitor } from '../useMonitor'
import { holdingIdentity } from '../monitor'
import { loadMarketEvents } from '../marketEvents'
import { OverviewNotifications } from './OverviewNotifications'

vi.mock('../useMonitor', () => ({ useMonitor: vi.fn() }))
vi.mock('../marketEvents', () => ({ loadMarketEvents: vi.fn(), EVENTS_REFRESH_MS: 15 * 60_000 }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('Overview notifications', () => {
  it('surfaces only today’s IPO deadline in IST and allows completion without navigating', async () => {
    const remove = vi.fn(), navigate = vi.fn()
    vi.mocked(useMonitor).mockReturnValue({ now: Date.UTC(2026, 10, 7, 19), hideValues: false, sipPlans: [], events: [], alerts: [], statusMessage: '',
      ipoWatches: ['2026-11-07', '2026-11-08', '2026-11-09'].map((closeDate) => ({ id: closeDate, name: `IPO ${closeDate}`, closeDate, openDate: null, sourceUrl: 'https://www.xflot.com/ipo/test' })), deleteIpoWatch: remove,
    } as unknown as ReturnType<typeof useMonitor>)
    const container = document.createElement('div'), root = createRoot(container)
    try {
      await act(async () => root.render(<OverviewNotifications onGoTo={navigate} />))
      expect(container.querySelector('[data-action-due="true"]')).not.toBeNull()
      expect(container.querySelectorAll('li')).toHaveLength(1)
      expect(container.querySelector('li')?.textContent).toContain('IPO 2026-11-08')
      await act(async () => container.querySelector<HTMLButtonElement>('.overview-notice-done')!.click())
      expect(remove).toHaveBeenCalledWith('2026-11-08')
      expect(navigate).not.toHaveBeenCalled()
      await act(async () => container.querySelector<HTMLButtonElement>('.overview-notice-link')!.click())
      expect(navigate).toHaveBeenCalledWith('holdings', 'monitor-ipos')
    } finally { await act(async () => root.unmount()) }
  })

  it('reminds about an active SIP instalment on its date in India and opens its settings', async () => {
    const navigate = vi.fn()
    const plan = { id: 'sip-1', schemeCode: 1, schemeName: 'Example Flexi Cap Fund Direct Growth', amount: 5000, day: 5, start: '2026-12-05', provider: 'groww', method: 'Provider AutoPay', paused: false }
    vi.mocked(useMonitor).mockReturnValue({ now: Date.UTC(2026, 11, 4, 19), hideValues: false, events: [], alerts: [], ipoWatches: [], statusMessage: '',
      sipPlans: [plan, { ...plan, id: 'sip-2', schemeName: 'Paused fund', paused: true }, { ...plan, id: 'sip-3', schemeName: 'Skipped fund', skipDate: '2026-12-05' }],
    } as unknown as ReturnType<typeof useMonitor>)
    const container = document.createElement('div'), root = createRoot(container)
    try {
      await act(async () => root.render(<OverviewNotifications onGoTo={navigate} />))
      expect([...container.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['Example Flexi Cap Fund Direct GrowthSIP instalment today · ₹5,000'])
      await act(async () => container.querySelector<HTMLButtonElement>('.overview-notice-link')!.click())
      expect(navigate).toHaveBeenCalledWith('settings', 'manage-holdings')
    } finally { await act(async () => root.unmount()) }
  })

  it('hides personal signals and provides a neutral empty state', async () => {
    const controller = { now: Date.now(), hideValues: true, sipPlans: [], events: [], alerts: [], ipoWatches: [], statusMessage: '' }
    vi.mocked(useMonitor).mockReturnValue(controller as unknown as ReturnType<typeof useMonitor>)
    const container = document.createElement('div'), root = createRoot(container)
    try {
      await act(async () => root.render(<OverviewNotifications onGoTo={vi.fn()} pendingListings={3} foliosNeedReview />))
      expect(container.textContent).not.toContain('3')
      expect(container.querySelector('[data-action-due="true"]')).toBeNull()
      controller.hideValues = false
      await act(async () => root.render(<OverviewNotifications onGoTo={vi.fn()} />))
      expect(container.textContent).toContain('No actions due today.')
    } finally { await act(async () => root.unmount()) }
  })

  it('closes on Escape and returns focus to the bell without scrolling', async () => {
    vi.mocked(useMonitor).mockReturnValue({ now: Date.now(), hideValues: false, sipPlans: [], events: [], alerts: [], ipoWatches: [], statusMessage: '' } as unknown as ReturnType<typeof useMonitor>)
    const container = document.createElement('div'), root = createRoot(container)
    document.body.append(container)
    try {
      await act(async () => root.render(<OverviewNotifications onGoTo={vi.fn()} pendingListings={1} />))
      const details = container.querySelector('details')!, bell = container.querySelector('summary')!
      const focus = vi.spyOn(bell, 'focus')
      details.open = true
      container.querySelector<HTMLButtonElement>('.overview-notice-link')!.focus()
      await act(async () => details.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(details.open).toBe(false)
      expect(document.activeElement).toBe(bell)
      expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    } finally { await act(async () => root.unmount()); container.remove() }
  })

  it('keeps repeated bell clicks and outside dismissal independent of page layout', async () => {
    vi.mocked(useMonitor).mockReturnValue({ now: Date.now(), hideValues: false, sipPlans: [], events: [], alerts: [], ipoWatches: [], statusMessage: '' } as unknown as ReturnType<typeof useMonitor>)
    const container = document.createElement('div'), root = createRoot(container)
    document.body.append(container)
    try {
      await act(async () => root.render(<OverviewNotifications onGoTo={vi.fn()} />))
      const details = container.querySelector('details')!, bell = container.querySelector('summary')!
      await act(async () => bell.click())
      expect(details.open).toBe(true)
      await act(async () => bell.click())
      expect(details.open).toBe(false)
      await act(async () => bell.click())
      await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
      expect(details.open).toBe(false)
    } finally { await act(async () => root.unmount()); container.remove() }
  })

  it('notifies followed company filings published after following, and followed calendar days on the day', async () => {
    const navigate = vi.fn(), dismiss = vi.fn()
    const krn = { id: 'krn', ticker: 'KRN', name: 'KRN', type: 'stock' as const, quantity: 1, buyPrice: 1, invested: 1, lastPrice: 1 }
    const identity = holdingIdentity(krn)
    const filing = (id: string, publishedAt: number) => ({ id, symbol: 'KRN', title: `Filing ${id}`, kind: 'filing' as const, date: '2026-11-21', dateLabel: 'Published' as const, publishedAt, source: 'NSE' as const, sourceUrl: 'https://nsearchives.nseindia.com/a.pdf', holdingId: 'krn', instrumentIdentity: identity, holdingName: 'KRN' })
    vi.mocked(loadMarketEvents).mockResolvedValue({ events: [filing('old', 1000), filing('new', 3000), filing('done', 3000)], issues: [], fetchedAt: 3000 })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ events: [], fetchedAt: '2026-11-28T00:00:00Z' })))
    vi.mocked(useMonitor).mockReturnValue({ now: Date.parse('2026-11-28T06:00:00Z'), hideValues: false, allowExternalData: true, sipPlans: [], events: [], alerts: [], ipoWatches: [], statusMessage: '', positions: [krn],
      follows: { companies: [{ identity, name: 'KRN', since: 2000 }], days: ['2026-11-28'], dismissed: ['filing:done'] }, dismissFollowNotice: dismiss,
    } as unknown as ReturnType<typeof useMonitor>)
    const container = document.createElement('div'), root = createRoot(container)
    try {
      await act(async () => root.render(<OverviewNotifications onGoTo={navigate} />))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      const items = [...container.querySelectorAll('li')].map((item) => item.textContent)
      expect(items).toEqual(['India IIP (industrial production)Today · Economic calendarDone', 'KRNNew filing · Filing newDone'])
      await act(async () => container.querySelectorAll<HTMLButtonElement>('.overview-notice-done')[1].click())
      expect(dismiss).toHaveBeenCalledWith('filing:new')
      await act(async () => container.querySelector<HTMLButtonElement>('.overview-notice-link')!.click())
      expect(navigate).toHaveBeenCalledWith('holdings', 'monitor-economy')
    } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
  })
})
