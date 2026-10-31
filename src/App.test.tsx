// @vitest-environment jsdom
import { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { loadSettings } from './store'
import type { Position, Settings } from './types'
import type { View } from './useStore'

const state = vi.hoisted(() => ({
  positions: [] as Position[], settings: {} as Settings, liveQuotes: {}, setSettings: vi.fn(), monitorEffect: vi.fn(), monitorCleanup: vi.fn(), overviewRender: vi.fn(),
}))
vi.mock('./useStore', () => ({ useStore: () => state }))
vi.mock('./theme', () => ({ applyTheme: vi.fn() }))
vi.mock('./views/Overview', () => ({ Overview: ({ onGoTo }: { onGoTo: (view: View, anchor?: string) => void }) => {
  state.overviewRender()
  return <><h1>Overview workspace</h1><button onClick={() => onGoTo('settings', 'instrument-review')}>Review listings</button></>
} }))
vi.mock('./views/MonitorView', () => ({
  MonitorView: ({ initialQuery }: { initialQuery: string }) => <section aria-label="Monitor workspace"><output>{initialQuery}</output></section>,
}))
vi.mock('./views/InsightsView', () => ({ InsightsView: () => {
  const [selection, setSelection] = useState('nifty')
  useEffect(() => { state.monitorEffect(); return state.monitorCleanup }, [])
  return <><h1>Insights workspace</h1><input aria-label="Selected benchmark" value={selection} onChange={(event) => setSelection(event.target.value)} /></>
} }))
vi.mock('./views/SettingsView', () => ({ SettingsView: ({ onRequestImport }: { onRequestImport: () => void }) => <><h1>Settings workspace</h1><button onClick={onRequestImport}>Import holdings</button></> }))
vi.mock('./views/PortfolioImportDialog', () => ({
  PortfolioImportDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) => open ? <div role="dialog" aria-label="Portfolio import"><button onClick={onClose}>Close import</button></div> : null,
}))
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
  state.setSettings.mockReset().mockImplementation((settings: Settings) => { state.settings = settings })
  state.monitorEffect.mockReset()
  state.monitorCleanup.mockReset()
  state.overviewRender.mockReset()
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

it('keeps navigation and privacy controls usable while the desktop sidebar is collapsed', async () => {
  await render('overview', '/app')
  const toggle = container.querySelector<HTMLButtonElement>('.sidebar-toggle')!
  const pageRenders = state.overviewRender.mock.calls.length
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-label')).toBe('Expand sidebar')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelector('.app-shell--collapsed')).not.toBeNull()
  expect(state.overviewRender).toHaveBeenCalledTimes(pageRenders)
  expect([...container.querySelectorAll('.nav-item')].map((button) => button.getAttribute('aria-label'))).toEqual(['Overview', 'Insights', 'Monitor', 'Research', 'Settings'])
  await navigate('Insights')
  expect([...container.querySelectorAll('h1')].find((heading) => !heading.closest('[hidden]'))?.textContent).toBe('Insights workspace')
  expect(container.querySelector('.app-shell--collapsed')).not.toBeNull()
  const privacy = container.querySelector<HTMLButtonElement>('.shell-privacy-toggle')!
  await act(async () => privacy.click())
  expect(state.setSettings).toHaveBeenCalledWith(expect.objectContaining({ hideValues: true }))
  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelector('.app-shell--collapsed')).toBeNull()
})

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

describe('workspace navigation', () => {
  it('restores a visited page and its selections while pausing its effects away from the page', async () => {
    await render('overview', '/app')
    expect(state.monitorEffect).not.toHaveBeenCalled()
    await navigate('Insights')
    const selection = container.querySelector<HTMLInputElement>('[aria-label="Selected benchmark"]')!
    await edit(selection, 'sensex')
    await navigate('Monitor')
    expect(state.monitorCleanup).toHaveBeenCalledTimes(1)
    await navigate('Insights')
    expect(container.querySelector<HTMLInputElement>('[aria-label="Selected benchmark"]')?.value).toBe('sensex')
    expect(container.querySelector('[aria-label="Selected benchmark"]')).toBe(selection)
    expect(state.monitorEffect).toHaveBeenCalledTimes(2)
  })

  it('keeps one shared privacy control across every workspace and preserves the route when toggled', async () => {
    await render('overview', '/app')
    const control = container.querySelector<HTMLButtonElement>('.shell-privacy-toggle')!
    expect(control.closest('.sidebar-head')).not.toBeNull()
    expect(control.getAttribute('aria-label')).toBe('Hide portfolio values')
    const originalSettings = { ...state.settings }

    for (const label of ['Overview', 'Insights', 'Monitor', 'Research', 'Settings']) {
      await navigate(label)
      expect(container.querySelectorAll('.shell-privacy-toggle')).toHaveLength(1)
      expect(container.querySelector('.shell-privacy-toggle')).toBe(control)
      const route = window.location.pathname + window.location.search
      const hideValues = !state.settings.hideValues
      await act(async () => control.click())
      await act(async () => root.render(<App initialView="overview" />))
      expect(state.setSettings).toHaveBeenLastCalledWith({ ...originalSettings, hideValues })
      expect(control.getAttribute('aria-pressed')).toBe(String(hideValues))
      expect(control.getAttribute('aria-label')).toBe(hideValues ? 'Reveal portfolio values' : 'Hide portfolio values')
      expect(window.location.pathname + window.location.search).toBe(route)
    }
  })

  it('offers the shared privacy control before a portfolio is imported', async () => {
    state.positions = []
    state.settings.hideValues = true
    await render('research', '/app/research')
    const control = container.querySelector<HTMLButtonElement>('.shell-privacy-toggle')!
    expect(control.getAttribute('aria-pressed')).toBe('true')
    await act(async () => control.click())
    expect(state.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ hideValues: false }))
  })

  it('opens and closes portfolio import from Settings without changing the active route', async () => {
    await render('settings', '/app/settings#instrument-review')
    await click('Import holdings')
    expect(container.querySelector('[role="dialog"][aria-label="Portfolio import"]')).not.toBeNull()
    expect(container.textContent).toContain('Settings workspace')
    expect(window.location.pathname + window.location.hash).toBe('/app/settings#instrument-review')
    expect(container.querySelector('.nav-item[aria-current="page"] .nav-item-label')?.textContent).toBe('Settings')
    await click('Close import')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(window.location.pathname + window.location.hash).toBe('/app/settings#instrument-review')
    expect(container.textContent).toContain('Settings workspace')
  })

  it('opens listing review in Settings and clears its anchor when returning to Overview', async () => {
    await render('overview', '/app')
    await click('Review listings')
    expect(window.location.pathname + window.location.hash).toBe('/app/settings#instrument-review')
    expect(container.textContent).toContain('Settings workspace')
    await navigate('Overview')
    expect(window.location.pathname + window.location.hash).toBe('/app')
    await browserBack()
    expect(window.location.pathname + window.location.hash).toBe('/app/settings#instrument-review')
    expect(container.textContent).toContain('Settings workspace')
  })

  it('returns to the workspace overview when browser navigation reaches the root', async () => {
    await render('settings', '/app/settings')
    await act(async () => {
      window.history.replaceState({}, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(window.location.pathname).toBe('/app')
    expect(container.querySelector('h1')?.textContent).toBe('Overview workspace')
    expect([...container.querySelectorAll('.nav-item')].map((item) => item.textContent?.trim())).toEqual([
      'Overview', 'Insights', 'Monitor', 'Research', 'Settings',
    ])
  })

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

  it('restores the latest Research filters after browser Back to Overview', async () => {
    await render('overview', '/app')
    await navigate('Research')
    await edit(container.querySelector<HTMLInputElement>('input[aria-label="Search research holdings"]')!, 'TCS')
    await click('Sources')
    const researchUrl = window.location.pathname + window.location.search
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('sources')

    await browserBack()
    expect(window.location.pathname).toBe('/app')
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

  it('passes the selected holding to related news and provides a return to its research', async () => {
    await render('research', '/app/research?holding=tcs&tab=sources')
    const researchUrl = window.location.pathname + window.location.search
    await click('Related news')

    expect(window.location.pathname).toBe('/app/monitor')
    expect(container.querySelector('[aria-label="Monitor workspace"] output')?.textContent).toBe(holding.name)
    await click('Back to Research')

    expect(window.location.pathname + window.location.search).toBe(researchUrl)
    expect(container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.textContent).toBe('Sources')
  })
})
