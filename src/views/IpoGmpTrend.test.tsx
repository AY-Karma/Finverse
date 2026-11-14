// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IpoGmpSparkline, IpoGmpTrend } from './IpoGmpTrend'
import type { IpoGmpPoint } from '../ipoGmpHistoryProtocol'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root, container: HTMLDivElement
const retry = vi.fn(), close = vi.fn()
const points: IpoGmpPoint[] = [{ date: '2026-10-30', amount: -5 }, { date: '2026-10-31', amount: 0 }, { date: '2026-11-02', amount: 8 }]
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); retry.mockReset(); close.mockReset() })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
const render = (values = points, status: 'ready' | 'loading' | 'error' = 'ready') => act(async () => root.render(<IpoGmpTrend id="trend" name="Example" points={values} sourceUrl="https://gmptoday.in/ipo/example/" status={status} onRetry={retry} onClose={close} />))

it('shows genuine dated values and lets the user select each day with keyboard controls', async () => {
  await render()
  const slider = container.querySelector<HTMLElement>('[role="slider"]')!
  expect(slider.getAttribute('aria-valuetext')).toBe('2 Nov, GMP ₹8.00')
  await act(async () => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
  expect(slider.getAttribute('aria-valuetext')).toBe('31 Oct, GMP ₹0.00')
  await act(async () => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
  expect(slider.getAttribute('aria-valuetext')).toBe('30 Oct, GMP -₹5.00')
  expect(container.querySelector('.mi-trend-plot path[stroke="currentColor"]')!.getAttribute('d')!.match(/M/g)).toHaveLength(2)
  expect(container.textContent).toContain('Reported days only')
  expect(container.querySelector('.mi-trend-source a')?.getAttribute('href')).toBe('https://gmptoday.in/ipo/example/')
})

it('selects the nearest actual observation on tap without creating a missing-day value', async () => {
  await render()
  const slider = container.querySelector<HTMLElement>('[role="slider"]')!
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 360 } as DOMRect)
  await act(async () => slider.dispatchEvent(new MouseEvent('pointerdown', { clientX: 130, bubbles: true })))
  expect(slider.getAttribute('aria-valuetext')).toBe('31 Oct, GMP ₹0.00')
  expect(container.querySelector('.mi-trend-reading')?.textContent).not.toContain('1 Nov')
})

it('renders flat zero and single-day series without an invented slope or invalid coordinates', async () => {
  await act(async () => root.render(<IpoGmpSparkline points={[{ date: '2026-11-01', amount: 0 }, { date: '2026-11-02', amount: 0 }]} />))
  expect(container.querySelector('svg')?.getAttribute('data-tone')).toBe('flat')
  expect(container.querySelector('path')?.getAttribute('d')).toBe('M3.00 11.00 L45.00 11.00')
  await render([{ date: '2026-11-01', amount: 0 }])
  expect(container.textContent).toContain('One reported day')
  expect(container.querySelector('svg')?.innerHTML).not.toMatch(/NaN|Infinity/)
})

it('distinguishes preparation from absent observations without drawing a made-up trend', async () => {
  await act(async () => root.render(<IpoGmpSparkline points={[]} status="loading" />))
  expect(container.textContent).toBe('…')
  expect(container.querySelector('svg')).toBeNull()
  await act(async () => root.render(<IpoGmpSparkline points={[]} status="ready" />))
  expect(container.textContent).toBe('—')
  expect(container.querySelector('svg')).toBeNull()
})

it('keeps empty, loading and failed states honest and exposes retry and close actions', async () => {
  await render([], 'loading')
  expect(container.querySelector('[role="status"]')).not.toBeNull()
  expect(container.querySelector('svg[data-tone]')).toBeNull()
  await render([], 'ready')
  expect(container.textContent).toContain('history is unavailable for this IPO')
  await render([], 'error')
  await act(async () => container.querySelector<HTMLButtonElement>('.mp-text-button')!.click())
  expect(retry).toHaveBeenCalledOnce()
  await act(async () => container.querySelector<HTMLButtonElement>('.mi-trend-close')!.click())
  expect(close).toHaveBeenCalledOnce()
})
