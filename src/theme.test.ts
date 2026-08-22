import { describe, expect, it } from 'vitest'
import { deriveAccentPalette, normalizeHex, resolveThemePalette } from './theme'

describe('normalizeHex', () => {
  it('canonicalizes case and expands shorthand', () => {
    expect(normalizeHex('#7C6CFF')).toBe('#7c6cff')
    expect(normalizeHex(' #F0B ')).toBe('#ff00bb')
  })

  it('rejects garbage and out-of-format strings', () => {
    expect(normalizeHex(undefined)).toBeNull()
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex('7c6cff')).toBeNull()
    expect(normalizeHex('#7c6cf')).toBeNull()
    expect(normalizeHex('#zzzzzz')).toBeNull()
  })
})

describe('deriveAccentPalette', () => {
  it('derives hover lighter, focus darker, and an alpha spark from any hex', () => {
    const palette = deriveAccentPalette('#000000')
    expect(palette).not.toBeNull()
    expect(palette?.primary).toBe('#000000')
    // Lifted toward white: every channel strictly above zero.
    expect(palette?.primaryHover).not.toBe('#000000')
    // Spark keeps the raw channels at low alpha.
    expect(palette?.spark).toBe('rgba(0, 0, 0, 0.16)')
  })

  it('returns null for invalid input instead of guessing', () => {
    expect(deriveAccentPalette('nope')).toBeNull()
    expect(deriveAccentPalette('')).toBeNull()
  })
})

describe('resolveThemePalette', () => {
  it('falls back to indigo for custom without a usable hex', () => {
    const palette = resolveThemePalette({ accent: 'custom' })
    expect(palette.primary).toBe('#5e6ad2')
  })

  it('uses the custom hex when provided', () => {
    const palette = resolveThemePalette({ accent: 'custom', customAccent: '#e8491d' })
    expect(palette.primary).toBe('#e8491d')
    expect(palette.spark).toContain('rgba(232, 73, 29')
  })

  it('maps known presets straight through', () => {
    expect(resolveThemePalette({ accent: 'emerald' }).primary).toBe('#10b981')
  })
})
