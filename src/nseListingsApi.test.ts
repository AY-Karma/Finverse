import { describe, expect, it, vi } from 'vitest'
import { createNseListingsHandler } from '../api/nseListings'

const stock = 'SYMBOL,NAME OF COMPANY,SERIES,ISIN NUMBER\nTCS,Tata Consultancy Services,EQ,INE467B01029\n'
const etf = 'Symbol,Underlying Asset,ISINNumber\nNIFTYBEES,Nifty 50,INF204KB14I2\n'
const request = (isins = 'INE467B01029,INF204KB14I2') => new Request(`http://localhost/api/nseListings?isins=${isins}`)
const fetcher = (equity = stock, funds = etf) => vi.fn<typeof fetch>(async (url) => new Response(String(url).endsWith('/EQUITY_L.csv') ? equity : funds))

describe('verified NSE listing reference API', () => {
  it('uses official stock and ETF masters and reuses the cached reference across different queries', async () => {
    const fetch = fetcher()
    const handle = createNseListingsHandler({ fetcher: fetch })
    const result = await (await handle(request())).json()
    expect(result.candidates).toEqual([
      { exchange: 'NSE', type: 'stock', providerSymbol: 'TCS.NS', isin: 'INE467B01029' },
      { exchange: 'NSE', type: 'etf', providerSymbol: 'NIFTYBEES.NS', isin: 'INF204KB14I2' },
    ])
    await handle(request('INE467B01029'))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv',
      'https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv',
    ])
  })

  it('withholds unknown ISINs, non-EQ series, ambiguous ISINs and symbols assigned to multiple securities', async () => {
    const master = stock + 'OLD,Old series,BE,INE009A01021\nOTHER,Another listing,EQ,INE467B01029\nCONFLICT,First issuer,EQ,INE000000001\nCONFLICT,Second issuer,EQ,INE000000002\n'
    const handle = createNseListingsHandler({ fetcher: fetcher(master) })
    const result = await (await handle(request('INE467B01029,INE009A01021,INE000000001,INE000000002,INE000000003'))).json()
    expect(result.candidates).toEqual([])
  })

  it('fails closed on malformed or unavailable masters and rejects invalid requests before fetching', async () => {
    const fetch = fetcher('SYMBOL,ISIN\nTCS,INE467B01029')
    const handle = createNseListingsHandler({ fetcher: fetch })
    expect((await handle(request('invalid'))).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
    expect((await handle(request())).status).toBe(502)
    const unavailable = createNseListingsHandler({ fetcher: vi.fn(async () => new Response('', { status: 503 })) })
    expect((await unavailable(request())).status).toBe(502)
  })
})
