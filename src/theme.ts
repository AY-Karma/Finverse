import type { Density, Mode } from './types'

export const BLUE_ACCENT = {
  primary: '#3b82f6',
  primaryHover: '#60a5fa',
  primaryFocus: '#2f6cd8',
  spark: 'rgba(59, 130, 246, 0.14)',
}

let themeTransition: ViewTransition | undefined
let themeRequest = 0

export function applyTheme({ density, mode }: { density: Density; mode: Mode }): void {
  const root = document.documentElement
  const request = ++themeRequest
  themeTransition?.skipTransition()
  themeTransition = undefined
  delete root.dataset.themeTransition
  root.style.setProperty('--primary', BLUE_ACCENT.primary)
  root.style.setProperty('--primary-hover', BLUE_ACCENT.primaryHover)
  root.style.setProperty('--primary-focus', BLUE_ACCENT.primaryFocus)
  root.style.setProperty('--spark', BLUE_ACCENT.spark)
  root.dataset.density = density
  const update = () => {
    if (request !== themeRequest) return
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
