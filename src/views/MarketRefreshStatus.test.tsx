// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { MarketRefreshStatus } from './MarketRefreshStatus'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('keeps market status stable during refreshes and labels imported prices when external data is off', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const props = { externalEnabled: true, now: new Date('2026-10-30T06:00:00Z') }
  try {
    await act(async () => root.render(<MarketRefreshStatus {...props} />))
    expect(container.textContent).toBe('Market open')
    const dot = container.querySelector('.live-dot')!
    const restingClass = dot.className
    await act(async () => root.render(<MarketRefreshStatus {...props} now={new Date(props.now.getTime() + 1_000)} />))
    expect(container.textContent).toBe('Market open')
    expect(dot.className).toBe(restingClass)
    await act(async () => root.render(<MarketRefreshStatus {...props} externalEnabled={false} />))
    expect(container.textContent).toBe('External market data off · showing imported prices')
  } finally { await act(async () => root.unmount()) }
})

it('preserves a material quote issue through refreshes and clears it after recovery', async () => {
  const container = document.createElement('div'), root = createRoot(container)
  const props = { externalEnabled: true, now: new Date('2026-10-30T06:00:00Z') }
  try {
    await act(async () => root.render(<MarketRefreshStatus {...props} />))
    const issue = () => container.querySelector('.market-refresh-issue')
    expect(issue()?.getAttribute('aria-hidden')).toBe('true')
    const message = '13 quotes retained from previous or imported values.'
    await act(async () => root.render(<MarketRefreshStatus {...props} issue={message} />))
    expect(issue()?.textContent).toBe(message)
    expect(issue()?.getAttribute('role')).toBe('status')
    await act(async () => root.render(<MarketRefreshStatus {...props} now={new Date(props.now.getTime() + 1_000)} issue={message} />))
    expect(issue()?.textContent).toBe(message)
    await act(async () => root.render(<MarketRefreshStatus {...props} />))
    expect(issue()?.textContent).toBe('')
    expect(issue()?.getAttribute('aria-hidden')).toBe('true')
  } finally { await act(async () => root.unmount()) }
})
