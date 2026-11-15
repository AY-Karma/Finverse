import { describe, expect, it } from 'vitest'
import type { Position } from './types'
import { marketLinks, researchSource, supportsCompanyResearch } from './research'

const holding: Position = { id: '1', ticker: 'INFY.NS', name: 'Infosys', type: 'stock', quantity: 1, buyPrice: 1, lastPrice: 1, invested: 1 }

describe('portfolio research links', () => {
  it('creates labeled external links without portfolio amounts', () => {
    const links = marketLinks(holding)
    expect(links.map((link) => researchSource(link.url))).toEqual(['Google Search', 'NSE India', 'TradingView'])
    expect(links.every((link) => !link.url.includes('quantity') && !link.url.includes('invested'))).toBe(true)
  })

  it('never links to screener’s removed search page, which now 404s', () => {
    const fund: Position = { ...holding, id: '2', ticker: 'FUND', name: 'Example Fund', type: 'mutual-fund' }
    for (const position of [holding, fund]) {
      for (const link of marketLinks(position)) {
        expect(link.url).not.toMatch(/screener\.in\/search/)
      }
    }
  })

  it('falls back safely for malformed source URLs', () => {
    expect(researchSource('not a URL')).toBe('External source')
  })

  it('routes BSE and global holdings to the right venue and gives funds their own evidence', () => {
    const bse = marketLinks({ ...holding, ticker: '500209', exchange: 'BSE' })
    expect(bse.some((link) => link.url.includes('nseindia'))).toBe(false)
    expect(bse.find((link) => link.label === 'Price chart')?.url).toContain('BSE%3A500209')
    const global = marketLinks({ ...holding, ticker: 'AAPL', exchange: 'NASDAQ' })
    expect(global.some((link) => link.url.includes('NSE') || link.url.includes('screener'))).toBe(false)
    expect(global.find((link) => link.label === 'Price chart')?.url).toContain('NASDAQ%3AAAPL')
    const fund = { ...holding, type: 'mutual-fund' as const }
    expect(marketLinks(fund).map((link) => link.label)).toEqual(['Scheme factsheet', 'Costs and risk', 'Scheme documents'])
    expect(supportsCompanyResearch({ ...holding, type: 'etf' })).toBe(false)
    expect(supportsCompanyResearch(fund)).toBe(false)
    const unknownListing = { ...holding, exchange: 'OTHER' as const }
    expect(supportsCompanyResearch(unknownListing)).toBe(false)
    expect(marketLinks(unknownListing).some((link) => link.url.includes('nseindia') || link.url.includes('screener') || link.label === 'Price chart')).toBe(false)
  })

  it('links company financials as a labelled search without a third-party lookup', () => {
    const financials = marketLinks(holding)[0]
    expect(financials.label).toBe('Company financials')
    expect(financials.kind).toBe('search')
    expect(financials.url).toContain(encodeURIComponent('site:screener.in Infosys NSE'))
  })
})
