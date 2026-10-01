import { describe, expect, it } from 'vitest'
import { monogramTile, tickerHue } from './logos'

describe('monogram tiles', () => {
  it('produces stable data-uris per ticker', () => {
    expect(monogramTile('INFY')).toBe(monogramTile('INFY'))
    expect(monogramTile('INFY')).not.toBe(monogramTile('KRN'))
  })

  it('accepts a label override (e.g. ETF badges)', () => {
    expect(monogramTile('GOLDBEES', 'ETF')).toContain('ETF')
    expect(monogramTile('GOLDBEES', 'ETF')).not.toBe(monogramTile('GOLDBEES'))
  })

  it('hashes hues deterministically inside one turn of the wheel', () => {
    for (const ticker of ['INFY', 'GOLDBEES', 'WAAREEENER']) {
      const hue = tickerHue(ticker)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      expect(hue).toBe(tickerHue(ticker))
    }
  })
})
