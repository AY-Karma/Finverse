import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEventsHandler } from '../api/events'

const NOW = Date.parse('2026-10-27T12:00:00Z')
const calendar = [{ symbol: 'INFY', purpose: 'Financial Results/Dividend', date: '28-Oct-2026' }, { symbol: 'OTHER', purpose: 'Financial Results', date: '28-Oct-2026' }]
const actions = [{ symbol: 'INFY', isin: 'INE009A01021', subject: 'Interim Dividend - Rs 10 Per Share', exDate: '29-Oct-2026', recDate: '30-Oct-2026', series: 'EQ' }]
const filings = [{ symbol: 'INFY', sm_isin: 'INE009A01021', desc: 'Investor Presentation', an_dt: '26-Oct-2026 17:30:00', seq_id: '123', attchmntFile: 'https://nsearchives.nseindia.com/corporate/INFY.pdf' }]
const equityMaster = 'SYMBOL,NAME OF COMPANY, SERIES,ISIN NUMBER\nINFY,Infosys,EQ,INE009A01021\nOTHER,Other Company,EQ,INE000A01010\n'
const request = (query = 'INFY') => new Request(`http://localhost/api/events?symbols=${query}`)
function provider(rows = { calendar, actions, filings }, master = equityMaster) {
  return vi.fn<typeof fetch>(async (url) => url.toString().endsWith('/EQUITY_L.csv') ? new Response(master) : Response.json(url.toString().includes('event-calendar') ? rows.calendar : url.toString().includes('corporateActions') ? rows.actions : rows.filings))
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('company events API', () => {
  it('verifies filing issuers against the current equity reference without changing original security IDs', async () => {
    const fetcher = provider({ calendar: [], actions: [{ ...actions[0], symbol: 'HAVELLS', isin: 'INE176B01018' }], filings: [{ ...filings[0], symbol: 'HAVELLS', sm_isin: 'INE176B01018' }] }, 'SYMBOL,NAME OF COMPANY,SERIES,ISIN NUMBER\nHAVELLS,Havells India Limited,EQ,INE176B01034\n')
    const feed = await (await createEventsHandler({ fetcher, now: () => NOW })(request('HAVELLS'))).json()
    expect(feed.events.find((event: { kind: string }) => event.kind === 'filing')).toMatchObject({ isin: 'INE176B01018', issuerIsin: 'INE176B01034' })
    expect(feed.events.find((event: { kind: string }) => event.kind === 'dividend')).not.toHaveProperty('issuerIsin')
    expect(feed.issues).toEqual([])
  })

  it('keeps meeting dates, ex-dates and publication times distinct and filters symbols', async () => {
    const fetcher = provider()
    const response = await createEventsHandler({ fetcher, now: () => NOW })(request())
    const feed = await response.json()
    expect(response.status).toBe(200)
    expect(feed.issues).toEqual([])
    expect(feed.events).toHaveLength(3)
    expect(feed.events.find((event: { kind: string }) => event.kind === 'results')).toMatchObject({ date: '2026-10-28', dateLabel: 'Meeting date' })
    expect(feed.events.find((event: { kind: string }) => event.kind === 'dividend')).toMatchObject({ date: '2026-10-29', dateLabel: 'Ex-date' })
    expect(feed.events.find((event: { kind: string }) => event.kind === 'filing')).toMatchObject({ date: '2026-10-26', dateLabel: 'Published', publishedAt: Date.parse('2026-10-26T12:00:00Z'), sourceUrl: filings[0].attchmntFile })
    expect(fetcher.mock.calls.map(([url]) => url.toString())).toEqual(expect.arrayContaining(['https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv']))
    expect(fetcher.mock.calls.every(([url]) => url.toString().startsWith('https://www.nseindia.com/api/') || url.toString() === 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv')).toBe(true)
    expect(fetcher.mock.calls.find(([url]) => url.toString().includes('corporate-announcements'))?.[0].toString()).toContain('from_date=20-10-2026&to_date=27-10-2026')
  })

  it('shares upstream caches across different requested company sets', async () => {
    const fetcher = provider()
    const handler = createEventsHandler({ fetcher, now: () => NOW })
    await handler(request())
    const second = await (await handler(request('OTHER'))).json()
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(fetcher.mock.calls.filter(([url]) => url.toString().endsWith('/EQUITY_L.csv'))).toHaveLength(1)
    expect(second.events).toHaveLength(1)
    expect(second.events[0].symbol).toBe('OTHER')
  })

  it('retries a recovered source for the same symbols while keeping healthy sources cached', async () => {
    let time = NOW, available = false
    const normal = provider()
    const fetcher = vi.fn<typeof fetch>(async (url, options) => url.toString().includes('corporateActions') && !available
      ? new Response('Unavailable', { status: 503 }) : normal(url, options))
    const handler = createEventsHandler({ fetcher, now: () => time })
    const firstResponse = await handler(request())
    const first = await firstResponse.json()
    expect(firstResponse.status).toBe(200)
    expect(first.events).toHaveLength(2)
    expect(first.issues).toEqual([expect.objectContaining({ source: 'NSE corporate actions' })])
    await handler(request())
    expect(fetcher).toHaveBeenCalledTimes(4)

    available = true; time += 20_000
    const recoveredResponse = await handler(request())
    const recovered = await recoveredResponse.json()
    expect(recoveredResponse.status).toBe(200)
    expect(recovered.events).toHaveLength(3)
    expect(recovered.issues).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(fetcher.mock.calls.filter(([url]) => url.toString().includes('corporateActions'))).toHaveLength(2)
  })

  it('reads reordered, spaced and quoted CSV columns with BOM and escaped company names', async () => {
    const master = '\uFEFF"NAME OF COMPANY", "ISIN NUMBER", SERIES, SYMBOL\r\n"Infosys, ""India"" Limited",INE009A01021, BE,INFY\r\n'
    const feed = await (await createEventsHandler({ fetcher: provider({ calendar, actions, filings }, master), now: () => NOW })(request())).json()
    expect(feed.events.find((event: { kind: string }) => event.kind === 'filing')).toMatchObject({ symbol: 'INFY', issuerIsin: 'INE009A01021' })
    expect(feed.issues).toEqual([])
  })

  it('does not guess between conflicting equity reference rows or use a non-equity series', async () => {
    const master = 'SYMBOL,NAME OF COMPANY,SERIES,ISIN NUMBER\nINFY,Infosys,EQ,INE009A01021\nINFY,Other Security,BE,INE000A01010\nINFY,Debt Security,N0,INE111A01010\n'
    const feed = await (await createEventsHandler({ fetcher: provider({ calendar, actions, filings }, master), now: () => NOW })(request())).json()
    expect(feed.events.find((event: { kind: string }) => event.kind === 'filing')).not.toHaveProperty('issuerIsin')
    expect(feed.issues).toEqual([expect.objectContaining({ source: 'NSE issuer reference', message: expect.stringContaining('INFY') })])
  })

  it('never attaches another symbol or debt-only identity to an unmatched filing issuer', async () => {
    const master = 'SYMBOL,NAME OF COMPANY,SERIES,ISIN NUMBER\nOTHER,Other Company,EQ,INE009A01021\nINFY,Infosys debt,N0,INE000A01010\n'
    const feed = await (await createEventsHandler({ fetcher: provider({ calendar, actions, filings }, master), now: () => NOW })(request())).json()
    expect(feed.events.find((event: { kind: string }) => event.kind === 'filing')).toMatchObject({ isin: 'INE009A01021' })
    expect(feed.events.find((event: { kind: string }) => event.kind === 'filing')).not.toHaveProperty('issuerIsin')
    expect(feed.issues[0].message).toContain('Some filings may be withheld')
  })

  it.each(['SYMBOL,SERIES\nINFY,EQ\n', 'SYMBOL,SERIES,ISIN NUMBER\nINFY,EQ,"INE009A01021', 'SYMBOL,SERIES,ISIN NUMBER\nINFY,EQ,INE009A01021,unexpected\n'])('retains original filing IDs and reports invalid reference CSV', async (master) => {
    const response = await createEventsHandler({ fetcher: provider({ calendar, actions, filings }, master), now: () => NOW })(request())
    const feed = await response.json()
    expect(response.status).toBe(200)
    expect(feed.events).toHaveLength(3)
    expect(feed.events.find((event: { kind: string }) => event.kind === 'filing')).toMatchObject({ isin: 'INE009A01021' })
    expect(feed.events.find((event: { kind: string }) => event.kind === 'filing')).not.toHaveProperty('issuerIsin')
    expect(feed.issues[0].message).toContain('equity reference is unavailable')
  })

  it('shares a failed reference cache briefly and verifies issuers after the reference recovers', async () => {
    let time = NOW, available = false, referenceCalls = 0
    const normal = provider()
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      if (url.toString().endsWith('/EQUITY_L.csv')) {
        referenceCalls += 1
        if (!available) return new Response('Unavailable', { status: 503 })
      }
      return normal(url, options)
    })
    const handler = createEventsHandler({ fetcher, now: () => time })
    const first = await (await handler(request())).json()
    expect(first.issues[0].source).toBe('NSE issuer reference')
    expect(first.events).toHaveLength(3)
    await handler(request('OTHER'))
    expect(referenceCalls).toBe(1)
    available = true; time += 16_000
    const recovered = await (await handler(request())).json()
    expect(referenceCalls).toBe(2)
    expect(recovered.events.find((event: { kind: string }) => event.kind === 'filing')).toHaveProperty('issuerIsin', 'INE009A01021')
    expect(recovered.issues).toEqual([])
  })

  it('times out the issuer reference without losing available events or original filing IDs', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds)
      return controller.signal
    })
    const normal = provider()
    const fetcher = vi.fn<typeof fetch>((url, options) => url.toString().endsWith('/EQUITY_L.csv')
      ? new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }) })
      : normal(url, options))
    const pending = createEventsHandler({ fetcher, now: () => NOW })(request())
    await vi.advanceTimersByTimeAsync(4_001)
    const response = await pending
    const feed = await response.json()
    expect(response.status).toBe(200)
    expect(feed.events).toHaveLength(3)
    expect(feed.events.find((event: { kind: string }) => event.kind === 'filing')).toHaveProperty('isin', 'INE009A01021')
    expect(feed.events.find((event: { kind: string }) => event.kind === 'filing')).not.toHaveProperty('issuerIsin')
    expect(feed.issues[0].source).toBe('NSE issuer reference')
    expect(fetcher.mock.calls.find(([url]) => url.toString().endsWith('/EQUITY_L.csv'))?.[1]?.signal?.aborted).toBe(true)
  })

  it.each(['', 'INFY/../../private', 'https://example.com', Array.from({ length: 26 }, () => 'INFY').join(',')])('rejects unsupported symbol requests: %s', async (symbols) => {
    const fetcher = provider()
    const response = await createEventsHandler({ fetcher })(request(symbols))
    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects arbitrary source parameters and non-GET methods', async () => {
    const handler = createEventsHandler({ fetcher: provider() })
    expect((await handler(new Request('http://localhost/api/events?symbols=INFY&url=https://example.com'))).status).toBe(400)
    expect((await handler(new Request('http://localhost/api/events?symbols=INFY', { method: 'POST' }))).status).toBe(405)
  })

  it('keeps available sources when a provider response changes shape', async () => {
    const fetcher = provider()
    fetcher.mockImplementationOnce(async () => Response.json({ error: 'Unrecognized provider response' }))
    const response = await createEventsHandler({ fetcher, now: () => NOW })(request())
    const feed = await response.json()
    expect(response.status).toBe(200)
    expect(feed.events).toHaveLength(2)
    expect(feed.issues).toEqual([expect.objectContaining({ source: 'NSE meetings', message: expect.stringContaining('unavailable') })])
  })

  it('reports total provider failure rather than a successful empty feed', async () => {
    const response = await createEventsHandler({ fetcher: vi.fn(async () => new Response('Unavailable', { status: 403 })), now: () => NOW })(request())
    expect(response.status).toBe(502)
    expect((await response.json()).issues).toHaveLength(3)
  })

  it('times out a stalled source while retaining the other sources', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds)
      return controller.signal
    })
    const fetcher = provider()
    fetcher.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    }))
    const pending = createEventsHandler({ fetcher, now: () => NOW })(request())
    await vi.advanceTimersByTimeAsync(4_001)
    const response = await pending
    expect(response.status).toBe(200)
    const feed = await response.json()
    expect(feed.events).toHaveLength(2)
    expect(feed.issues[0].source).toBe('NSE meetings')
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('rejects oversized upstream bodies before parsing them', async () => {
    const response = await createEventsHandler({ fetcher: vi.fn(async () => new Response('[]', { headers: { 'content-length': String(7 * 1024 * 1024) } })), now: () => NOW })(request())
    expect(response.status).toBe(502)
  })

  it('omits unsafe documents, invalid dates and records outside the declared range', async () => {
    const fetcher = provider({ calendar: [{ ...calendar[0], date: '31-Feb-2026' }], actions: [{ ...actions[0], exDate: '01-Jan-2026' }], filings: [{ ...filings[0], attchmntFile: 'https://nsearchives.nseindia.com.attacker.example/INFY.pdf' }] })
    const response = await createEventsHandler({ fetcher, now: () => NOW })(request())
    expect((await response.json()).events).toEqual([])
  })
})
