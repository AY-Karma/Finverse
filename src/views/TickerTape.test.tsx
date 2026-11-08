// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TickerTape } from './TickerTape'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let container: HTMLDivElement, root: Root, width: number, reduced: boolean, visible: boolean
let frames: Map<number, FrameRequestCallback>, nextFrame: number
let resize: ResizeObserverCallback
let changeMotion: EventListener

beforeEach(() => {
  width = 1000; reduced = false; visible = true; nextFrame = 0; frames = new Map()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced }, addEventListener: (_type: string, callback: EventListener) => { changeMotion = callback }, removeEventListener: vi.fn() }))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback } observe() {} disconnect() {} })
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden')
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return { width: this.classList.contains('ticker-group') ? width : 390 } as DOMRect })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function render(value = '25,000') { await act(async () => root.render(<TickerTape><span className="ticker-item">NIFTY 50 {value}</span></TickerTape>)) }
function step(time: number) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(time)) }
function offset() { return Number(container.querySelector<HTMLElement>('.ticker-track')!.style.transform.match(/\((-?[\d.]+)px\)/)?.[1]) }

it('keeps equal content groups and wraps continuously without an accelerated CSS iteration', async () => {
  await render()
  const groups = container.querySelectorAll('.ticker-group')
  expect(groups).toHaveLength(2)
  expect(groups[0].textContent).toBe(groups[1].textContent)
  expect(groups[1].getAttribute('aria-hidden')).toBe('true')
  step(0)
  for (let frame = 1; frame <= 750; frame++) {
    step(frame * 64)
    expect(offset()).toBeLessThanOrEqual(0)
    expect(offset()).toBeGreaterThan(-width)
  }
  expect(offset()).toBe(0)
})

it('remeasures changing live quote widths without restarting or jumping outside the loop', async () => {
  await render(); step(0); step(64)
  const before = offset()
  width = 1500
  await render('125,000')
  resize([], {} as ResizeObserver)
  expect(offset()).toBeCloseTo(before * 1.5)
  step(128)
  expect(offset()).toBeLessThan(before)
})

it('stops while hidden and resumes without consuming the background time', async () => {
  await render(); step(0); step(64)
  const before = offset()
  visible = false; document.dispatchEvent(new Event('visibilitychange'))
  expect(frames.size).toBe(0)
  visible = true; document.dispatchEvent(new Event('visibilitychange')); step(60_000)
  expect(offset()).toBe(before)
  step(60_064)
  expect(offset()).toBeLessThan(before)
})

it('honors reduced motion changes and cleans up pending animation work', async () => {
  reduced = true; await render()
  expect(frames.size).toBe(0)
  expect(offset()).toBe(0)
  reduced = false; changeMotion(new Event('change'))
  expect(frames.size).toBe(1)
  reduced = true; changeMotion(new Event('change'))
  expect(frames.size).toBe(0)
})

it('pauses while focused so the index can be read', async () => {
  await render(); step(0); step(64)
  const before = offset()
  await act(async () => container.querySelector<HTMLElement>('.ticker')!.focus())
  step(128)
  expect(offset()).toBe(before)
  await act(async () => container.querySelector<HTMLElement>('.ticker')!.blur())
  step(192)
  expect(offset()).toBeLessThan(before)
})
