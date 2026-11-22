import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseWatchSecurity, watchSecurityKey, watchSecurityLabel } from './watchSecurity'
import { cleanWatchQuery, searchWatchSecurities } from './watchSecuritySearch'

const tcs = { kind: 'equity', symbol: 'TCS.NS', isin: 'INE467B01029', name: 'Tata Consultancy Services', type: 'stock' } as const
const fund = { kind: 'fund', code: 119551, name: 'Example Nifty 50 Index Fund Direct Growth' } as const

describe('watch securities', () => {
  it('accepts only NSE equities with an ISIN and funds with a scheme code', () => {
    expect(parseWatchSecurity(tcs)).toEqual(tcs)
    expect(parseWatchSecurity(fund)).toEqual(fund)
    for (const value of [null, 'TCS', { ...tcs, symbol: 'TCS.BO' }, { ...tcs, symbol: '^NSEI' }, { ...tcs, isin: 'bad' }, { ...tcs, type: 'bond' }, { ...tcs, name: ' ' },
      { ...fund, code: 0 }, { ...fund, code: 1.5 }, { ...fund, code: '119551' }, { kind: 'other', name: 'x' }]) expect(parseWatchSecurity(value)).toBeNull()
    expect(parseWatchSecurity({ ...tcs, name: 'x'.repeat(300) })?.name).toHaveLength(200)
  })

  it('keys and labels each security distinctly from holdings', () => {
    expect(watchSecurityKey(tcs)).toBe('watch:equity:TCS.NS:INE467B01029')
    expect(watchSecurityKey(fund)).toBe('watch:fund:119551')
    expect(watchSecurityLabel(tcs)).toBe('TCS · Stock')
    expect(watchSecurityLabel({ ...tcs, symbol: 'NIFTYBEES.NS', type: 'etf' })).toBe('NIFTYBEES · ETF')
    expect(watchSecurityLabel(fund)).toBe('Mutual fund')
  })
})

describe('watch search', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts plain names and symbols but rejects links, URLs and other text', () => {
    expect(cleanWatchQuery('  Tata   Motors ')).toBe('Tata Motors')
    expect(cleanWatchQuery('M&M')).toBe('M&M')
    for (const query of ['', 'a', 'x'.repeat(41), 'https://www.nseindia.com/get-quotes/equity?symbol=TCS', 'www.tcs.com', 'tcs.com', 'tcs/ltd', 'tcs; drop', '<b>tcs</b>']) expect(cleanWatchQuery(query)).toBeNull()
  })

  it('combines both indexes, drops invalid rows, ranks Direct Growth funds first and reports a failed source', async () => {
    const respond = (url: string) => url.startsWith('/api/nseListings')
      ? Response.json({ results: [{ providerSymbol: 'TCS.NS', isin: 'INE467B01029', type: 'stock', name: 'Tata Consultancy Services' }, { providerSymbol: 'BAD.BO', isin: 'INE467B01029', type: 'stock', name: 'Bad' }] })
      : Response.json([{ schemeCode: 1, schemeName: 'Example Fund Regular IDCW' }, { schemeCode: 2, schemeName: 'Example Fund Direct Growth' }, { schemeCode: 'x', schemeName: 'Invalid' }])
    vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(String(url))))
    const result = await searchWatchSecurities('tata', new AbortController().signal)
    expect(result.unavailable).toEqual([])
    expect(result.securities.map(watchSecurityKey)).toEqual(['watch:equity:TCS.NS:INE467B01029', 'watch:fund:2', 'watch:fund:1'])

    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).startsWith('/api/') ? new Response('', { status: 503 }) : respond(String(url))))
    const partial = await searchWatchSecurities('tata', new AbortController().signal)
    expect(partial.unavailable).toEqual(['stocks'])
    expect(partial.securities.map(watchSecurityKey)).toEqual(['watch:fund:2', 'watch:fund:1'])
  })
})
