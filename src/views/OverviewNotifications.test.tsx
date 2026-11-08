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
})
