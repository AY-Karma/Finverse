import type { Accent, Density, Mode } from './types'

interface AccentPalette {
  primary: string
  primaryHover: string
  primaryFocus: string
  spark: string
}

export const ACCENTS: Record<Exclude<Accent, 'custom'>, AccentPalette> = {
  indigo: {
    primary: '#5e6ad2',
    primaryHover: '#828fff',
    primaryFocus: '#5e69d1',
    spark: 'rgba(94, 106, 210, 0.16)',
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

export const ACCENT_KEYS = Object.keys(ACCENTS) as Exclude<Accent, 'custom'>[]

/** Accepts #RGB or #RRGGBB (any case); returns canonical lowercase #RRGGBB or null. */
export function normalizeHex(value: string | undefined | null): string | null {
  if (!value) return null
  const raw = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.slice(1).split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return null
}

export interface Hsv {
  /** 0–359 */
  h: number
  /** 0–1 */
  s: number
  /** 0–1 */
  v: number
}

export function hexToHsv(hex: string): Hsv {
  const normalized = normalizeHex(hex) ?? '#7c6cff'
  const r = parseInt(normalized.slice(1, 3), 16) / 255
  const g = parseInt(normalized.slice(3, 5), 16) / 255
  const b = parseInt(normalized.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hh = ((h % 360) + 360) % 360
  const c = v * s
  const sector = (hh / 60) % 6
  const x = c * (1 - Math.abs((sector % 2) - 1))
  const m = v - c
  let rgb: [number, number, number]
  if (sector < 1) rgb = [c, x, 0]
  else if (sector < 2) rgb = [x, c, 0]
  else if (sector < 3) rgb = [0, c, x]
  else if (sector < 4) rgb = [0, x, c]
  else if (sector < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return `#${rgb.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`
}

function channelMix(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * amount)
}

/**
 * Derives a complete accent palette from any single hex: hover lifts toward
 * white, focus sinks toward black, and the focus ring reuses the hue at low
 * alpha — so one pick themes the entire app coherently.
 */
export function deriveAccentPalette(primaryHex: string): AccentPalette | null {
  const primary = normalizeHex(primaryHex)
  if (!primary) return null
  const r = parseInt(primary.slice(1, 3), 16)
  const g = parseInt(primary.slice(3, 5), 16)
  const b = parseInt(primary.slice(5, 7), 16)
  const lift = (c: number) => channelMix(c, 255, 0.22)
  const sink = (c: number) => channelMix(c, 0, 0.18)
  const toHex = (c: number) => c.toString(16).padStart(2, '0')
  return {
    primary,
    primaryHover: `#${toHex(lift(r))}${toHex(lift(g))}${toHex(lift(b))}`,
    primaryFocus: `#${toHex(sink(r))}${toHex(sink(g))}${toHex(sink(b))}`,
    spark: `rgba(${r}, ${g}, ${b}, 0.16)`,
  }
}

interface ThemeSpec {
  accent: Accent
  density: Density
  mode: Mode
  customAccent?: string
}

export function resolveThemePalette(spec: Pick<ThemeSpec, 'accent' | 'customAccent'>): AccentPalette {
  if (spec.accent === 'custom') {
    const derived = spec.customAccent ? deriveAccentPalette(spec.customAccent) : null
    if (derived) return derived
  }
  return ACCENTS[spec.accent as Exclude<Accent, 'custom'>] ?? ACCENTS.indigo
}

export function applyTheme({ accent, density, mode, customAccent }: ThemeSpec): void {
  const root = document.documentElement
  const palette = resolveThemePalette({ accent, customAccent })
  root.style.setProperty('--primary', palette.primary)
  root.style.setProperty('--primary-hover', palette.primaryHover)
  root.style.setProperty('--primary-focus', palette.primaryFocus)
  root.style.setProperty('--spark', palette.spark)
  root.dataset.density = density
  root.dataset.mode = mode
  // Browser chrome (tab strip, form controls) follows the mode too.
  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeColorMeta) themeColorMeta.content = mode === 'light' ? '#f2f2ef' : '#0d0d0c'
}
