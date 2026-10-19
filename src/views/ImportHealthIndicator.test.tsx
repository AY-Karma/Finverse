// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImportHealthIndicator } from './ImportHealthIndicator'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let container: HTMLDivElement
const importedAt = Date.parse('2026-10-01T10:00:00Z')

async function render(at = importedAt) {
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root!.render(<ImportHealthIndicator importedAt={at} />))
}

beforeEach(() => vi.useFakeTimers())

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it.each([
  ['2026-10-08T10:00:00Z', 'healthy', 'Healthy import', 'within the last 7 days'],
  ['2026-10-10T10:00:00Z', 'aging', 'Aging import', 'up to 21 days'],
  ['2026-10-23T10:00:00Z', 'old', 'Old import', 'Import a recent holdings file'],
] as const)('provides a compact named indicator and hover explanation for %s', async (now, status, label, description) => {
  vi.setSystemTime(Date.parse(now))
  await render()
  const indicator = container.querySelector('[role="img"]')!
  expect(indicator.getAttribute('data-status')).toBe(status)
  expect(indicator.getAttribute('aria-label')).toBe(label)
  expect(indicator.getAttribute('tabindex')).toBe('0')
  expect(indicator.getAttribute('title')).toContain(description)
  const id = indicator.getAttribute('aria-describedby')
  expect(container.querySelector(`[id="${id}"]`)?.textContent).toContain(description)
  expect(indicator.querySelector('.dither-bar[aria-hidden="true"]')).not.toBeNull()
})

it('updates an open app when an import crosses an age boundary', async () => {
  vi.setSystemTime(Date.parse('2026-10-08T09:59:30Z'))
  await render()
  expect(container.querySelector('.import-health')?.getAttribute('data-status')).toBe('healthy')
  await act(async () => vi.advanceTimersByTime(60_000))
  expect(container.querySelector('.import-health')?.getAttribute('data-status')).toBe('aging')
})

it('refreshes age immediately when returning to the app and removes its timer on unmount', async () => {
  vi.setSystemTime(importedAt)
  await render()
  vi.setSystemTime(Date.parse('2026-10-23T10:00:00Z'))
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(container.querySelector('.import-health')?.getAttribute('data-status')).toBe('old')
  await act(async () => root!.unmount())
  root = undefined
  expect(vi.getTimerCount()).toBe(0)
})

it('refreshes on visibility and keeps invalid dates neutral', async () => {
  vi.setSystemTime(importedAt)
  await render()
  vi.setSystemTime(Date.parse('2026-10-10T10:00:00Z'))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(container.querySelector('.import-health')?.getAttribute('data-status')).toBe('aging')
  await act(async () => root!.render(<ImportHealthIndicator importedAt={Number.NaN} />))
  expect(container.querySelector('.import-health')?.getAttribute('data-status')).toBe('unknown')
  expect(container.querySelector('[role="img"]')?.getAttribute('title')).toContain('unavailable')
})
