import type { Accent } from './types'

export interface AccentPalette {
  primary: string
  primaryHover: string
  primaryFocus: string
  spark: string
}

export const ACCENTS: Record<Accent, AccentPalette> = {
  indigo: {
    primary: '#5e6ad2',
    primaryHover: '#828fff',
    primaryFocus: '#5e69d1',
    spark: 'rgba(94, 106, 210, 0.14)',
  },
  emerald: {
    primary: '#10b981',
    primaryHover: '#34d399',
    primaryFocus: '#0ea371',
    spark: 'rgba(16, 185, 129, 0.14)',
  },
  cobalt: {
    primary: '#3b82f6',
    primaryHover: '#60a5fa',
    primaryFocus: '#2f6cd8',
    spark: 'rgba(59, 130, 246, 0.14)',
  },
  amber: {
    primary: '#f59e0b',
    primaryHover: '#fbbf24',
    primaryFocus: '#d97706',
    spark: 'rgba(245, 158, 11, 0.14)',
  },
}

export const ACCENT_KEYS = Object.keys(ACCENTS) as Accent[]

export function applyTheme(accent: Accent, density: 'comfortable' | 'compact'): void {
  const root = document.documentElement
  const p = ACCENTS[accent] ?? ACCENTS.indigo
  root.style.setProperty('--primary', p.primary)
  root.style.setProperty('--primary-hover', p.primaryHover)
  root.style.setProperty('--primary-focus', p.primaryFocus)
  root.style.setProperty('--spark', p.spark)
  root.dataset.density = density
}
