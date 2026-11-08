// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RiskHelp } from './RiskHelp'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement

async function render(top: number) {
  vi.stubGlobal('innerWidth', 390)
  vi.stubGlobal('innerHeight', 844)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return this.classList.contains('risk-help') ? new DOMRect(340, top, 24, 24) : new DOMRect(0, 0, 300, 220)
  })
  function Example() {
    const [open, setOpen] = useState(false)
    return <RiskHelp id="risk-explanation" label="Yearly swings" open={open} onOpenChange={setOpen}><span>Complete calculation and screening guide</span></RiskHelp>
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Example />))
  return container.querySelector('button')!
}

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([40, 760])('keeps the explanation inside the viewport for a trigger at y=%i', async top => {
  const button = await render(top)
  await act(async () => button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  const tooltip = document.querySelector<HTMLElement>('[role=tooltip]')!
  expect(tooltip).not.toBeNull()
  expect(container.contains(tooltip)).toBe(false)
  const y = Number.parseFloat(tooltip.style.top)
  const x = Number.parseFloat(tooltip.style.left)
  expect(y).toBeGreaterThanOrEqual(12)
  expect(y + 220).toBeLessThanOrEqual(832)
  expect(x + 300).toBeLessThanOrEqual(378)
  expect(top === 40 ? y > top : y < top).toBe(true)
  expect(button.getAttribute('aria-describedby')).toBe(tooltip.id)
})

it('supports focus, Escape and repeated taps without leaving an orphaned popover', async () => {
  const button = await render(760)
  await act(async () => button.focus())
  expect(document.querySelector('[role=tooltip]')).not.toBeNull()
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[role=tooltip]')).toBeNull()
  expect(document.activeElement).toBe(button)
  await act(async () => button.click())
  expect(document.querySelector('[role=tooltip]')).not.toBeNull()
  await act(async () => button.click())
  expect(document.querySelector('[role=tooltip]')).toBeNull()
})
