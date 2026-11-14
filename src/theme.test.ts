// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, BLUE_ACCENT, LIGHT_BLUE_ACCENT } from './theme'

afterEach(() => {
  document.documentElement.removeAttribute('style')
  delete document.documentElement.dataset.mode
  delete document.documentElement.dataset.density
  delete document.documentElement.dataset.themeTransition
  Reflect.deleteProperty(document, 'startViewTransition')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.head.innerHTML = ''
})

describe('fixed blue theme', () => {
  function nativeTransitions(reducedMotion = false) {
    const pending: { update: () => void; finish: () => void; finished: Promise<void>; skipTransition: ReturnType<typeof vi.fn> }[] = []
    const start = vi.fn((update: () => void) => {
      let finish!: () => void
      const finished = new Promise<void>((resolve) => { finish = resolve })
      const transition = { update, finish, finished, skipTransition: vi.fn() }
      pending.push(transition)
      return transition
    })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reducedMotion })))
    return { start, pending }
  }

  it('crossfades subsequent mode changes and cleans up afterward', async () => {
    const { start, pending } = nativeTransitions()
    applyTheme({ density: 'compact', mode: 'dark' })
    expect(start).not.toHaveBeenCalled()
    applyTheme({ density: 'compact', mode: 'light' })
    expect(start).toHaveBeenCalledOnce()
    expect(document.documentElement.dataset.mode).toBe('dark')
    pending[0].update()
    expect(document.documentElement.dataset.mode).toBe('light')
    expect(document.documentElement.hasAttribute('data-theme-transition')).toBe(true)
    pending[0].finish()
    await pending[0].finished
    expect(document.documentElement.hasAttribute('data-theme-transition')).toBe(false)
  })

  it('keeps rapid switches on the most recently requested mode', async () => {
    const { pending } = nativeTransitions()
    applyTheme({ density: 'compact', mode: 'dark' })
    applyTheme({ density: 'compact', mode: 'light' })
    applyTheme({ density: 'compact', mode: 'dark' })
    expect(pending[0].skipTransition).toHaveBeenCalledOnce()
    pending[0].update()
    pending[0].finish()
    await pending[0].finished
    expect(document.documentElement.dataset.mode).toBe('dark')
    expect(document.documentElement.hasAttribute('data-theme-transition')).toBe(false)
  })

  it('switches immediately with reduced motion and for density-only changes', () => {
    const { start } = nativeTransitions(true)
    applyTheme({ density: 'compact', mode: 'dark' })
    applyTheme({ density: 'compact', mode: 'light' })
    applyTheme({ density: 'comfortable', mode: 'light' })
    expect(start).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.mode).toBe('light')
    expect(document.documentElement.dataset.density).toBe('comfortable')
  })

  it('still changes mode if the native animation cannot start', () => {
    const { start } = nativeTransitions()
    applyTheme({ density: 'compact', mode: 'dark' })
    start.mockImplementationOnce(() => { throw new Error('Transition unavailable') })
    applyTheme({ density: 'compact', mode: 'light' })
    expect(document.documentElement.dataset.mode).toBe('light')
    expect(document.documentElement.hasAttribute('data-theme-transition')).toBe(false)
  })

  it.each(['dark', 'light'] as const)('applies blue while preserving %s mode and density', (mode) => {
    document.head.innerHTML = '<meta name="theme-color" content="old">'
    document.documentElement.style.setProperty('--primary', '#10b981')
    applyTheme({ density: 'compact', mode })
    const root = document.documentElement
    expect(root.style.getPropertyValue('--primary')).toBe(mode === 'light' ? '#2563eb' : '#3b82f6')
    expect(root.style.getPropertyValue('--primary-hover')).toBe(mode === 'light' ? LIGHT_BLUE_ACCENT.primaryHover : BLUE_ACCENT.primaryHover)
    expect(root.style.getPropertyValue('--primary-focus')).toBe(mode === 'light' ? LIGHT_BLUE_ACCENT.primaryFocus : BLUE_ACCENT.primaryFocus)
    expect(root.style.getPropertyValue('--spark')).toBe(BLUE_ACCENT.spark)
    expect(root.dataset.mode).toBe(mode)
    expect(root.dataset.density).toBe('compact')
    expect(document.querySelector('meta')?.content).toBe(mode === 'light' ? '#f2f2ef' : '#0d0d0c')
  })
})
