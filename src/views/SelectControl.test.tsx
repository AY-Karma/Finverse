// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SelectControl } from './SelectControl'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const options = [{ value: 'groww', label: 'Groww' }, { value: 'indmoney', label: 'INDmoney' }]
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
const captureDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture')
let container: HTMLDivElement
let root: Root
let nextAction: Mock<() => void>
let changed: Mock<(value: string) => void>

function Fields() {
  const [value, setValue] = useState('groww')
  const [payment, setPayment] = useState('bank')
  return <form onSubmit={(event) => event.preventDefault()}><SelectControl label="Provider" value={value} onChange={(next) => { changed(next); setValue(next) }} options={options} /><SelectControl label="Payment" value={payment} onChange={setPayment} options={[{ value: 'bank', label: 'Bank mandate' }, { value: 'upi', label: 'UPI mandate' }]} /><button type="button" onClick={nextAction}>Next action</button></form>
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
const trigger = () => container.querySelector<HTMLButtonElement>('.select-control-trigger')!
const nextButton = () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Next action')!
const mouse = (type: string, detail: number) => new MouseEvent(type, { bubbles: true, cancelable: true, detail, clientX: 30, clientY: 30 })

beforeEach(async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false })
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container); nextAction = vi.fn(); changed = vi.fn()
  await act(async () => root.render(<Fields />))
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove()
  vi.unstubAllGlobals()
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  if (captureDescriptor) Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', captureDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture')
})

describe('shared dropdown gestures', () => {
  it('opens a mouse trigger on completed click rather than pointerdown', async () => {
    const down = mouse('pointerdown', 0)
    Object.defineProperty(down, 'pointerType', { value: 'mouse' })
    await act(async () => trigger().dispatchEvent(down))
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    await act(async () => trigger().dispatchEvent(mouse('click', 1)))
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
  })

  it('consumes double and triple selection clicks without activating the uncovered control or losing focus', async () => {
    await act(async () => trigger().click())
    await settle()
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === 'INDmoney')!
    vi.spyOn(option, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 200, 40))
    await act(async () => option.dispatchEvent(mouse('click', 1)))
    await settle()
    expect(trigger().textContent).toContain('INDmoney')
    expect(document.activeElement).toBe(trigger())
    for (const detail of [2, 3]) {
      const down = mouse('mousedown', detail)
      const click = mouse('click', detail)
      const doubleClick = mouse('dblclick', detail)
      await act(async () => { nextButton().dispatchEvent(down); nextButton().dispatchEvent(click); nextButton().dispatchEvent(doubleClick) })
      expect(down.defaultPrevented).toBe(true)
      expect(click.defaultPrevented).toBe(true)
      expect(doubleClick.defaultPrevented).toBe(true)
      expect(nextAction).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(trigger())
    }
    expect(changed).toHaveBeenCalledExactlyOnceWith('indmoney')
    const ordinaryDown = mouse('mousedown', 1)
    const ordinaryClick = mouse('click', 1)
    await act(async () => { nextButton().dispatchEvent(ordinaryDown); nextButton().focus(); nextButton().dispatchEvent(ordinaryClick) })
    await settle()
    expect(ordinaryDown.defaultPrevented).toBe(false)
    expect(ordinaryClick.defaultPrevented).toBe(false)
    expect(nextAction).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(nextButton())
  })

  it('preserves keyboard selection and Escape focus return', async () => {
    await act(async () => { trigger().focus(); trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    await settle()
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === 'INDmoney')!
    await act(async () => { option.focus(); option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    await settle()
    expect(trigger().textContent).toContain('INDmoney')
    expect(document.activeElement).toBe(trigger())
    await act(async () => trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    await settle()
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await settle()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
  })

  it('restores trigger focus in the close update before the next keyboard action', async () => {
    await act(async () => trigger().click())
    await settle()
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
  })

  it('does not open another dropdown underneath a repeated selection click', async () => {
    await act(async () => trigger().click())
    await settle()
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === 'INDmoney')!
    vi.spyOn(option, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 200, 40))
    await act(async () => option.dispatchEvent(mouse('click', 1)))
    await settle()
    const underlying = container.querySelectorAll<HTMLButtonElement>('.select-control-trigger')[1]
    const down = mouse('pointerdown', 0)
    Object.defineProperty(down, 'pointerType', { value: 'mouse' })
    await act(async () => {
      underlying.dispatchEvent(down)
      underlying.dispatchEvent(mouse('mousedown', 2))
      underlying.dispatchEvent(mouse('click', 2))
    })
    expect(underlying.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
    expect(changed).toHaveBeenCalledExactlyOnceWith('indmoney')
  })

  it('keeps grouped labels out of the selectable choices and connects external field descriptions', async () => {
    await act(async () => root.render(<><label id="index-label" htmlFor="index">Market index</label><SelectControl id="index" label="Market index" labelledBy="index-label" describedBy="index-description" value="nifty" options={[
      { value: 'nifty', label: 'NIFTY 50', group: 'India' },
      { value: 'bank', label: 'NIFTY Bank', group: 'India' },
      { value: 'sp500', label: 'S&P 500', group: 'Global' },
    ]} onChange={changed} /><p id="index-description">Left index on Overview.</p></>))
    expect(trigger().getAttribute('aria-labelledby')).toBe('index-label index-value')
    expect(trigger().getAttribute('aria-describedby')).toBe('index-description')
    await act(async () => trigger().click())
    await settle()
    expect([...document.querySelectorAll('.select-control-group-label')].map((element) => element.textContent)).toEqual(['India', 'Global'])
    expect([...document.querySelectorAll('[role="option"]')].map((element) => element.textContent)).toEqual(['NIFTY 50', 'NIFTY Bank', 'S&P 500'])
    const global = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((element) => element.textContent === 'S&P 500')!
    await act(async () => { global.focus(); global.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(changed).toHaveBeenCalledExactlyOnceWith('sp500')
    expect(document.activeElement).toBe(trigger())
  })
})
