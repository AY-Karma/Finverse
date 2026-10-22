// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InteractiveTrendChart } from './InteractiveTrendChart'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const start = +new Date('2025-01-01T00:00:00')
const lines = [{ key: 'close', label: 'Close', color: '#5e6ad2' }]
const format = (value: number) => value.toFixed(2)
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 340))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('interactive chart controls', () => {
  it.each([360, 1000])('keeps holiday gaps connected across both viewport edges at %dpx', async (width) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, 340))
    const missing = new Set([39, 40, 41, 178, 179, 180, 181])
    const rows = Array.from({ length: 220 }, (_, index) => ({
      at: start + index * 86_400_000,
      portfolio: index,
      benchmark: missing.has(index) ? undefined : index * 2,
    }))
    await act(async () => root.render(<InteractiveTrendChart
      rows={rows}
      lines={[{ key: 'portfolio', label: 'Portfolio', color: '#828fff' }, { key: 'benchmark', label: 'Benchmark', color: '#e4b35b', connectGaps: true }]}
      valueFormatter={format} yAxisLabel="Return (%)" appearance="insight"
    />))
    const clip = container.querySelector('clipPath rect')!
    const left = Number(clip.getAttribute('x'))
    const right = left + Number(clip.getAttribute('width'))
    const benchmarkXs = () => [...(container.querySelector('.interactive-trend-line[stroke="#e4b35b"]')!.getAttribute('d') ?? '').matchAll(/[ML](-?[\d.]+),/g)].map((match) => Number(match[1]))
    expect(benchmarkXs()[0]).toBeLessThan(left)
    const chart = container.querySelector('.interactive-trend-chart > svg')!
    await act(async () => chart.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' })))
    const coordinates = benchmarkXs()
    expect(coordinates[coordinates.length - 1]).toBeGreaterThan(right)
  })

  it('selects the earlier point at a hover midpoint and updates purchase comparison through keyboard activation', async () => {
    const rows = [{ at: start, close: 100 }, { at: start + 86_400_000, close: 120 }]
    await act(async () => root.render(<InteractiveTrendChart
      rows={rows} lines={lines} valueFormatter={format} yAxisLabel="Price" appearance="price"
      markers={[{ at: start, value: 100, color: '#f2b53c', label: 'Bought', comparable: true }]}
    />))
    const chart = container.querySelector('.interactive-trend-chart > svg')!
    const clip = container.querySelector('clipPath rect')!
    const left = Number(clip.getAttribute('x'))
    const width = Number(clip.getAttribute('width'))
    const pathBefore = container.querySelector('.interactive-trend-line')!.getAttribute('d')

    await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: left + width / 2 })))
    expect(container.querySelector('.interactive-trend-tooltip strong')?.textContent).toContain('01 Jan 2025')
    expect(container.querySelector('.interactive-trend-tooltip b')?.textContent).toBe('100.00')
    await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: left + width / 2 + 1 })))
    expect(container.querySelector('.interactive-trend-tooltip b')?.textContent).toBe('120.00')
    expect(container.querySelector('.interactive-trend-line')!.getAttribute('d')).toBe(pathBefore)

    const marker = container.querySelector('[role="button"][aria-label="Compare from Bought"]')!
    await act(async () => marker.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })))
    expect(container.textContent).toContain('Select another point on the chart')
    await act(async () => chart.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: left + width, clientY: 120 })))
    expect(container.querySelector('[role="status"]')?.textContent).toContain('+20.00')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('+1 days')
    expect(container.querySelector('.interactive-trend-comparison-area')).not.toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Clear price comparison"]')!.click())
    expect(container.querySelector('.interactive-trend-comparison-area')).toBeNull()
  })

  it('rebuilds visible paths when keyboard navigation pans history and returns to the latest points', async () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({ at: start + index * 86_400_000, close: 100 + index }))
    const onReachStart = vi.fn()
    await act(async () => root.render(<InteractiveTrendChart rows={rows} lines={lines} valueFormatter={format} yAxisLabel="Price" onReachStart={onReachStart} />))
    const chart = container.querySelector('.interactive-trend-chart > svg')!
    expect(chart.getAttribute('tabindex')).toBe('0')
    const latestPath = container.querySelector('.interactive-trend-line')!.getAttribute('d')
    await act(async () => chart.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' })))
    expect(onReachStart).toHaveBeenCalledOnce()
    expect(container.querySelector('.interactive-trend-line')!.getAttribute('d')).not.toBe(latestPath)
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Jump to latest prices"]')?.disabled).toBe(false)
    await act(async () => chart.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' })))
    expect(container.querySelector('.interactive-trend-line')!.getAttribute('d')).toBe(latestPath)
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Showing latest prices"]')?.disabled).toBe(true)
  })
})
