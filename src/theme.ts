import type { Density, Mode } from './types'

export const BLUE_ACCENT = {
  primary: '#3b82f6',
  primaryHover: '#60a5fa',
  primaryFocus: '#2f6cd8',
  spark: 'rgba(59, 130, 246, 0.14)',
}

export const LIGHT_BLUE_ACCENT = {
  ...BLUE_ACCENT,
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primaryFocus: '#1d4ed8',
}

let themeTransition: ViewTransition | undefined
let themeRequest = 0

export function applyTheme({ density, mode }: { density: Density; mode: Mode }): void {
  const root = document.documentElement
  const request = ++themeRequest
  themeTransition?.skipTransition()
  themeTransition = undefined
  delete root.dataset.themeTransition
  root.dataset.density = density
  const update = () => {
    if (request !== themeRequest) return
    const accent = mode === 'light' ? LIGHT_BLUE_ACCENT : BLUE_ACCENT
    root.style.setProperty('--primary', accent.primary)
    root.style.setProperty('--primary-hover', accent.primaryHover)
    root.style.setProperty('--primary-focus', accent.primaryFocus)
    root.style.setProperty('--spark', accent.spark)
    root.dataset.mode = mode
    const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (themeColorMeta) themeColorMeta.content = mode === 'light' ? '#f2f2ef' : '#0d0d0c'
  }
  const shouldAnimate = root.dataset.mode && root.dataset.mode !== mode
    && typeof document.startViewTransition === 'function'
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    && document.visibilityState !== 'hidden'
  if (!shouldAnimate) { update(); return }

  root.dataset.themeTransition = ''
  try {
    const transition = document.startViewTransition(update)
    themeTransition = transition
    const finish = () => {
      if (request !== themeRequest) return
      update()
      delete root.dataset.themeTransition
      themeTransition = undefined
    }
    void transition.finished.then(finish, finish)
  } catch {
    delete root.dataset.themeTransition
    update()
  }
}
