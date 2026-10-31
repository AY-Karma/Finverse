// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { FundSchemePicker } from './FundSchemePicker'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const candidates = [
  { schemeCode: 101065, schemeName: 'Quant Mid Cap Fund - Regular Plan - Growth Option' },
  { schemeCode: 120840, schemeName: 'Quant Mid Cap Fund - Direct Plan - IDCW Option' },
  { schemeCode: 120841, schemeName: 'Quant Mid Cap Fund - Direct Plan - Growth Option' },
  { schemeCode: 118778, schemeName: 'Nippon India Small Cap Fund - Direct Plan - Growth Option' },
]

async function mount(disabled = false) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const changed = vi.fn()
  function Harness() {
    const [value, setValue] = useState('')
    return <FundSchemePicker importedName="Quant Mid Cap Fund Direct Growth" candidates={candidates} value={value} disabled={disabled} onChange={(code) => { changed(code); setValue(code) }} />
  }
  await act(async () => root.render(<Harness />))
  return {
    container, changed,
    trigger: container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!,
    close: async () => { await act(async () => root.unmount()); container.remove() },
  }
}

async function search(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}

it('keeps incompatible plans unavailable and displays a selected scheme', async () => {
  const view = await mount()
  try {
    await act(async () => view.trigger.click())
    const options = [...view.container.querySelectorAll<HTMLElement>('[role="option"]')]
    const regular = options.find((option) => option.textContent?.includes('101065'))!
    expect(regular.getAttribute('aria-disabled')).toBe('true')
    await act(async () => regular.click())
    expect(view.changed).not.toHaveBeenCalled()
    const growth = options.find((option) => option.textContent?.includes('120841'))!
    await act(async () => growth.click())
    expect(view.changed).toHaveBeenCalledExactlyOnceWith('120841')
    expect(view.trigger.textContent).toContain(candidates[2].schemeName)
    expect(view.trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(view.trigger)
  } finally { await view.close() }
})

it('filters by fund name or scheme code and handles an empty search', async () => {
  const view = await mount()
  try {
    await act(async () => view.trigger.click())
    await search(view.container, 'nippon')
    expect(view.container.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(view.container.querySelector('[role="option"]')!.textContent).toContain('118778')
    await search(view.container, '120841')
    expect(view.container.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(view.container.querySelector('[role="option"]')!.textContent).toContain('120841')
    await search(view.container, 'no such scheme')
    expect(view.container.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect(view.container.textContent).toMatch(/no schemes|no results|no matches/i)
    expect(view.changed).not.toHaveBeenCalled()
  } finally { await view.close() }
})

it('supports keyboard selection and Escape without changing the saved selection', async () => {
  const view = await mount()
  try {
    await act(async () => view.trigger.click())
    const input = await search(view.container, '120841')
    expect(document.activeElement).toBe(input)
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(view.changed).toHaveBeenCalledExactlyOnceWith('120841')
    await act(async () => view.trigger.click())
    const reopenedInput = view.container.querySelector<HTMLInputElement>('[role="combobox"]')!
    await act(async () => reopenedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(view.trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(view.trigger)
    expect(view.changed).toHaveBeenCalledTimes(1)
  } finally { await view.close() }
})

it('cannot open while disabled', async () => {
  const view = await mount(true)
  try {
    expect(view.trigger.disabled).toBe(true)
    await act(async () => view.trigger.click())
    expect(view.container.querySelector('[role="listbox"]')).toBeNull()
    expect(view.changed).not.toHaveBeenCalled()
  } finally { await view.close() }
})
