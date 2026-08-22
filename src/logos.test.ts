import { describe, expect, it } from 'vitest'
import { extractIsinFromRow, isinLogoUrl, monogramTile, resolveIsin, tickerHue, tickerLogoUrl } from './logos'

describe('isin logo urls', () => {
  it('builds a jsDelivr url from a valid ISIN', () => {
    expect(isinLogoUrl('INE002A01018')).toBe('https://cdn.jsdelivr.net/npm/@extra-isin/logos/data/INE002A01018.png')
  })

  it('normalizes case and whitespace', () => {
    expect(isinLogoUrl(' ine009a01021 ')).toBe('https://cdn.jsdelivr.net/npm/@extra-isin/logos/data/INE009A01021.png')
  })

  it('rejects missing or malformed identifiers', () => {
    expect(isinLogoUrl(undefined)).toBeNull()
    expect(isinLogoUrl(null)).toBeNull()
    expect(isinLogoUrl('')).toBeNull()
    expect(isinLogoUrl('RELIANCE')).toBeNull()
    expect(isinLogoUrl('INE002A0101')).toBeNull()
  })
})

describe('ticker logo urls', () => {
  it('builds an NSE logo url from a bare ticker', () => {
    expect(tickerLogoUrl('INFY')).toBe('https://eodhd.com/img/logos/NSE/INFY.png')
  })

  it('strips exchange suffixes and routes BSE listings to the BSE set', () => {
    expect(tickerLogoUrl('infy.ns')).toBe('https://eodhd.com/img/logos/NSE/INFY.png')
    expect(tickerLogoUrl('TATASTEEL', 'BSE')).toBe('https://eodhd.com/img/logos/BSE/TATASTEEL.png')
  })

  it('rejects malformed tickers', () => {
    expect(tickerLogoUrl('')).toBeNull()
    expect(tickerLogoUrl('A')).toBeNull()
    expect(tickerLogoUrl('WITH SPACE')).toBeNull()
  })
})

describe('isin resolution from the NSE equity master', () => {
  const header = 'SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE'
  const csv = [
    header,
    'WAAREEENER,Waaree Energies Limited,EQ,28-OCT-2024,10,1,INE377N01017,10',
    'KRN,KRN Heat Exchanger and Refrigeration Limited,EQ,03-OCT-2024,10,1,INE0Q3J01015,10',
    'TCS,Tata Consultancy Services Limited,EQ,25-AUG-2004,1,1,INE467B01029,1',
  ].join('\n')

  it('extracts a valid ISIN using header column order', () => {
    const rows = csv.split(/\r?\n/)
    expect(extractIsinFromRow(rows[0].split(','), rows[1].split(','), 'WAAREEENER')).toBe('INE377N01017')
    expect(extractIsinFromRow(rows[0].split(','), rows[2].split(','), 'krn')).toBe('INE0Q3J01015')
  })

  it('rejects other symbols and malformed ISINs', () => {
    const rows = csv.split(/\r?\n/)
    expect(extractIsinFromRow(rows[0].split(','), rows[2].split(','), 'WAAREEENER')).toBeNull()
    expect(extractIsinFromRow(rows[0].split(','), ['KRN', 'KRN Heat', 'EQ'], 'KRN')).toBeNull()
  })

  it('resolves through the fetcher exactly once per master load', async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return csv
    }
    expect(await resolveIsin('WAAREEENER', fetcher)).toBe('INE377N01017')
    expect(calls).toBe(1)
  })
})

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
