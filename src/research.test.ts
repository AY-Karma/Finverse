// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Position } from './types'
import { marketLinks, researchSource, resolveScreenerCompanyPath, supportsCompanyResearch } from './research'

const holding: Position = { id: '1', ticker: 'INFY.NS', name: 'Infosys', type: 'stock', quantity: 1, buyPrice: 1, lastPrice: 1, invested: 1 }
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

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
    const global = marketLinks({ ...holding, ticker: 'AAPL', exchange: 'NASDAQ', currency: 'USD' })
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

  it('leaves failed, ambiguous and unsafe company mappings as labeled searches', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    fetcher.mockResolvedValueOnce({ ok: false })
    expect(await resolveScreenerCompanyPath('UNKNOWN')).toBeNull()
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => [{ url: '/company/UNRELATED/' }] })
    expect(await resolveScreenerCompanyPath('REQUESTED')).toBeNull()
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => [{ url: '/company/123/' }, { url: '/company/456/' }] })
    expect(await resolveScreenerCompanyPath('UNKNOWN')).toBeNull()
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => [{ url: '//evil.example/company/' }] })
    expect(await resolveScreenerCompanyPath('UNKNOWN')).toBeNull()
    expect(marketLinks(holding, '//evil.example/')[0].kind).toBe('search')
  })

  it('uses an exact company result and caches it without reusing old assumed paths', async () => {
    localStorage.setItem('finverse:screenerPath:INFY', JSON.stringify({ path: '/company/WRONG/', at: Date.now() }))
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ url: '/company/INFY/consolidated/' }, { url: '/company/456/' }] })
    vi.stubGlobal('fetch', fetcher)
    expect(await resolveScreenerCompanyPath('INFY')).toBe('/company/INFY/')
    expect(await resolveScreenerCompanyPath('INFY')).toBe('/company/INFY/')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(marketLinks(holding, '/company/INFY/')[0].kind).toBe('page')
  })
})
