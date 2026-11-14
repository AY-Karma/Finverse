// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useMonitor } from '../useMonitor'
import { OverviewNotifications } from './OverviewNotifications'

vi.mock('../useMonitor', () => ({ useMonitor: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('Overview notifications', () => {
  it('surfaces only today’s IPO deadline in IST and allows completion without navigating', async () => {
    const remove = vi.fn(), navigate = vi.fn()
    vi.mocked(useMonitor).mockReturnValue({ now: Date.UTC(2026, 10, 7, 19), hideValues: false, events: [], alerts: [], statusMessage: '',
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
      expect(navigate).toHaveBeenCalledWith('holdings', 'monitor-ipos-heading')
    } finally { await act(async () => root.unmount()) }
  })

  it('hides personal signals and provides a neutral empty state', async () => {
    const controller = { now: Date.now(), hideValues: true, events: [], alerts: [], ipoWatches: [], statusMessage: '' }
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
    vi.mocked(useMonitor).mockReturnValue({ now: Date.now(), hideValues: false, events: [], alerts: [], ipoWatches: [], statusMessage: '' } as unknown as ReturnType<typeof useMonitor>)
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
    vi.mocked(useMonitor).mockReturnValue({ now: Date.now(), hideValues: false, events: [], alerts: [], ipoWatches: [], statusMessage: '' } as unknown as ReturnType<typeof useMonitor>)
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
})
