// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { LandingPage } from './LandingPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { document.body.innerHTML = '' })

it('leads every call to action into the app and links each section from the navigation', () => {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  act(() => root.render(<LandingPage />))

  expect(container.querySelector('h1')?.textContent).toBe('Know what you own.See what moves.')
  const ctas = [...container.querySelectorAll<HTMLAnchorElement>('a.lp-btn')]
  expect(ctas.length).toBeGreaterThan(0)
  expect(ctas.every((link) => link.getAttribute('href') === '/app')).toBe(true)
  for (const link of container.querySelectorAll<HTMLAnchorElement>('nav a')) {
    expect(container.querySelector(link.getAttribute('href')!)).not.toBeNull()
  }
  expect([...container.querySelectorAll('img')].every((image) => image.getAttribute('alt') !== null)).toBe(true)
  act(() => root.unmount())
})
