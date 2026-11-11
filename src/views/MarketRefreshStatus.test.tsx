// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MarketRefreshStatus } from './MarketRefreshStatus'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('keeps the timing row while switching between countdown and checking', async () => {
  vi.useFakeTimers()
  const now = Date.parse('2026-10-30T06:00:00Z')
  vi.setSystemTime(now)
  const container = document.createElement('div')
  const root = createRoot(container)
  const props = { externalEnabled: true, refreshing: false, lastCheckedAt: now, nextRefreshAt: now + 30_000 }
  try {
    await act(async () => root.render(<MarketRefreshStatus {...props} />))
    expect(container.textContent).toBe('Market openNext refresh in 30s')
    expect(container.querySelector('[data-periodic="true"]')).not.toBeNull()
    expect(container.querySelector('select, details')).toBeNull()
    expect(container.querySelector('.market-refresh-next')?.closest('[role="status"]')).toBeNull()
    await act(async () => vi.advanceTimersByTime(5000))
    expect(container.textContent).toBe('Market openNext refresh in 25s')
    await act(async () => root.render(<MarketRefreshStatus {...props} refreshing />))
    expect(container.textContent).toBe('Market openChecking prices…')
    await act(async () => root.render(<MarketRefreshStatus {...props} externalEnabled={false} />))
    expect(container.textContent).toBe('External market data off · showing imported prices')
    expect(container.querySelector('[data-periodic="false"]')).not.toBeNull()
  } finally { await act(async () => root.unmount()); vi.useRealTimers() }
})

it('keeps the same timing and issue slots across healthy, pending, retained and recovered refreshes', async () => {
  vi.useFakeTimers()
  const now = Date.parse('2026-10-30T06:00:00Z')
  vi.setSystemTime(now)
  const container = document.createElement('div'), root = createRoot(container)
  const props = { externalEnabled: true, refreshing: false, nextRefreshAt: now + 5000 }
  try {
    await act(async () => root.render(<MarketRefreshStatus {...props} />))
    const timing = container.querySelector('.market-refresh-next'), issue = container.querySelector('.market-refresh-issue')
    expect(issue?.getAttribute('aria-hidden')).toBe('true')
    await act(async () => root.render(<MarketRefreshStatus {...props} refreshing nextRefreshAt={null} />))
    expect(container.querySelector('.market-refresh-next')).toBe(timing)
    expect(timing?.textContent).toBe('Checking prices…')
    expect(container.querySelector('.market-status-copy')?.textContent).toBe('Market open')
    const message = '13 quotes retained from previous or imported values.'
    await act(async () => root.render(<MarketRefreshStatus {...props} issue={message} />))
    expect(container.querySelector('.market-refresh-issue')).toBe(issue)
    expect(issue?.textContent).toBe(message)
    expect(issue?.getAttribute('role')).toBe('status')
    await act(async () => root.render(<MarketRefreshStatus {...props} refreshing issue={message} />))
    expect(issue?.textContent).toBe(message)
    await act(async () => root.render(<MarketRefreshStatus {...props} />))
    expect(container.querySelector('.market-refresh-issue')).toBe(issue)
    expect(issue?.textContent).toBe('')
    expect(issue?.getAttribute('aria-hidden')).toBe('true')
  } finally { await act(async () => root.unmount()); vi.useRealTimers() }
})
