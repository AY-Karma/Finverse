// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { LandingDemo } from './LandingDemo'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLDivElement

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

it('lets visitors explore sample holdings and privacy controls without fetching data', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<LandingDemo />) })

  await act(async () => { container.querySelector<HTMLButtonElement>('.demo-segmented button:nth-child(2)')?.click() })
  expect(container.querySelectorAll('.demo-ledger > button')).toHaveLength(3)
  expect(container.querySelector('.demo-stats strong')?.textContent).toBe('₹2,44,562')

  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Refresh sample prices"]')?.click() })
  expect(container.querySelector('.demo-stats strong')?.textContent).toBe('₹2,45,039')

  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Hide sample values"]')?.click() })
  expect(container.querySelector('.demo-stats strong')?.textContent).toBe('•••••')

  await act(async () => { container.querySelectorAll<HTMLButtonElement>('.demo-sidebar nav button')[2].click() })
  expect(container.textContent).toContain('Portfolio vs NIFTY 50')

  await act(async () => { container.querySelectorAll<HTMLButtonElement>('.demo-sidebar nav button')[1].click() })
  await act(async () => { container.querySelectorAll<HTMLButtonElement>('.demo-filter-row button')[2].click() })
  expect(container.querySelectorAll('.demo-story')).toHaveLength(1)
  await act(async () => { container.querySelector<HTMLButtonElement>('.demo-story')?.click() })
  expect(container.querySelector('.demo-story')?.getAttribute('aria-expanded')).toBe('true')

  await act(async () => { container.querySelectorAll<HTMLButtonElement>('.demo-sidebar nav button')[3].click() })
  expect(container.querySelectorAll('.demo-research-card')).toHaveLength(3)
  expect(container.querySelector<HTMLAnchorElement>('.demo-research-links a')?.getAttribute('href')).toBe('/app')

  await act(async () => { container.querySelectorAll<HTMLButtonElement>('.demo-sidebar nav button')[4].click() })
  expect(container.querySelector<HTMLButtonElement>('.demo-setting')?.getAttribute('aria-pressed')).toBe('true')
  await act(async () => { container.querySelectorAll<HTMLButtonElement>('.demo-settings-nav button')[1].click() })
  expect(container.textContent).toContain('External market data')
  expect(container.textContent).toContain('No provider is called by this preview')
  expect(fetch).not.toHaveBeenCalled()
})
