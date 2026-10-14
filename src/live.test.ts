import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveQuote, Position } from './types'
import { normalizePosition } from './instruments'
import { quoteKey } from './valuation'
import { marketData } from './marketData'
import { investmentWorkspace } from './investmentWorkspace'
import {
  fetchLiveQuotes,
  fetchHistory,
  fetchNavHistory,
  fetchUsdInrRate,
  fetchYahooPrice,
  isMarketOpen,
  marketStatusText,
  quoteRefreshIssueText,
} from './live'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('market status text', () => {
  it('reports missing, loading, timestamped and disabled market data', () => {
    expect(marketStatusText(true)).toBe('Market Open - no provider prices yet')
    expect(marketStatusText(false)).toBe('Market Closed - no provider prices yet')
    expect(marketStatusText(true, true, true, true)).toBe('Market Open - fetching latest available data')

    expect(marketStatusText(false, true, true, true)).toBe('Market Closed - fetching latest available data')

    expect(marketStatusText(true, true, false, true)).toBe('Market Open - fetching latest available data')

    const timestamp = '01 Oct, 15:15:00 IST'
    expect(marketStatusText(false, true, true, false, timestamp)).toBe(`Market Closed - showing prices as of ${timestamp}`)
    expect(marketStatusText(true, true, true, false, timestamp)).toBe(`Market Open - showing prices as of ${timestamp}`)
    expect(marketStatusText(false, true, true, true, timestamp)).toBe('Market Closed - fetching latest available data')
    expect(marketStatusText(false, false, true, false, timestamp)).toBe('External market data off · showing imported prices')
    expect(marketStatusText(false, true, false, false, timestamp)).toBe('Waiting for USD/INR rate…')
  })

  it('continues polling on weekdays when a future holiday calendar is unavailable', () => {
    expect(isMarketOpen(new Date('2027-01-04T04:00:00.000Z'))).toBe(true)
  })

  it('treats the market as closed outside the NSE trading window', () => {
    expect(isMarketOpen(new Date('2026-09-23T03:44:00.000Z'))).toBe(false)
    expect(isMarketOpen(new Date('2026-09-23T03:45:00.000Z'))).toBe(true)
    expect(isMarketOpen(new Date('2026-09-23T09:59:00.000Z'))).toBe(true)
    expect(isMarketOpen(new Date('2026-09-23T10:00:00.000Z'))).toBe(false)
  })

  it('reports partial quote retention without treating skipped daily NAVs as failures', () => {
    expect(quoteRefreshIssueText({ quotes: {}, updated: 7, failed: 1, skipped: 2 }))
      .toBe('1 quote retained from previous or imported values.')
    expect(quoteRefreshIssueText({ quotes: {}, updated: 0, failed: 0, skipped: 2 })).toBeNull()
  })
})

describe('market data client', () => {
  it('queues excess distinct history requests and removes cancelled waiters before fetching', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetcher = vi.fn<typeof fetch>(async () => {
      await gate
      return Response.json({ points: [{ date: '2026-09-22', close: 101 }] })
    })
    vi.stubGlobal('fetch', fetcher)
    const from = new Date('2026-09-01T00:00:00Z')
    const to = new Date('2026-09-23T00:00:00Z')
    const first = Array.from({ length: 7 }, (_, i) => fetchHistory(`QUEUED${i}.NS`, from, to))
    const cancelled = new AbortController()
    const pending = fetchHistory('CANCELLED.NS', from, to, cancelled.signal)
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const last = fetchHistory('LAST.NS', from, to)
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(7)
    cancelled.abort()
    await failure
    release()
    await Promise.all([...first, last])
    expect(fetcher).toHaveBeenCalledTimes(8)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('CANCELLED.NS'))).toBe(false)
  })

  it('rechecks durable history after another tab replaces or removes it and isolates returned points', async () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    })
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ points: [{ date: '2026-09-22', close: 101 }] }))
    vi.stubGlobal('fetch', fetcher)
    const from = new Date('2026-09-01T00:00:00Z')
    const to = new Date('2026-09-23T00:00:00Z')
    const first = await fetchHistory('CACHECHECK.NS', from, to)
    first[0].close = 999
    expect((await fetchHistory('CACHECHECK.NS', from, to))[0].close).toBe(101)
    const key = 'finverse:history:v2:CACHECHECK.NS'
    const entry = JSON.parse(stored.get(key)!)
    stored.set(key, JSON.stringify({ ...entry, points: [{ date: '2026-09-22', close: 102 }] }))
    expect((await fetchHistory('CACHECHECK.NS', from, to))[0].close).toBe(102)
    stored.clear()
    expect((await fetchHistory('CACHECHECK.NS', from, to))[0].close).toBe(101)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it.each([{ nav: '120', fundChange: 10, total: 40 }, { nav: '110', fundChange: 0, total: 20 }])('includes a confirmed fund change in a complete same-session portfolio move: $fundChange', async ({ nav, fundChange, total }) => {
    const equity = normalizePosition({ ...position('RELIANCE'), exchangeSource: 'explicit', identityVersion: 2 })
    const fund: Position = { ...position('Fund Direct Growth'), type: 'mutual-fund', quantity: 2, mfScheme: { code: 701, name: 'Fund Direct Growth', source: 'confirmed' } }
    vi.stubGlobal('fetch', vi.fn(async (url) => String(url).startsWith('/api/quotes')
      ? Response.json({ fetchedAt: '2026-09-25T10:00:00Z', quotes: [{ symbol: 'RELIANCE.NS', price: 120, change: 20, changePct: 20, marketTime: '2026-09-25T10:00:00Z', source: 'yahoo' }] })
      : Response.json({ data: String(url).endsWith('/latest')
        ? [{ date: '25-09-2026', nav }]
        : [{ date: '25-09-2026', nav }, { date: '24-09-2026', nav: '110' }] })))
    const result = await fetchLiveQuotes([equity, fund], {})
    expect(result.quotes[quoteKey(fund)]).toMatchObject({ price: Number(nav), change: fundChange, source: 'nav' })
    expect(result.quotes[quoteKey(fund)].changePct).toBeCloseTo(fundChange / 110 * 100)
    const snapshot = investmentWorkspace.readSnapshot({ folios: [{ id: 'f', name: 'Reviewed portfolio', importedAt: 1, positions: [equity, fund] }], quotes: result.quotes, fxRate: null })
    expect(snapshot).toMatchObject({ dailyChangeDate: '2026-09-25', dailyChangeCount: 2, dailyChange: total })
  })

  it('uses the previous published NAV across weekends and ignores invalid and duplicate-date rows', async () => {
    const fund: Position = { ...position('Fund Direct Growth'), type: 'mutual-fund', mfScheme: { code: 702, name: 'Fund Direct Growth', source: 'confirmed' } }
    vi.stubGlobal('fetch', vi.fn(async (url) => Response.json({ data: String(url).endsWith('/latest')
      ? [{ date: '28-09-2026', nav: '99' }]
      : [{ date: '24-09-2026', nav: '90' }, { date: '28-09-2026', nav: '99' }, { date: '27-09-2026', nav: '0' }, { date: 'invalid', nav: '999' }, { date: '25-09-2026', nav: '100' }, { date: '28-09-2026', nav: '98' }] })))
    const result = await fetchLiveQuotes([fund], {})
    expect(result.quotes[quoteKey(fund)]).toMatchObject({ price: 99, change: -1, changePct: -1, at: Date.parse('2026-09-28T00:00:00+05:30') })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['missing', 'failed'])('retains the latest NAV without inventing a move when prior history is %s', async (history) => {
    const fund: Position = { ...position('Fund Direct Growth'), type: 'mutual-fund', mfScheme: { code: history === 'missing' ? 703 : 704, name: 'Fund Direct Growth', source: 'confirmed' } }
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/latest')) return Response.json({ data: [{ date: '25-09-2026', nav: '120' }] })
      if (history === 'failed') throw new Error('History unavailable')
      return Response.json({ data: [{ date: '25-09-2026', nav: '120' }] })
    }))
    const result = await fetchLiveQuotes([fund], {})
    expect(result).toMatchObject({ updated: 1, failed: 0 })
    expect(result.quotes[quoteKey(fund)]).toMatchObject({ price: 120, source: 'nav' })
    expect(result.quotes[quoteKey(fund)].change).toBeUndefined()
  })

  it.each([{ date: '2026-09-24', change: 5 }, { date: '2026-09-25', change: undefined }])('checks a pending NAV again even if fetched earlier today: $date, change $change', async ({ date, change }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T15:00:00Z'))
    try {
      const fund: Position = { ...position('Fund Direct Growth'), type: 'mutual-fund', mfScheme: { code: 705, name: 'Fund Direct Growth', source: 'confirmed' } }
      const previous: Record<string, LiveQuote> = { [quoteKey(fund)]: { price: 110, change, at: Date.parse(`${date}T00:00:00+05:30`), fetchedAt: Date.parse('2026-09-25T06:00:00Z'), source: 'nav' } }
      vi.stubGlobal('fetch', vi.fn(async (url) => Response.json({ data: String(url).endsWith('/latest')
        ? [{ date: '25-09-2026', nav: '120' }]
        : [{ date: '25-09-2026', nav: '120' }, { date: '24-09-2026', nav: '110' }] })))
      const result = await fetchLiveQuotes([fund], previous)
      expect(result).toMatchObject({ updated: 1, skipped: 0 })
      expect(result.quotes[quoteKey(fund)]).toMatchObject({ price: 120, change: 10 })
    } finally { vi.useRealTimers() }
  })

  it('coalesces overlapping refreshes and bounds parallel symbol batches', async () => {
    let active = 0
    let maximum = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      active += 1
      maximum = Math.max(maximum, active)
      await gate
      active -= 1
      const symbols = new URL(String(url), 'http://localhost').searchParams.get('symbols')!.split(',')
      return Response.json({ fetchedAt: new Date().toISOString(), quotes: symbols.map((symbol) => ({ symbol, price: 120, previousClose: 100, change: 20, changePct: 20, marketTime: new Date().toISOString(), source: 'yahoo' })), errors: [] })
    })
    vi.stubGlobal('fetch', fetcher)
    const positions: Position[] = Array.from({ length: 125 }, (_, i) => ({ id: String(i), ticker: `POOL${i}`, name: '', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: null }))
    const first = fetchLiveQuotes(positions, {})
    const second = fetchLiveQuotes(positions, {})
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(4)
    release()
    const results = await Promise.all([first, second])
    expect(results.map((result) => result.updated)).toEqual([125, 125])
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(maximum).toBe(4)
  })

  it('refetches history after an empty provider response', async () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    })
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ points: [] }))
      .mockResolvedValueOnce(Response.json({ points: [{ date: '2026-09-22', close: 101 }] }))
    vi.stubGlobal('fetch', fetcher)
    const from = new Date('2026-09-01T00:00:00Z')
    const to = new Date('2026-09-23T00:00:00Z')

    await expect(fetchHistory('FMCGIETF.NS', from, to)).resolves.toEqual([])
    await expect(fetchHistory('FMCGIETF.NS', from, to)).resolves.toEqual([{ date: '2026-09-22', close: 101 }])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('fetches only the missing dates when history expands', async () => {
    const stored = new Map<string, string>([['finverse:history:TCS.NS:2026-09-21:2026-09-22', 'old cache']])
    vi.stubGlobal('localStorage', {
      get length() { return stored.size },
      key: (index: number) => [...stored.keys()][index] ?? null,
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    })
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ points: [{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 101 }] }))
      .mockResolvedValueOnce(Response.json({ points: [{ date: '2026-09-19', close: 98 }] }))
    vi.stubGlobal('fetch', fetcher)
    const date = (day: string) => new Date(`${day}T12:00:00+05:30`)

    await expect(fetchHistory('TCS.NS', date('2026-09-21'), date('2026-09-22'))).resolves.toHaveLength(2)
    await expect(fetchHistory('TCS.NS', date('2026-09-19'), date('2026-09-22'))).resolves.toHaveLength(3)
    await expect(fetchHistory('TCS.NS', date('2026-09-21'), date('2026-09-22'))).resolves.toHaveLength(2)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('from=2026-09-19&to=2026-09-20')
    expect([...stored.keys()]).toEqual(['finverse:history:v2:TCS.NS'])
  })

  it('uses the same-origin quote endpoint and preserves the market timestamp', async () => {
    const marketTime = '2026-08-24T09:45:02.000Z'
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        provider: 'yahoo-unofficial',
        fetchedAt: '2026-08-25T06:00:00.000Z',
        quotes: [
          {
            symbol: 'RELIANCE.NS',
            price: 1309.8,
            previousClose: 1316,
            change: -6.2,
            changePct: -0.47,
            marketTime,
            source: 'yahoo',
          },
        ],
        errors: [],
      }),
    )
    vi.stubGlobal('fetch', fetcher)

    await expect(fetchYahooPrice('RELIANCE.NS')).resolves.toEqual({
      price: 1309.8,
      change: -6.2,
      pct: -0.47,
      at: Date.parse(marketTime),
      fetchedAt: Date.parse('2026-08-25T06:00:00.000Z'),
      source: 'yahoo',
    })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/quotes?symbols=RELIANCE.NS',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('uses the Frankfurter publication date instead of the HTTP request time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ date: '2026-08-24', rates: { INR: 87.42 } }),
    ))

    await expect(fetchUsdInrRate()).resolves.toEqual({
      usdInr: 87.42,
      at: Date.parse('2026-08-24T00:00:00Z'),
    })
  })

  it('batches equity holdings and retains a failed holding without hiding the partial failure', async () => {
    const positions: Position[] = [
      position('RELIANCE'),
      position('TCS'),
    ]
    const previous: Record<string, LiveQuote> = {
      [quoteKey(positions[1])]: { price: 2200, at: 1, source: 'yahoo' },
    }
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        provider: 'yahoo-unofficial',
        fetchedAt: '2026-08-25T06:00:00.000Z',
        quotes: [
          {
            symbol: 'RELIANCE.NS',
            price: 1309.8,
            previousClose: 1316,
            change: -6.2,
            changePct: -0.47,
            marketTime: '2026-08-24T09:45:02.000Z',
            source: 'yahoo',
          },
        ],
        errors: [{ symbol: 'TCS.NS', message: 'No quote returned by the provider.' }],
      }),
    )
    vi.stubGlobal('fetch', fetcher)

    const result = await fetchLiveQuotes(positions, previous)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('RELIANCE.NS%2CTCS.NS')
    expect(result).toMatchObject({ updated: 1, failed: 1, skipped: 0 })
    expect(result.quotes[quoteKey(positions[1])]).toEqual(previous[quoteKey(positions[1])])
    expect(result.quotes[quoteKey(positions[0])]).toMatchObject({
      price: 1309.8,
      at: Date.parse('2026-08-24T09:45:02.000Z'),
    })
  })

  it('does not wait after a current daily NAV that needs no request', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T06:00:00Z'))
    try {
      const fund: Position = { ...position('FUND'), type: 'mutual-fund', mfScheme: { code: 1, name: 'Fund Direct Growth', source: 'confirmed' } }
      const previous: Record<string, LiveQuote> = {
        'MF:mfapi:1': { price: 120, change: 0, at: Date.now(), fetchedAt: Date.now(), source: 'nav' },
      }
      const fetcher = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', fetcher)

      let settled = false
      const pending = fetchLiveQuotes([fund], previous).then((result) => {
        settled = true
        return result
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(settled).toBe(true)
      expect(await pending).toMatchObject({ updated: 0, failed: 0, skipped: 1 })
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not use name-based NAVs or request history before a scheme is reviewed', async () => {
    const fund: Position = { ...position('FUND'), type: 'mutual-fund', lastPrice: 120 }
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)
    const result = await fetchLiveQuotes([fund], { 'MF:fund': { price: 999, at: Date.now(), source: 'nav' } })
    expect(result).toEqual({ quotes: {}, updated: 0, failed: 1, skipped: 0 })
    await expect(fetchNavHistory(fund, new Date('2026-09-01T00:00:00Z'), new Date('2026-09-23T00:00:00Z'))).resolves.toEqual([])
    expect(fund.lastPrice).toBe(120)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not use a saved scheme whose plan or option contradicts the holding', async () => {
    const fund: Position = { ...position('Example Fund Direct IDCW'), type: 'mutual-fund', mfScheme: { code: 1, name: 'Example Fund Regular Growth', source: 'confirmed' } }
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)
    const result = await fetchLiveQuotes([fund], { 'MF:mfapi:1': { price: 999, at: Date.now(), source: 'nav' } })
    expect(result.quotes).toEqual({})
    await expect(fetchNavHistory(fund, new Date('2026-09-01T00:00:00Z'), new Date('2026-09-23T00:00:00Z'))).resolves.toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not label an INR MFAPI NAV as a USD holding price', async () => {
    const fund: Position = { ...position('Example Fund Direct Growth'), currency: 'USD', type: 'mutual-fund', mfScheme: { code: 1, name: 'Example Fund Direct Growth', source: 'confirmed' } }
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)
    expect((await fetchLiveQuotes([fund], {})).quotes).toEqual({})
    await expect(fetchNavHistory(fund, new Date('2026-09-01T00:00:00Z'), new Date('2026-09-23T00:00:00Z'))).resolves.toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses the saved code for latest NAV and history, ignoring a name cache and changed imported name', async () => {
    const name = 'Imported fund alias'
    const stored = new Map<string, string>([['finverse:history:v2:mf:importedfundalias', JSON.stringify({ from: '2026-09-01', to: '2026-09-23', points: [{ date: '2026-09-22', close: 999 }], at: Date.now() })]])
    vi.stubGlobal('localStorage', {
      get length() { return stored.size },
      key: (index: number) => [...stored.keys()][index] ?? null,
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    })
    const fund: Position = { ...position(name), type: 'mutual-fund', instrumentKey: 'MF:imported fund alias', mfScheme: { code: 42, name: 'Reviewed Fund Direct IDCW', source: 'confirmed' } }
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ date: '22-09-2026', nav: '77.5' }] }))
    vi.stubGlobal('fetch', fetcher)

    const latest = await fetchLiveQuotes([fund], {})
    expect(latest.quotes['MF:mfapi:42']).toMatchObject({ price: 77.5, at: Date.parse('2026-09-22T00:00:00+05:30'), source: 'nav' })
    const range = [new Date('2026-09-01T00:00:00Z'), new Date('2026-09-23T00:00:00Z')] as const
    await expect(fetchNavHistory({ ...fund, name: 'Changed alias' }, ...range)).resolves.toEqual([{ date: '2026-09-22', close: 77.5 }])
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.mfapi.in/mf/42',
      'https://api.mfapi.in/mf/42?startDate=2026-09-01&endDate=2026-09-23',
    ])
    expect(stored.has('finverse:history:v2:mfapi:42')).toBe(true)
    await expect(fetchNavHistory({ ...fund, name: 'Another alias' }, ...range)).resolves.toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await fetchNavHistory({ ...fund, mfScheme: { ...fund.mfScheme!, code: 43 } }, ...range)
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('/mf/43?')
  })

  it('coalesces NAV requests for the same saved code across imported aliases', async () => {
    const mapping = { code: 52, name: 'Reviewed Fund Direct Growth', source: 'exact' as const }
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ date: '22-09-2026', nav: '120' }] }))
    vi.stubGlobal('fetch', fetcher)
    const funds = ['First alias', 'Second alias'].map((name) => ({ ...position(name), type: 'mutual-fund' as const, mfScheme: mapping }))
    const results = await Promise.all(funds.map((fund) => fetchLiveQuotes([fund], {})))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(results.map((result) => result.quotes['MF:mfapi:52'].price)).toEqual([120, 120])
  })

  it.each([undefined, '31-02-2026'])('does not relabel a NAV with an invalid observation date as freshly observed: %s', async (date) => {
    const fund: Position = { ...position('FUND'), type: 'mutual-fund', mfScheme: { code: 61, name: 'Fund Direct Growth', source: 'exact' } }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ date, nav: '120' }] })))
    expect(await fetchLiveQuotes([fund], {})).toMatchObject({ updated: 0, failed: 1, quotes: {} })
  })

  it('fetches same-ticker NSE and BSE listings without sharing their quotes', async () => {
    const holdings = [
      normalizePosition({ ...position('SAME'), id: 'nse', exchange: 'NSE', providerSymbol: 'SAME.NS', identityVersion: 2 }),
      normalizePosition({ ...position('SAME'), id: 'bse', exchange: 'BSE', providerSymbol: 'SAME.BO', identityVersion: 2 }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ fetchedAt: '2026-09-23T06:00:00Z', quotes: [
      { symbol: 'SAME.NS', price: 100, change: 0, changePct: 0, marketTime: '2026-09-23T06:00:00Z', source: 'yahoo' },
      { symbol: 'SAME.BO', price: 200, change: 0, changePct: 0, marketTime: '2026-09-23T06:00:00Z', source: 'yahoo' },
    ] })))
    const result = await fetchLiveQuotes(holdings, {})
    expect(result.updated).toBe(2)
    expect(result.quotes[quoteKey(holdings[0])].price).toBe(100)
    expect(result.quotes[quoteKey(holdings[1])].price).toBe(200)
  })

  it.each([
    { ...position('SAME'), exchange: 'OTHER' as const, reportedExchange: 'UNSUPPORTED', lastPrice: 120 },
    { ...position('500112'), exchange: 'BSE' as const, providerSymbol: '500112.BO', lastPrice: 120, identityVersion: 2 as const },
  ])('keeps unresolved mappings on imported values without requesting guessed symbols: $ticker', async (position) => {
    const holding = normalizePosition(position)
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)
    expect((await fetchLiveQuotes([holding], { [quoteKey(holding)]: { price: 999, at: 1, source: 'yahoo' } })).quotes).toEqual({})
    await expect(marketData.history(holding, new Date('2026-09-01T00:00:00Z'), new Date('2026-09-23T00:00:00Z'))).resolves.toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
    expect(investmentWorkspace.readSnapshot({ folios: [{ id: 'account', name: 'Account', importedAt: 1, positions: [holding] }], quotes: {}, fxRate: null })).toMatchObject({ currentValue: 120, quotedCount: 0 })
  })

  it('isolates listing history from legacy symbol caches and conflicting ISIN metadata', async () => {
    const stored = new Map<string, string>([['finverse:history:v2:SAME.NS', JSON.stringify({ from: '2026-09-01', to: '2026-09-23', at: Date.now(), points: [{ date: '2026-09-22', close: 999 }] })]])
    vi.stubGlobal('localStorage', {
      get length() { return stored.size }, key: (index: number) => [...stored.keys()][index] ?? null,
      getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key),
    })
    const first = normalizePosition({ ...position('SAME'), isin: 'INE000000001' })
    const conflicting = normalizePosition({ ...first, id: 'conflict', isin: 'INE000000002' })
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ points: [{ date: '2026-09-22', close: 120 }] }))
    vi.stubGlobal('fetch', fetcher)
    const range = [new Date('2026-09-01T00:00:00Z'), new Date('2026-09-23T00:00:00Z')] as const
    await expect(marketData.history(first, ...range)).resolves.toEqual([{ date: '2026-09-22', close: 120 }])
    await expect(marketData.history(conflicting, ...range)).resolves.toEqual([{ date: '2026-09-22', close: 120 }])
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(stored.has(`finverse:history:v2:${quoteKey(first)}`)).toBe(true)
    expect(stored.has(`finverse:history:v2:${quoteKey(conflicting)}`)).toBe(true)
  })
})

function position(ticker: string): Position {
  return {
    id: ticker,
    ticker,
    name: ticker,
    type: 'stock',
    quantity: 1,
    buyPrice: 1,
    lastPrice: 1,
    invested: 1,
    exchange: 'NSE',
  }
}
