// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { loadSettings } from './store'
import type { Position, Settings } from './types'
import type { View } from './useStore'

const state = vi.hoisted(() => ({
  positions: [] as Position[], settings: {} as Settings, liveQuotes: {}, fxRate: null,
  quickMode: false, setQuickMode: vi.fn(), chat: vi.fn(),
}))
vi.mock('./useStore', () => ({ useStore: () => state }))
vi.mock('./theme', () => ({ applyTheme: vi.fn() }))
vi.mock('./providers', async (original) => ({ ...await original<typeof import('./providers')>(), chat: state.chat }))
vi.mock('./views/ResearchHistory', () => ({ ResearchHistory: () => null }))
vi.mock('./views/Overview', () => ({ Overview: () => <h1>Overview workspace</h1> }))
vi.mock('./views/HoldingsView', () => ({
  HoldingsView: ({ initialQuery }: { initialQuery: string }) => <section aria-label="Monitor workspace"><output>{initialQuery}</output></section>,
}))
vi.mock('./views/InsightsView', () => ({ InsightsView: () => <h1>Insights workspace</h1> }))
vi.mock('./views/SettingsView', () => ({ SettingsView: () => <h1>Settings workspace</h1> }))
vi.mock('./views/PortfolioImportDialog', () => ({ PortfolioImportDialog: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const holding: Position = {
  id: 'tcs', ticker: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE', type: 'stock',
  quantity: 10, buyPrice: 100, invested: 1000, lastPrice: 120,
}
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  localStorage.clear()
  state.positions = [holding]
  state.settings = { ...loadSettings(), allowExternalData: false }
  state.chat.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  localStorage.clear()
})

async function render(view: View, path: string) {
  window.history.replaceState({}, '', path)
  await act(async () => root.render(<App initialView={view} />))
  await act(async () => vi.dynamicImportSettled())
}

async function click(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => !item.closest('[hidden]') && item.textContent?.trim().startsWith(text))
  expect(button, `Visible button: ${text}`).toBeDefined()
  await act(async () => button!.click())
  await act(async () => vi.dynamicImportSettled())
}

async function navigate(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('.nav-item')]
    .find((item) => item.querySelector('.nav-item-label')?.textContent === label)
  expect(button, `Sidebar item: ${label}`).toBeDefined()
  await act(async () => button!.click())
  await act(async () => vi.dynamicImportSettled())
}

async function edit(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  expect(input).not.toBeNull()
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function browserBack() {
  await act(async () => {
    const popped = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }))
    window.history.back()
    await popped
  })
}

describe('Research workspace navigation', () => {
  it('preserves the selected Sources section when leaving through the sidebar', async () => {
    await render('research', '/app/research?holding=tcs&tab=sources')
    const researchUrl = window.location.pathname + window.location.search
    await navigate('Monitor')
    expect(window.location.pathname).toBe('/app/monitor')
    await navigate('Research')
    expect(window.location.pathname + window.location.search).toBe(researchUrl)
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Sources')
    expect(container.querySelector('textarea')).toBeNull()
  })

  it.each([
    { view: 'overview' as const, path: '/app' },
    { view: 'holdings' as const, path: '/app/monitor' },
  ])('restores the latest Research filters after browser Back to $view', async ({ view, path }) => {
    await render(view, path)
    await navigate('Research')
    await edit(container.querySelector<HTMLInputElement>('input[aria-label="Search research holdings"]')!, 'TCS')
    await click('Sources')
    const researchUrl = window.location.pathname + window.location.search
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('sources')

    await browserBack()
    expect(window.location.pathname).toBe(path)
    await navigate('Research')

    expect(window.location.pathname + window.location.search).toBe(researchUrl)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Search research holdings"]')?.value).toBe('TCS')
    expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Sources')
  })

  it('remembers a Research URL restored by popstate before leaving with browser Back', async () => {
    await render('overview', '/app')
    await navigate('Research')
    await act(async () => {
      window.history.replaceState({}, '', '/app/research?holding=tcs&tab=sources')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    await browserBack()
    expect(window.location.pathname).toBe('/app')
    await navigate('Research')

    expect(window.location.pathname + window.location.search).toBe('/app/research?holding=tcs&tab=sources')
    expect(container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.textContent).toBe('Sources')
  })

  it('opens an editable selected-holding AI draft without sending it', async () => {
    await render('research', '/app/research?holding=tcs&tab=sources')
    const researchUrl = window.location.pathname + window.location.search
    await click('Ask about this holding')

    expect(window.location.pathname).toBe('/app/research/assistant')
    const draft = container.querySelector<HTMLInputElement>('input[aria-label="Message to AI provider"]')!
    expect(draft.value).toContain('Tata Consultancy Services (TCS, NSE)')
    expect(draft.value).not.toContain('Private research note')
    expect(state.chat).not.toHaveBeenCalled()
    await edit(draft, 'An edited question about TCS')
    expect(draft.value).toBe('An edited question about TCS')
    expect(state.chat).not.toHaveBeenCalled()

    await click('← Back to Research')
    expect(window.location.pathname + window.location.search).toBe(researchUrl)
    expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Sources')
  })

  it('passes the selected holding to related news and provides a return to its research', async () => {
    await render('research', '/app/research?holding=tcs&tab=sources')
    const researchUrl = window.location.pathname + window.location.search
    await click('Related news')

    expect(window.location.pathname).toBe('/app/monitor')
    expect(container.querySelector('[aria-label="Monitor workspace"] output')?.textContent).toBe(holding.name)
    await click('← Back to Research')

    expect(window.location.pathname + window.location.search).toBe(researchUrl)
    expect(container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.textContent).toBe('Sources')
  })
})
