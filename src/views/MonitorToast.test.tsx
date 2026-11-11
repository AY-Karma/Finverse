// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MonitorToast } from './MonitorToast'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let container: HTMLDivElement, root: Root

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

async function render(message: string, revision = 0) {
  await act(async () => root.render(<MonitorToast message={message} revision={revision} />))
}
async function advance(ms: number) { await act(async () => vi.advanceTimersByTime(ms)) }

it('keeps a message readable for four seconds, then removes it after the exit', async () => {
  await render('Watch saved')
  await advance(3999)
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Watch saved')
  expect(container.querySelector('.mp-toast--closing')).toBeNull()
  await advance(1)
  expect(container.querySelector('.mp-toast--closing')).not.toBeNull()
  await advance(200)
  expect(container.querySelector('.mp-toast')).toBeNull()
})

it('reuses the current toast when a new message interrupts its dismissal', async () => {
  await render('Watch saved')
  const toast = container.querySelector('.mp-toast')
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
  await advance(100)
  await render('Watch removed', 1)
  expect(container.querySelector('.mp-toast')).toBe(toast)
  expect(toast?.classList.contains('mp-toast--closing')).toBe(false)
  await advance(100)
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Watch removed')
  await advance(3900)
  expect(container.querySelector('.mp-toast--closing')).toBe(toast)
  await advance(200)
  expect(container.querySelector('.mp-toast')).toBeNull()
})

it('refreshes the display time for an identical message without remounting', async () => {
  await render('Watch saved')
  const toast = container.querySelector('.mp-toast')
  await advance(3000)
  await render('Watch saved', 1)
  await advance(1000)
  expect(container.querySelector('.mp-toast')).toBe(toast)
  expect(toast?.classList.contains('mp-toast--closing')).toBe(false)
})
