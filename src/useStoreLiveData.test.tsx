// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoreProvider, useStore } from './useStore'
import * as storePersistence from './store'
import { normalizePosition } from './instruments'
import { quoteKey } from './valuation'
import { resolveYahooSymbol, type LiveQuotesResult } from './live'
import type { LiveQuote } from './types'
import type { MarketDataAdapter } from './marketData'

const { refreshQuotes } = vi.hoisted(() => ({ refreshQuotes: vi.fn<MarketDataAdapter['refreshQuotes']>() }))
vi.mock('./marketData', () => ({ marketData: { refreshQuotes } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const stock = normalizePosition({ id: 'stock', ticker: 'INFY', name: 'Infosys', type: 'stock', exchange: 'NSE', currency: 'INR',
  providerSymbol: 'INFY.NS', exchangeSource: 'explicit', identityVersion: 2, quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100 })
const secondStock = normalizePosition({ ...stock, id: 'second-stock', ticker: 'TCS', name: 'TCS', providerSymbol: 'TCS.NS' })
const fund = normalizePosition({ id: 'fund', ticker: 'Example Fund', name: 'Example Fund Direct Growth', type: 'mutual-fund',
  currency: 'INR', mfScheme: { code: 123456, name: 'Example Fund Direct Growth', source: 'confirmed' },
  quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100 })

let root: Root | undefined
let store: ReturnType<typeof useStore>
const Capture = () => { store = useStore(); return null }
const equityQuote = (price: number, at = Date.now()): LiveQuote => ({ price, at, source: 'yahoo', change: price - 100, changePct: price - 100 })
const navQuote = (price: number): LiveQuote => ({ price, at: Date.parse('2026-11-09T00:00:00+05:30'), source: 'nav' })
const result = (quotes: Record<string, LiveQuote>): LiveQuotesResult => ({ quotes, updated: Object.keys(quotes).length, failed: 0, skipped: 0 })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}
async function mount(positions = [stock, fund], allowExternalData = true) {
  localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'live-account', name: 'Live account', importedAt: 1, positions }]))
  const settings = { ...storePersistence.loadSettings(), allowExternalData }
  localStorage.setItem('finverse:settings', JSON.stringify(settings))
  // Startup retires the saved toggle; seed the runtime permission state explicitly.
  if (!allowExternalData) vi.spyOn(storePersistence, 'loadSettings').mockReturnValueOnce(settings)
  root = createRoot(document.createElement('div'))
  await act(async () => root!.render(<StoreProvider><Capture /></StoreProvider>))
}
const stockRequests = () => refreshQuotes.mock.calls.filter(([positions]) => positions.some((position) => position.type !== 'mutual-fund'))
const navRequests = () => refreshQuotes.mock.calls.filter(([positions]) => positions.some((position) => position.type === 'mutual-fund'))

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-09T06:00:00Z'))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  refreshQuotes.mockReset()
})
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('independent live stock and NAV updates', () => {
  it('resumes polling when saving an unchanged listing cancels the current request', async () => {
    let requests = 0
    refreshQuotes.mockImplementation(async (_positions, _previous, signal) => {
      requests += 1
      if (requests === 2) return new Promise<LiveQuotesResult>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      })
      return result({ [quoteKey(stock)]: equityQuote(150 + requests) })
    })
    await mount([stock])
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(requests).toBe(2)
    await act(async () => store.confirmInstrument(stock.id, { ticker: stock.ticker, type: 'stock', exchange: 'NSE', currency: 'INR', providerSymbol: stock.providerSymbol }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(requests).toBe(3)
    expect(store.liveQuotes[quoteKey(stock)].price).toBe(153)
  })

  it('returns a distinct unavailable-listing reason while keeping imported prices', async () => {
    await mount([{ ...stock, id: 'unmatched', ticker: 'UNMATCHED', exchange: 'BSE', providerSymbol: 'UNMATCHED.BO', isin: undefined }])
    let response!: Awaited<ReturnType<typeof store.refreshNow>>
    await act(async () => { response = await store.refreshNow() })
    expect(response).toMatchObject({ ok: false, reason: 'no-live-listings' })
    expect(refreshQuotes).not.toHaveBeenCalled()
    expect(store.snapshot.currentValue).toBe(100)
    expect(store.marketDataRefreshing).toBe(false)
  })

  it('starts the next stock request one second after a non-instant response completes', async () => {
    refreshQuotes.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
      return result({ [quoteKey(stock)]: equityQuote(150) })
    })
    await mount([stock])
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(store.liveQuotes[quoteKey(stock)].price).toBe(150)
    await act(async () => { await vi.advanceTimersByTimeAsync(999) })
    expect(stockRequests()).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(stockRequests()).toHaveLength(2)
  })

  it('applies stocks and continues one-second polling while the first NAV request is pending', async () => {
    const pendingNav = deferred<LiveQuotesResult>()
    let price = 149
    refreshQuotes.mockImplementation(async (positions) => positions[0].type === 'mutual-fund'
      ? pendingNav.promise : result({ [quoteKey(stock)]: equityQuote(++price) }))
    await mount()
    expect(stockRequests()).toHaveLength(1)
    expect(navRequests()).toHaveLength(1)
    expect(store.liveQuotes[quoteKey(stock)].price).toBe(150)
    expect(store.snapshot.currentValue).toBe(250)
    expect(store.marketDataRefreshing).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(stockRequests()).toHaveLength(3)
    expect(navRequests()).toHaveLength(1)
    expect(store.liveQuotes[quoteKey(stock)].price).toBe(152)
    expect(store.snapshot.currentValue).toBe(252)
    await act(async () => pendingNav.resolve(result({ [quoteKey(fund)]: navQuote(130) })))
    expect(store.liveQuotes[quoteKey(stock)].price).toBe(152)
    expect(store.snapshot.currentValue).toBe(282)
  })

  it('merges late NAV completion without rolling back a newer stock observation', async () => {
    const pendingNav = deferred<LiveQuotesResult>()
    const oldStock = equityQuote(120)
    let price = 149
    refreshQuotes.mockImplementation(async (positions) => positions[0].type === 'mutual-fund'
      ? pendingNav.promise : result({ [quoteKey(stock)]: equityQuote(++price) }))
    await mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    const latestStock = store.liveQuotes[quoteKey(stock)]
    await act(async () => pendingNav.resolve({ quotes: { [quoteKey(fund)]: navQuote(130), [quoteKey(stock)]: oldStock }, updated: 1, failed: 0, skipped: 0 }))
    expect(store.liveQuotes[quoteKey(stock)]).toEqual(latestStock)
    expect(store.liveQuotes[quoteKey(fund)].price).toBe(130)
    expect(store.snapshot.currentValue).toBe(281)
  })

  it('checks the evening NAV schedule without starting stock polling or blanking retained values', async () => {
    vi.setSystemTime(new Date('2026-11-09T12:36:00Z')) // 18:06 IST, before the 18:07 NAV check.
    const eveningNav = deferred<LiveQuotesResult>()
    let navCalls = 0
    refreshQuotes.mockImplementation(async (positions) => {
      if (positions[0].type !== 'mutual-fund') return result({ [quoteKey(stock)]: equityQuote(150) })
      return ++navCalls === 1 ? result({ [quoteKey(fund)]: navQuote(110) }) : eveningNav.promise
    })
    await mount()
    expect(store.snapshot.currentValue).toBe(260)
    expect(store.quoteNextRefreshAt).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(navRequests()).toHaveLength(2)
    expect(stockRequests()).toHaveLength(1)
    expect(store.snapshot.currentValue).toBe(260)
    expect(store.marketDataRefreshing).toBe(false)
    await act(async () => eveningNav.resolve(result({ [quoteKey(fund)]: navQuote(130) })))
    expect(store.snapshot.currentValue).toBe(280)
    expect(stockRequests()).toHaveLength(1)
    expect(store.quoteNextRefreshAt).toBeNull()
  })

  it('finishes a manual stock refresh without waiting for its accompanying NAV request', async () => {
    const manualNav = deferred<LiveQuotesResult>()
    let navCalls = 0
    let price = 149
    refreshQuotes.mockImplementation(async (positions) => {
      if (positions[0].type !== 'mutual-fund') return result({ [quoteKey(stock)]: equityQuote(++price) })
      return ++navCalls === 1 ? result({ [quoteKey(fund)]: navQuote(110) }) : manualNav.promise
    })
    await mount()
    await act(async () => { expect(await store.refreshNow()).toMatchObject({ ok: true }) })
    expect(navRequests()).toHaveLength(2)
    expect(stockRequests()).toHaveLength(2)
    expect(store.liveQuotes[quoteKey(stock)].price).toBe(151)
    expect(store.liveQuotes[quoteKey(fund)].price).toBe(110)
    expect(store.marketDataRefreshing).toBe(false)
    await act(async () => manualNav.resolve(result({ [quoteKey(fund)]: navQuote(130) })))
    expect(store.snapshot.currentValue).toBe(281)
  })

  it('applies a partial stock batch before the remaining stock request finishes', async () => {
    const batch = deferred<LiveQuotesResult>()
    let progress!: NonNullable<Parameters<MarketDataAdapter['refreshQuotes']>[3]>
    refreshQuotes.mockImplementation(async (_positions, _previous, _signal, onProgress) => {
      progress = onProgress!
      return batch.promise
    })
    await mount([stock, secondStock])
    expect(store.marketDataRefreshing).toBe(true)
    await act(async () => progress(result({ [quoteKey(stock)]: equityQuote(150) })))
    expect(store.liveQuotes[quoteKey(stock)].price).toBe(150)
    expect(store.snapshot.currentValue).toBe(250)
    expect(store.marketDataRefreshing).toBe(true)
    await act(async () => batch.resolve(result({ [quoteKey(stock)]: equityQuote(140, Date.now() - 1_000), [quoteKey(secondStock)]: equityQuote(200) })))
    expect(store.liveQuotes[quoteKey(stock)].price).toBe(150)
    expect(store.snapshot.currentValue).toBe(350)
    expect(store.marketDataRefreshing).toBe(false)
    expect(store.quoteNextRefreshAt).toBe(Date.now() + 1_000)
  })

  it('ignores late partial and final stock responses after external-data permission is revoked', async () => {
    const batch = deferred<LiveQuotesResult>()
    let progress!: NonNullable<Parameters<MarketDataAdapter['refreshQuotes']>[3]>
    let signal!: AbortSignal
    refreshQuotes.mockImplementation(async (_positions, _previous, requestSignal, onProgress) => {
      signal = requestSignal!
      progress = onProgress!
      return batch.promise
    })
    await mount([stock])
    await act(async () => progress(result({ [quoteKey(stock)]: equityQuote(150) })))
    expect(store.snapshot.currentValue).toBe(150)
    await act(async () => store.setSettings({ ...store.settings, allowExternalData: false }))
    expect(signal.aborted).toBe(true)
    await act(async () => {
      progress(result({ [quoteKey(stock)]: equityQuote(200) }))
      batch.resolve(result({ [quoteKey(stock)]: equityQuote(220) }))
    })
    expect(store.snapshot.currentValue).toBe(100)
    expect(store.snapshot.quotes).toEqual({})
    expect(store.marketDataRefreshing).toBe(false)
    expect(store.quoteNextRefreshAt).toBeNull()
  })
})

describe('NSE import and existing-workspace enrichment', () => {
  const bse = normalizePosition({ ...secondStock, id: 'bse', ticker: '532540', exchange: 'BSE', providerSymbol: '532540.BO', isin: 'INE467B01029' })
  const candidate = { exchange: 'NSE', type: 'stock', isin: 'INE467B01029', providerSymbol: 'TCS.NS' }

  it('retries a failed NSE reference automatically while retaining imported prices until an exact match arrives', async () => {
    const imported = normalizePosition({ ...bse, id: 'bse-retry', ticker: '500875', providerSymbol: '500875.BO', isin: 'INE154A01025' })
    const matched = { exchange: 'NSE', type: 'stock', isin: imported.isin, providerSymbol: 'ITC.NS' }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockImplementation(async () => Response.json({ candidates: [matched] }))
    vi.stubGlobal('fetch', fetcher)
    refreshQuotes.mockImplementation(async (positions) => result(Object.fromEntries(positions.filter((position) => resolveYahooSymbol(position))
      .map((position) => [quoteKey(position), equityQuote(150)]))))
    await mount([imported])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(store.snapshot.currentValue).toBe(100)
    expect(store.rawPositions[0].pricingListing).toBeUndefined()
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000 - 1) })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(store.snapshot.currentValue).toBe(100)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(store.rawPositions[0]).toMatchObject({ ticker: '500875', exchange: 'BSE', providerSymbol: '500875.BO', pricingListing: matched })
    expect(resolveYahooSymbol(store.rawPositions[0])).toBe('ITC.NS')
    expect(store.snapshot.currentValue).toBe(150)
    expect(store.workspaceReadOnly).toBe(false)
  })

  it('starts unrelated NSE prices immediately while exact-ISIN enrichment is pending, then preserves the BSE import', async () => {
    const reference = deferred<Response>()
    const fetcher = vi.fn<typeof fetch>(async () => reference.promise)
    vi.stubGlobal('fetch', fetcher)
    refreshQuotes.mockImplementation(async (positions) => result(Object.fromEntries(positions.filter((position) => resolveYahooSymbol(position))
      .map((position) => [quoteKey(position), equityQuote(150)]))))
    await mount([bse, stock])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(String(fetcher.mock.calls[0][0])).toContain('/api/nseListings?')
    expect(store.liveQuotes[quoteKey(stock)].price).toBe(150)
    expect(store.rawPositions.find((position) => position.id === 'bse')?.pricingListing).toBeUndefined()
    await act(async () => reference.resolve(Response.json({ candidates: [candidate] })))
    const preferred = store.rawPositions.find((position) => position.id === 'bse')!
    expect(preferred).toMatchObject({ ticker: '532540', exchange: 'BSE', providerSymbol: '532540.BO', quantity: 1,
      buyPrice: 100, invested: 100, lastPrice: 100, currency: 'INR', pricingListing: candidate })
    expect(preferred.identityIssue).toBeUndefined()
    expect(resolveYahooSymbol(preferred)).toBe('TCS.NS')
    expect(store.liveQuotes[quoteKey(stock)].price).toBe(150)
    expect(store.liveQuotes[quoteKey(preferred)].price).toBe(150)
    expect(JSON.parse(localStorage.getItem('finverse:folios')!)[0].positions[0].pricingListing).toMatchObject(candidate)
    expect(store.workspaceReadOnly).toBe(false)
  })

  it('enriches a permitted CSV import through exact NSE ISIN mapping before its first quote request', async () => {
    const importedCandidate = { exchange: 'NSE', type: 'stock', isin: 'INE009A01021', providerSymbol: 'INFY.NS' }
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ candidates: [importedCandidate] }))
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('Worker', undefined)
    refreshQuotes.mockImplementation(async (positions) => result(Object.fromEntries(positions.filter((position) => resolveYahooSymbol(position))
      .map((position) => [quoteKey(position), equityQuote(150)]))))
    await mount([])
    const buffer = new TextEncoder().encode('Symbol,Quantity,Average Price,Last Price,Exchange,ISIN\n500209,2,100,110,BSE,INE009A01021').buffer as ArrayBuffer
    const file = { name: 'bse.csv', size: buffer.byteLength, arrayBuffer: async () => buffer.slice(0) } as File
    let preview!: Awaited<ReturnType<typeof store.previewFile>>
    await act(async () => { preview = await store.previewFile(file) })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(String(fetcher.mock.calls[0][0])).toContain('/api/nseListings?isins=INE009A01021')
    expect(preview.positions[0]).toMatchObject({ ticker: '500209', exchange: 'BSE', isin: 'INE009A01021',
      quantity: 2, buyPrice: 100, lastPrice: 110, invested: 200, pricingListing: importedCandidate })
    expect(resolveYahooSymbol(preview.positions[0])).toBe('INFY.NS')
    expect(refreshQuotes).not.toHaveBeenCalled()
    await act(async () => { expect(await store.commitImport(preview)).toBe(true) })
    expect(stockRequests()).toHaveLength(1)
    expect(resolveYahooSymbol(stockRequests()[0][0][0])).toBe('INFY.NS')
    expect(store.snapshot.currentValue).toBe(300)
    expect(store.workspaceReadOnly).toBe(false)
  })

  it('keeps both existing-portfolio migration and CSV import offline while consent is off', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('Worker', undefined)
    await mount([bse], false)
    expect(store.workspaceReadOnly).toBe(false)
    const persistedBefore = [localStorage.getItem('finverse:folios'), localStorage.getItem('finverse:settings')]
    const buffer = new TextEncoder().encode('Symbol,Quantity,Average Price,Last Price,Exchange,ISIN\n532540,1,100,100,BSE,INE467B01029').buffer as ArrayBuffer
    const file = { name: 'bse.csv', size: buffer.byteLength, arrayBuffer: async () => buffer.slice(0) } as File
    let preview!: Awaited<ReturnType<typeof store.previewFile>>
    await act(async () => { preview = await store.previewFile(file) })
    expect(store.workspaceReadOnly).toBe(false)
    expect(preview.positions[0]).toMatchObject({ ticker: '532540', exchange: 'BSE', isin: 'INE467B01029' })
    expect(preview.positions[0].pricingListing).toBeUndefined()
    expect([localStorage.getItem('finverse:folios'), localStorage.getItem('finverse:settings')]).toEqual(persistedBefore)
    await act(async () => { expect(await store.commitImport(preview)).toBe(true) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetcher).not.toHaveBeenCalled()
    expect(refreshQuotes).not.toHaveBeenCalled()
    expect(store.marketDataRefreshing).toBe(false)
  })
})
