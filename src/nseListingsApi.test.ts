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
    const response = await handle(request())
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=3600, stale-while-revalidate=86400')
    const result = await response.json()
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
    const failed = await handle(request())
    expect(failed.status).toBe(502)
    expect(failed.headers.get('vercel-cdn-cache-control')).toBeNull()
    const unavailable = createNseListingsHandler({ fetcher: vi.fn(async () => new Response('', { status: 503 })) })
    expect((await unavailable(request())).status).toBe(502)
  })

  describe('search', () => {
    const names = 'SYMBOL,NAME OF COMPANY,SERIES,ISIN NUMBER\nTCS,Tata Consultancy Services,EQ,INE467B01029\nTATAMOTORS,Tata Motors Limited,EQ,INE155A01022\nM&M,Mahindra & Mahindra Limited,EQ,INE101A01026\nOLD,Old series,BE,INE009A01021\n'
    const funds = 'Symbol,Underlying Asset,SecurityName,ISINNumber\nTATAGOLD,Gold,TATA GOLD ETF,INF277K01Z77\nNIFTYBEES,Nifty 50,NIPINDETFNIFTYBEES,INF204KB14I2\n'
    const search = (q: string) => new Request(`http://localhost/api/nseListings?q=${encodeURIComponent(q)}`)

    it('matches company names and symbols from both masters, symbol and prefix first, without exposing search text', async () => {
      const handle = createNseListingsHandler({ fetcher: fetcher(names, funds) })
      const response = await handle(search('tata'))
      expect(response.headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=3600, stale-while-revalidate=86400')
      expect((await response.json()).results).toEqual([
        { providerSymbol: 'TATAGOLD.NS', isin: 'INF277K01Z77', type: 'etf', name: 'TATA GOLD ETF' },
        { providerSymbol: 'TATAMOTORS.NS', isin: 'INE155A01022', type: 'stock', name: 'Tata Motors Limited' },
        { providerSymbol: 'TCS.NS', isin: 'INE467B01029', type: 'stock', name: 'Tata Consultancy Services' },
      ])
      expect((await (await handle(search('m&m'))).json()).results.map((item: { providerSymbol: string }) => item.providerSymbol)).toEqual(['M&M.NS'])
      expect((await (await handle(search('nifty 50'))).json()).results.map((item: { providerSymbol: string }) => item.providerSymbol)).toEqual(['NIFTYBEES.NS'])
      expect((await (await handle(search('old series'))).json()).results).toEqual([])
    })

    it('rejects links, free text and oversized queries before fetching, and never mixes modes', async () => {
      const fetch = fetcher(names, funds)
      const handle = createNseListingsHandler({ fetcher: fetch })
      for (const query of ['a', 'https://example.com', 'tata/motors', 'x'.repeat(41), 'tata<script>']) expect((await handle(search(query))).status).toBe(400)
      expect((await handle(new Request('http://localhost/api/nseListings?q=tata&isins=INE467B01029'))).status).toBe(400)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('drops symbols assigned to conflicting securities and fails closed when a master is unavailable', async () => {
      const conflict = names + 'TATAX,First issuer,EQ,INE000000001\nTATAX,Second issuer,EQ,INE000000002\n'
      expect((await (await createNseListingsHandler({ fetcher: fetcher(conflict, funds) })(search('tatax'))).json()).results).toEqual([])
      const down = createNseListingsHandler({ fetcher: vi.fn(async () => new Response('', { status: 503 })) })
      expect((await down(search('tata'))).status).toBe(502)
    })
  })
})
