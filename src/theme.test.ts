// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme, BLUE_ACCENT } from './theme'

afterEach(() => {
  document.documentElement.removeAttribute('style')
  delete document.documentElement.dataset.mode
  delete document.documentElement.dataset.density
  document.head.innerHTML = ''
})

describe('fixed blue theme', () => {
  it.each(['dark', 'light'] as const)('applies blue while preserving %s mode and density', (mode) => {
    document.head.innerHTML = '<meta name="theme-color" content="old">'
    document.documentElement.style.setProperty('--primary', '#10b981')
    applyTheme({ density: 'compact', mode })
    const root = document.documentElement
    expect(root.style.getPropertyValue('--primary')).toBe('#3b82f6')
    expect(root.style.getPropertyValue('--primary-hover')).toBe(BLUE_ACCENT.primaryHover)
    expect(root.style.getPropertyValue('--primary-focus')).toBe(BLUE_ACCENT.primaryFocus)
    expect(root.style.getPropertyValue('--spark')).toBe(BLUE_ACCENT.spark)
    expect(root.dataset.mode).toBe(mode)
    expect(root.dataset.density).toBe('compact')
    expect(document.querySelector('meta')?.content).toBe(mode === 'light' ? '#f2f2ef' : '#0d0d0c')
  })
})
