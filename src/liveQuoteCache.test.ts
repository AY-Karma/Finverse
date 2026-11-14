// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCachedQuotes, saveCachedQuotes } from './liveQuoteCache'
import { normalizePosition } from './instruments'
import { quoteKey } from './valuation'
import type { LiveQuote } from './types'

const stock = normalizePosition({ id: 'stock', ticker: 'INFY', name: 'Infosys', type: 'stock', exchange: 'NSE', currency: 'INR',
  providerSymbol: 'INFY.NS', exchangeSource: 'explicit', identityVersion: 2, quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100 })
const fund = normalizePosition({ ...stock, id: 'fund', ticker: 'Example Fund', name: 'Example Fund', type: 'mutual-fund',
  mfScheme: { code: 123456, name: 'Example Fund', source: 'confirmed' } })
const now = Date.parse('2026-11-09T06:00:00Z')
const quote: LiveQuote = { price: 150, at: now - 1_000, fetchedAt: now, source: 'yahoo', change: 5, changePct: 3.45 }

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('saved price observations', () => {
  it('keeps source dates and day moves while limiting restoration to compatible current holdings', () => {
    const quotes = { [quoteKey(stock)]: quote, [quoteKey(fund)]: { ...quote, source: 'nav' as const } }
    saveCachedQuotes([stock, fund], quotes, now)
    expect(loadCachedQuotes([stock, fund], now)).toEqual(quotes)
    expect(loadCachedQuotes([fund], now)).toEqual({ [quoteKey(fund)]: quotes[quoteKey(fund)] })
    expect(loadCachedQuotes([{ ...stock, providerSymbol: 'TCS.NS' }], now)).toEqual({})
    expect(loadCachedQuotes([stock], now + 8 * 86_400_000)).toEqual({})
  })

  it('ignores invalid observations and corrupt or unavailable browser storage', () => {
    for (const invalid of [{ ...quote, price: NaN }, { ...quote, at: now + 600_000 }, { ...quote, source: 'nav' as const }]) {
      saveCachedQuotes([stock], { [quoteKey(stock)]: invalid }, now)
      expect(loadCachedQuotes([stock], now)).toEqual({})
    }
    localStorage.setItem('finverse:live-quotes:v1', '{broken')
    expect(loadCachedQuotes([stock], now)).toEqual({})
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
    expect(loadCachedQuotes([stock], now)).toEqual({})
    expect(() => saveCachedQuotes([stock], { [quoteKey(stock)]: quote }, now)).not.toThrow()
  })
})
