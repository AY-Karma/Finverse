// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MarketRefreshStatus } from './MarketRefreshStatus'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('shows only the next refresh countdown below market status and hides it while disabled or checking', async () => {
  vi.useFakeTimers()
  const now = Date.parse('2026-10-30T06:00:00Z')
  vi.setSystemTime(now)
  const container = document.createElement('div')
  const root = createRoot(container)
  const props = { externalEnabled: true, refreshing: false, lastCheckedAt: now, nextRefreshAt: now + 30_000 }
  try {
    await act(async () => root.render(<MarketRefreshStatus {...props} />))
    expect(container.textContent).toBe('Market openNext refresh in 30s')
    expect(container.querySelector('select, details')).toBeNull()
    expect(container.querySelector('.market-refresh-next')?.closest('[role="status"]')).toBeNull()
    await act(async () => vi.advanceTimersByTime(5000))
    expect(container.textContent).toBe('Market openNext refresh in 25s')
    await act(async () => root.render(<MarketRefreshStatus {...props} refreshing />))
    expect(container.textContent).toBe('Checking prices…')
    await act(async () => root.render(<MarketRefreshStatus {...props} externalEnabled={false} />))
    expect(container.textContent).toBe('External market data off · showing imported prices')
  } finally { await act(async () => root.unmount()); vi.useRealTimers() }
})
