import { describe, expect, it } from 'vitest'
import type { Position } from './types'
import { marketLinks, researchSource } from './research'

const holding: Position = { id: '1', ticker: 'INFY.NS', name: 'Infosys', type: 'stock', quantity: 1, buyPrice: 1, lastPrice: 1, invested: 1 }

describe('portfolio research links', () => {
  it('creates labeled external links without portfolio amounts', () => {
    const links = marketLinks(holding)
    expect(links.map((link) => researchSource(link.url))).toEqual(['NSE India', 'TradingView', 'Screener'])
    expect(links.every((link) => !link.url.includes('quantity') && !link.url.includes('invested'))).toBe(true)
  })

  it('falls back safely for malformed source URLs', () => {
    expect(researchSource('not a URL')).toBe('External source')
  })
})
