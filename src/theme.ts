import type { Density, Mode } from './types'

export const BLUE_ACCENT = {
  primary: '#3b82f6',
  primaryHover: '#60a5fa',
  primaryFocus: '#2f6cd8',
  spark: 'rgba(59, 130, 246, 0.14)',
}

export function applyTheme({ density, mode }: { density: Density; mode: Mode }): void {
  const root = document.documentElement
  root.style.setProperty('--primary', BLUE_ACCENT.primary)
  root.style.setProperty('--primary-hover', BLUE_ACCENT.primaryHover)
  root.style.setProperty('--primary-focus', BLUE_ACCENT.primaryFocus)
  root.style.setProperty('--spark', BLUE_ACCENT.spark)
  root.dataset.density = density
  root.dataset.mode = mode
  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeColorMeta) themeColorMeta.content = mode === 'light' ? '#f2f2ef' : '#0d0d0c'
}
