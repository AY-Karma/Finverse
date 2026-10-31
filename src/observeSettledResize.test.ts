// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { observeSettledResize } from './observeSettledResize'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('coalesces continuous size changes into one measurement after layout settles', () => {
  vi.useFakeTimers()
  let resize = () => {}
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
  const measure = vi.fn()
  const stop = observeSettledResize([document.createElement('div')], measure)
  for (let frame = 0; frame < 10; frame++) { resize(); vi.advanceTimersByTime(16) }
  expect(measure).not.toHaveBeenCalled()
  vi.advanceTimersByTime(160)
  expect(measure).toHaveBeenCalledTimes(1)
  resize()
  stop()
  vi.advanceTimersByTime(160)
  expect(measure).toHaveBeenCalledTimes(1)
  expect(disconnect).toHaveBeenCalledOnce()
})

it('retains window-resize support without ResizeObserver and cleans up pending work', () => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', undefined)
  const measure = vi.fn()
  const stop = observeSettledResize([], measure)
  window.dispatchEvent(new Event('resize'))
  vi.advanceTimersByTime(160)
  expect(measure).toHaveBeenCalledOnce()
  stop()
  window.dispatchEvent(new Event('resize'))
  vi.advanceTimersByTime(160)
  expect(measure).toHaveBeenCalledOnce()
})
