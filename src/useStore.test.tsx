// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreProvider } from './useStore'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => vi.unstubAllGlobals())

describe('portfolio saving', () => {
  it('keeps the workspace available and offers a retry after storage fails', async () => {
    let storageAvailable = false
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        if (!storageAvailable) throw new DOMException('Full', 'QuotaExceededError')
      },
    })
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<StoreProvider><div>Workspace</div></StoreProvider>))
      expect(container.textContent).toContain('Workspace')
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be saved')

      storageAvailable = true
      const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry saving')
      await act(async () => retry?.click())
      expect(container.querySelector('[role="alert"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })
})
