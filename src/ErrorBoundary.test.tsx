// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('recovers from a render failure without changing saved portfolio data', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const container = document.createElement('div')
  const root = createRoot(container)
  let shouldThrow = true
  function Workspace() {
    if (shouldThrow) throw new Error('Private provider error')
    return <h1>Portfolio restored</h1>
  }
  localStorage.setItem('finverse:folios', 'saved portfolio')
  try {
    await act(async () => root.render(<ErrorBoundary><Workspace /></ErrorBoundary>))
    expect(container.querySelector('[role="alert"] h1')?.textContent).toBe('The workspace took a dip')
    expect(container.textContent).not.toContain('Private provider error')
    expect(container.querySelector('.error-screen-art')?.getAttribute('aria-hidden')).toBe('true')
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(localStorage.getItem('finverse:folios')).toBe('saved portfolio')
    shouldThrow = false
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(container.textContent).toContain('Portfolio restored')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(localStorage.getItem('finverse:folios')).toBe('saved portfolio')
  } finally {
    await act(async () => root.unmount())
    localStorage.removeItem('finverse:folios')
    log.mockRestore()
  }
})
