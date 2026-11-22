import { describe, expect, it, vi } from 'vitest'
import { createEconomicCalendarHandler } from '../api/economicCalendar'
import { parseForexFactory, SCHEDULED_EVENTS, upcomingEconomicEvents } from './economicCalendarProtocol'

const feedRow = (overrides: Record<string, unknown> = {}) => ({ title: 'Core PCE Price Index m/m', country: 'USD', date: '2026-11-25T08:30:00-05:00', impact: 'High', forecast: '0.3%', previous: '0.3%', ...overrides })

describe('economic calendar feed', () => {
  it('keeps high-impact releases for major economies and drops the rest', () => {
    const events = parseForexFactory([feedRow(), feedRow({ impact: 'Medium' }), feedRow({ country: 'NZD' }), feedRow({ impact: 'Holiday' }), feedRow({ date: 'soon' }), feedRow({ title: '' })])
    expect(events).toEqual([{ id: 'ff:US:2026-11-25T13:30:00.000Z:Core PCE Price Index m/m', title: 'Core PCE Price Index m/m', region: 'US', at: '2026-11-25T13:30:00.000Z', allDay: false, forecast: '0.3%', previous: '0.3%', source: 'Forex Factory', sourceUrl: 'https://www.forexfactory.com/calendar' }])
    expect(() => parseForexFactory({})).toThrow()
  })

  it('merges the official RBI, MoSPI and Fed schedule in IST order and keeps one Fed decision per day', () => {
    const now = Date.parse('2026-11-22T06:00:00Z')
    const feedFed = parseForexFactory([feedRow({ title: 'Federal Funds Rate', date: '2026-12-09T14:00:00-05:00' })])
    const events = upcomingEconomicEvents([...parseForexFactory([feedRow()]), ...feedFed], now, 21)
    expect(events.map((event) => event.title)).toEqual([
      'Core PCE Price Index m/m', 'India IIP (industrial production)', 'India GDP, Q2 FY 2026-27', 'RBI monetary policy decision',
      'Fed interest rate decision (FOMC)', 'India CPI inflation',
    ])
    expect(events.find((event) => event.title.startsWith('Fed'))?.source).toBe('Federal Reserve')
  })

  it('excludes events before today in IST and keeps every scheduled entry sourced', () => {
    expect(upcomingEconomicEvents([], Date.parse('2026-11-29T00:00:00Z')).some((event) => event.title.includes('IIP') && event.at.startsWith('2026-11-28'))).toBe(false)
    expect(SCHEDULED_EVENTS.every((event) => /^https:\/\/(www\.)?(rbi\.org\.in|mospi\.gov\.in|federalreserve\.gov)\//.test(event.sourceUrl))).toBe(true)
  })
})

describe('economic calendar API', () => {
  it('serves the parsed weekly feed with a shared cache and rejects parameters', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json([feedRow(), feedRow({ impact: 'Low' })]))
    const handle = createEconomicCalendarHandler({ fetcher, now: () => Date.parse('2026-11-22T06:00:00Z') })
    const response = await handle(new Request('https://example.com/api/economicCalendar'))
    expect(response.status).toBe(200)
    expect(response.headers.get('vercel-cdn-cache-control')).toContain('s-maxage=3600')
    expect((await response.json()).events).toHaveLength(1)
    await handle(new Request('https://example.com/api/economicCalendar'))
    expect(fetcher).toHaveBeenCalledOnce()
    expect((await handle(new Request('https://example.com/api/economicCalendar?week=next'))).status).toBe(400)
  })

  it('fails closed when the provider is unavailable', async () => {
    const handle = createEconomicCalendarHandler({ fetcher: vi.fn(async () => new Response('', { status: 503 })) })
    expect((await handle(new Request('https://example.com/api/economicCalendar'))).status).toBe(502)
  })
})
