// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { investmentWorkspace } from '../investmentWorkspace'
import { loadSettings } from '../store'
import { MarketStories } from './MarketStories'
import { MarketStoriesEntry } from './MarketStoriesEntry'
import { PersonalStoryVisual } from './PersonalStoryVisual'
import type { Position } from '../types'
import type { MarketBriefingStory } from '../marketBriefing'
import type { MarketEvent, MarketEventsFeed } from '../marketEvents'
import { holdingIdentity } from '../monitor'

const state = vi.hoisted(() => ({ store: {} as Record<string, unknown>, history: vi.fn(), benchmarkHistory: vi.fn(), briefing: vi.fn(), events: vi.fn(), eventsRefresh: vi.fn(), eventFeed: { events: [], issues: [], fetchedAt: 0 } as MarketEventsFeed }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('../marketData', () => ({ BENCHMARKS: [{ id: 'nifty-50', label: 'NIFTY 50', symbol: '^NSEI' }, { id: 'sensex', label: 'Sensex', symbol: '^BSESN' }, { id: 'nifty-bank', label: 'NIFTY Bank', symbol: '^NSEBANK' }, { id: 'nifty-next-50', label: 'NIFTY Next 50', symbol: '^NSMIDCP' }, { id: 'nifty-midcap-50', label: 'NIFTY Midcap 50', symbol: '^NSEMDCP50' }], marketData: { history: state.history, benchmarkHistory: state.benchmarkHistory } }))
vi.mock('../marketBriefing', async (importOriginal) => ({ ...await importOriginal<typeof import('../marketBriefing')>(), loadMarketBriefing: state.briefing }))
vi.mock('../useMarketEvents', () => ({ useMarketEvents: state.events }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const positions: Position[] = [{ id: 'tcs', ticker: 'TCS', name: 'Tata Consultancy Services', type: 'stock', exchange: 'NSE', currency: 'INR', sector: 'Technology', quantity: 10, invested: 1000, buyPrice: 100, lastPrice: 120 }]
const bridgeTitle = 'Losses absorbed 34% of the lift.'
const sessionTitle = 'Wednesday made the biggest move.'
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const close = vi.fn()
const complete = vi.fn()
const navigate = vi.fn()

function insightFixture(period: 'weekly' | 'monthly' = 'monthly') {
  const holdings = ['TCS', 'INFY', 'ITC'].map((ticker, index): Position => ({ ...positions[0], id: ticker.toLowerCase(), ticker, name: ticker, sector: index === 2 ? 'Consumer goods' : 'Technology', quantity: 1, invested: 100, lastPrice: [111, 121, 89][index] }))
  const dates = period === 'weekly' ? ['2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
    : ['2026-09-30', ...[1, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 21, 22, 23, 26, 27, 28, 29, 30].map((day) => `2026-10-${String(day).padStart(2, '0')}`)]
  const closes = dates.map((_, index) => index < dates.length - 3 ? [100, 100, 100] : index === dates.length - 3 ? [110, 120, 90] : index === dates.length - 2 ? [110, 120, 89] : [111, 121, 89])
  state.store = { ...state.store, positions: holdings, settings: { ...loadSettings(), allowExternalData: true }, snapshot: investmentWorkspace.readSnapshot({ folios: [{ id: 'folio', name: 'Portfolio', importedAt: 1, positions: holdings }], quotes: {} }) }
  state.history.mockImplementation(async (holding: Position) => dates.map((date, index) => ({ date, close: closes[index][holdings.findIndex((item) => item.ticker === holding.ticker)] })))
  state.benchmarkHistory.mockResolvedValue(dates.map((date, index) => ({ date, close: index === dates.length - 1 ? 105 : 100 })))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  state.store = {
    positions, settings: { ...loadSettings(), allowExternalData: false, hideValues: false },
    snapshot: investmentWorkspace.readSnapshot({ folios: [{ id: 'folio', name: 'Portfolio', importedAt: 1, positions }], quotes: {} }),
  }
  state.history.mockResolvedValue([])
  state.benchmarkHistory.mockResolvedValue([])
  state.briefing.mockResolvedValue({ items: [], issues: [] })
  state.eventFeed = { events: [], issues: [], fetchedAt: 0 }
  const emptyEvents = state.eventFeed
  state.events.mockImplementation((_positions: Position[], allowed: boolean, masked: boolean) => ({ feed: allowed && !masked ? state.eventFeed : emptyEvents, loading: false, ready: true, refresh: state.eventsRefresh }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; this.querySelector<HTMLButtonElement>('[autofocus], [aria-label="Close highlights"]')?.focus() } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.open = false } },
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

async function render(edition = 'Portfolio', today?: string) {
  await act(async () => root.render(<MarketStories today={today} onClose={close} onComplete={complete} onNavigate={navigate} />))
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent === edition)
  if (tab?.getAttribute('aria-selected') !== 'true') await act(async () => tab?.click())
}
async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent === label)!
  expect(button).toBeDefined()
  await act(async () => button.click())
}

async function next() {
  await act(async () => container.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
}

describe('market highlights viewer', () => {
  it('marks actual holidays without turning missing trading observations into holidays or zero returns', () => {
    const markup = renderToStaticMarkup(<PersonalStoryVisual insight={{ kind: 'session', date: '2026-11-09', change: 109, changePct: 1.09, days: [{ date: '2026-11-09', changePct: 1.09 }, { date: '2026-11-11', changePct: .64 }, { date: '2026-11-13', changePct: -.52 }], leader: 'TCS', leaderChange: 109, covered: 1, total: 1 }} from="2026-11-09" through="2026-11-13" />)
    const chart = document.createElement('div')
    chart.innerHTML = markup
    expect(chart.querySelectorAll('.personal-session-holiday')).toHaveLength(1)
    expect(chart.textContent).toContain('2026-11-10: Holiday · Diwali-Balipratipada')
    expect(chart.textContent).toContain('2026-11-12: No price observation')
    expect(chart.querySelectorAll('.personal-session-bar')).toHaveLength(3)
  })

  it('hides both entry placements and skips preparation until holdings are imported', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    state.store = { ...state.store, positions: [], settings: { ...loadSettings(), allowExternalData: true }, snapshot: investmentWorkspace.readSnapshot({ folios: [], quotes: {} }) }
    const entry = () => <MarketStoriesEntry navigate={navigate}>{(button) => <><aside>{button}</aside><header>{button}</header><main>Portfolio workspace</main></>}</MarketStoriesEntry>
    await act(async () => root.render(entry()))
    expect(container.textContent).toBe('Portfolio workspace')
    expect(container.querySelector('.stories-entry')).toBeNull()
    expect(state.history).not.toHaveBeenCalled()
    expect(state.briefing).not.toHaveBeenCalled()
    expect(state.events.mock.calls.every(([, allowed]) => !allowed)).toBe(true)

    state.store.positions = positions
    await act(async () => root.render(entry()))
    expect(container.querySelectorAll('.stories-entry')).toHaveLength(2)
    await click('Open your portfolio and market highlights')
    await act(async () => vi.dynamicImportSettled())
    expect(container.querySelector('dialog')?.open).toBe(true)

    state.store.positions = []
    await act(async () => root.render(entry()))
    expect(container.querySelector('.stories-entry')).toBeNull()
    expect(container.querySelector('dialog')).toBeNull()
    expect(container.textContent).toBe('Portfolio workspace')
  })

  it('opens a clean empty portfolio without creating a weak or unpriced statistic story', async () => {
    await render('Portfolio', '2026-11-06')
    expect(container.querySelector('dialog')?.open).toBe(true)
    expect(container.textContent).toContain('Stories appear when the period has enough price history.')
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(0)
    expect(state.history).not.toHaveBeenCalled()
    await click('Close highlights')
    expect(complete).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('removes amounts, holding names, charts and market requests when privacy is enabled', async () => {
    await render()
    state.store.settings = { ...loadSettings(), hideValues: true, allowExternalData: true }
    await render()
    expect(container.textContent).toContain('Your highlights are private.')
    expect(container.textContent).not.toContain('Tata')
    expect(container.textContent).not.toContain('1,200')
    expect(container.querySelector('.story-art')).toBeNull()
    expect(container.querySelector('.story-metric')).toBeNull()
    expect(state.history).not.toHaveBeenCalled()
    expect(state.benchmarkHistory).not.toHaveBeenCalled()
  })

  it('renders gains-versus-losses and the notable session from complete period prices', async () => {
    insightFixture()
    await render('Portfolio', '2026-10-31')
    expect(state.history).toHaveBeenCalledWith(expect.objectContaining({ id: 'tcs' }), expect.any(Date), expect.any(Date), expect.any(AbortSignal))
    expect(state.benchmarkHistory).toHaveBeenCalledTimes(5)
    expect(container.textContent).toContain(bridgeTitle)
    expect(container.querySelector('.personal-story--bridge')).not.toBeNull()
    expect(container.querySelector('.story-metric, .story-rows')).toBeNull()
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(4)
    await next()
    expect(container.textContent).toContain(sessionTitle)
    expect(container.querySelector('.personal-session-day--selected')?.getAttribute('aria-label')).toContain('2026-10-28')
    expect(container.querySelector('.personal-session-result')?.textContent).toContain('+₹20')
  })

  it('pauses automatic progress and supports Escape and focus restoration', async () => {
    vi.useFakeTimers()
    insightFixture()
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    await render('Portfolio', '2026-10-31')
    expect(document.body.style.overflow).toBe('hidden')
    await click('Pause highlights')
    await act(async () => vi.advanceTimersByTime(20_000))
    expect(container.textContent).toContain(bridgeTitle)
    await click('Play highlights')
    await act(async () => vi.advanceTimersByTime(12_000))
    expect(container.textContent).toContain(sessionTitle)
    expect(close).not.toHaveBeenCalled()
    await act(async () => container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
    expect(close).toHaveBeenCalledOnce()
    await act(async () => root.render(null))
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).not.toBe('hidden')
    trigger.remove()
  })

  it('offers the existing import entry for an empty portfolio', async () => {
    state.store.positions = []
    state.store.snapshot = investmentWorkspace.readSnapshot({ folios: [], quotes: {} })
    await render()
    expect(container.textContent).toContain('Your story starts here.')
    expect(container.querySelector('.story-metric')).toBeNull()
    expect(state.history).not.toHaveBeenCalled()
    await click('Open portfolio ↗')
    expect(navigate).toHaveBeenCalledWith('overview')
  })

  it('keeps the selected story and loaded prices when closed and reopened', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T10:00:00Z'))
    insightFixture()
    await act(async () => root.render(<MarketStoriesEntry navigate={navigate} />))
    expect(state.history).not.toHaveBeenCalled()
    await click('Open your portfolio and market highlights')
    await act(async () => vi.dynamicImportSettled())
    expect(state.history).toHaveBeenCalledTimes(3)
    await click('Portfolio')
    await next()
    expect(container.textContent).toContain(sessionTitle)
    const requests = state.history.mock.calls.length
    await click('Close highlights')
    expect(container.querySelector('dialog')?.open).toBe(false)
    await click('Open your portfolio and market highlights')
    expect(container.querySelector('dialog')?.open).toBe(true)
    expect(container.querySelector('.story-content h2')?.textContent).toBe(sessionTitle)
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(4)
    expect(state.history).toHaveBeenCalledTimes(requests)
  })

  it('waits for highlights intent and shares one prepared history load across tabs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    insightFixture()
    state.briefing.mockImplementation(async ({ cadence }: { cadence: 'weekly' | 'monthly' }) => ({
      items: [{ id: `prepared-${cadence}`, title: `${cadence} markets digest`, source: 'Publisher', sourceUrl: `https://publisher.test/${cadence}`, publishedAt: Date.parse('2026-10-28T10:00:00Z'), topic: 'global', region: 'Global', coverage: 2, score: 10, matches: [] }], issues: [],
    }))
    await act(async () => root.render(<MarketStoriesEntry navigate={navigate} />))
    await act(async () => vi.dynamicImportSettled())
    expect(container.querySelector('dialog')).toBeNull()
    expect(state.history).not.toHaveBeenCalled()
    expect(state.benchmarkHistory).not.toHaveBeenCalled()
    expect(state.briefing).not.toHaveBeenCalled()
    await act(async () => container.querySelector('.stories-entry')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
    expect(state.history).toHaveBeenCalledTimes(3)
    expect(state.benchmarkHistory).toHaveBeenCalledTimes(5)
    expect(state.briefing).toHaveBeenCalledTimes(2)
    expect(state.briefing).toHaveBeenCalledWith(expect.objectContaining({ cadence: 'weekly', from: '2026-10-26', through: '2026-10-30' }))
    expect(state.briefing).toHaveBeenCalledWith(expect.objectContaining({ cadence: 'monthly', from: '2026-10-01', through: '2026-10-31' }))
    expect(state.events).toHaveBeenCalledWith(expect.any(Array), true, false)
    const requests = state.history.mock.calls.length
    await click('Open your portfolio and market highlights')
    expect(container.querySelector('.story-content h2')?.textContent).toBe(bridgeTitle)
    expect(container.querySelector('.story-empty')).toBeNull()
    await click('Weekly')
    expect(container.querySelector('.story-content h2')?.textContent).toBe('weekly markets digest')
    expect(container.querySelector('.story-empty')).toBeNull()
    await click('Monthly')
    expect(container.querySelector('.story-content h2')?.textContent).toBe('monthly markets digest')
    expect(container.querySelector('.story-empty')).toBeNull()
    expect(state.history).toHaveBeenCalledTimes(requests)
    expect(state.benchmarkHistory).toHaveBeenCalledTimes(5)
    expect(state.briefing).toHaveBeenCalledTimes(2)
  })

  it.each([
    { allowExternalData: false, hideValues: false, newsRequests: 0 },
    { allowExternalData: true, hideValues: true, newsRequests: 2 },
  ])('respects external-data=$allowExternalData and privacy=$hideValues while preparing highlights', async ({ allowExternalData, hideValues, newsRequests }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    state.store.settings = { ...loadSettings(), allowExternalData, hideValues }
    await act(async () => root.render(<MarketStoriesEntry navigate={navigate} />))
    expect(state.history).not.toHaveBeenCalled()
    expect(state.benchmarkHistory).not.toHaveBeenCalled()
    expect(state.briefing).not.toHaveBeenCalled()
    expect(state.events.mock.calls.every(([, allowed, masked]) => !allowed || masked)).toBe(true)
    await click('Open your portfolio and market highlights')
    await act(async () => vi.dynamicImportSettled())
    expect(state.briefing).toHaveBeenCalledTimes(newsRequests)
    expect(container.querySelector('.personal-story, .story-metric, .story-rows')).toBeNull()
    expect(state.history).not.toHaveBeenCalled()
  })

  it('renews the unread halo after midnight in India without reloading', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-06T18:29:59Z'))
    state.store.settings = { ...loadSettings(), allowExternalData: true }
    localStorage.setItem('finverse:highlights-seen:v1', '2026-11-06')
    await act(async () => root.render(<MarketStoriesEntry navigate={navigate} />))
    expect(container.querySelector('.stories-entry--seen')).not.toBeNull()
    await act(async () => vi.advanceTimersByTime(2000))
    expect(container.querySelector('.stories-entry--seen')).toBeNull()
    expect(container.querySelector('[aria-label="Unread highlights"]')).not.toBeNull()
  })

  it('keeps failures retryable without displaying an invented personal insight', async () => {
    state.history.mockRejectedValue(new Error('Unavailable'))
    state.benchmarkHistory.mockRejectedValue(new Error('Unavailable'))
    state.store.settings = { ...loadSettings(), allowExternalData: true, hideValues: false }
    await render('Portfolio', '2026-11-06')
    expect(container.textContent).toContain('Try loading the missing prices again.')
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(0)
    expect(container.querySelector('.personal-story, .story-metric')).toBeNull()
    await click('Retry')
    expect(state.history).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.personal-story')).toBeNull()
  })

  it('offers touch continuation alongside Retry when Portfolio prices fail', async () => {
    state.history.mockRejectedValue(new Error('Unavailable'))
    state.benchmarkHistory.mockRejectedValue(new Error('Unavailable'))
    state.store.settings = { ...loadSettings(), allowExternalData: true, hideValues: false }
    await render('Portfolio', '2026-11-01')
    expect(container.querySelector('.story-empty-actions')?.textContent).toContain('Retry')
    await click('Continue to Weekly →')
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Weekly')
    expect(close).not.toHaveBeenCalled()
  })

  it('keeps weekly news attributed without borrowing monthly performer placeholders when prices are missing', async () => {
    state.store.settings = { ...loadSettings(), allowExternalData: true }
    const items: MarketBriefingStory[] = Array.from({ length: 8 }, (_, index) => ({
      id: `article-${index}`, title: index === 0 ? 'RBI raises repo rate after monetary policy meeting' : `China stock markets respond to economic stimulus ${index}`,
      source: 'News publisher', sourceUrl: `https://publisher.test/news/${index}`, publishedAt: Date.parse('2026-11-06T09:00:00Z'),
      topic: index === 0 ? 'policy' : 'china', region: index === 0 ? 'India' : 'China', coverage: 3, score: 10, matches: [],
    }))
    state.briefing.mockResolvedValue({ items, issues: [] })
    await render('Weekly', '2026-11-07')
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(4)
    expect(container.textContent).toContain('RBI raises repo rate')
    expect(container.querySelector<HTMLAnchorElement>('.story-content h2 a')?.href).toBe(items[0].sourceUrl)
    expect(container.textContent).toContain('3 publishers')
    await next()
    expect(container.textContent).toContain('China stock markets')
    expect(container.querySelector('.story-news-art')).not.toBeNull()
  })

  it.each([
    { edition: 'Weekly', today: '2026-11-07', closing: '2026-11-06', count: 6 },
    { edition: 'Monthly', today: '2026-11-01', closing: '2026-10-30', count: 7 },
  ])('places news before portfolio data within the seven-story $edition limit', async ({ edition, today, closing, count }) => {
    insightFixture(edition === 'Weekly' ? 'weekly' : 'monthly')
    state.briefing.mockResolvedValue({ items: Array.from({ length: 12 }, (_, index) => ({ id: `recap-${index}`, title: `Global stock markets respond to policy announcement ${index}`, source: 'Publisher', sourceUrl: `https://publisher.test/${index}`, publishedAt: Date.parse(`${closing}T10:00:00Z`), topic: 'global', region: 'Global', coverage: 1, score: 0, matches: [] })), issues: [] })
    await render(edition, today)
    const progress = [...container.querySelectorAll<HTMLButtonElement>('.story-progress button')]
    expect(progress).toHaveLength(count)
    expect(container.querySelector('.story-content h2')?.textContent).toBe('Global stock markets respond to policy announcement 0')
    const titles = edition === 'Weekly' ? [sessionTitle, 'Technology led the week.', "You're covered."] : [bridgeTitle, 'Your top performers.', 'Your worst performers.', "You're covered."]
    for (const [index, title] of titles.entries()) {
      await act(async () => progress[index + 3].click())
      expect(container.querySelector('.story-content h2')?.textContent).toBe(title)
      if (index === 0) expect(container.querySelector('.story-metric, .story-rows')).toBeNull()
    }
  })

  it('keeps monthly news chronological without miniature titles above the personal insight', async () => {
    insightFixture()
    state.briefing.mockResolvedValue({ items: [29, 22, 15, 8, 1].map((day) => ({
      id: `day-${day}`, title: `Global stocks respond to economic release ${day}`, source: 'Publisher', sourceUrl: `https://publisher.test/${day}`,
      publishedAt: Date.parse(`2026-10-${String(day).padStart(2, '0')}T10:00:00Z`), topic: 'global', region: 'Global', coverage: 1, score: day === 1 || day === 29 ? 100 : 1, matches: [],
    })), issues: [] })
    await render('Monthly', '2026-11-01')
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(7)
    expect(container.querySelector('.story-content h2')?.textContent).toBe('Global stocks respond to economic release 1')
    await next()
    expect(container.querySelector('.story-content h2')?.textContent).toBe('Global stocks respond to economic release 15')
    await next()
    expect(container.querySelector('.story-content h2')?.textContent).toBe('Global stocks respond to economic release 29')
    await next()
    expect(container.querySelector('.story-content h2')?.textContent).toBe(bridgeTitle)
  })

  it('offers independent weekly and monthly editions only in their calendar windows', async () => {
    state.store.settings = { ...loadSettings(), allowExternalData: true }
    await render('Portfolio', '2026-11-01')
    expect(state.briefing).not.toHaveBeenCalled()
    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(['Portfolio', 'Weekly', 'Monthly'])
    await click('Monthly')
    expect(state.briefing).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-01', through: '2026-10-31', ranking: 'recap', cadence: 'monthly' }))
    expect(state.history).toHaveBeenLastCalledWith(expect.anything(), new Date('2026-09-23T00:00:00Z'), new Date('2026-10-31T23:59:59Z'), expect.any(AbortSignal))
    await click('Weekly')
    expect(state.briefing).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-26', through: '2026-10-30', ranking: 'recap', cadence: 'weekly' }))
    await render('Portfolio', '2026-11-02')
    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(['Portfolio'])
  })

  it('keeps public recap news available under privacy without personalizing it', async () => {
    state.store.settings = { ...loadSettings(), allowExternalData: true, hideValues: true }
    state.briefing.mockResolvedValue({ items: [{ id: 'public', title: 'Global stock markets fall as central banks raise rates', source: 'Publisher', sourceUrl: 'https://publisher.test/markets', publishedAt: Date.parse('2026-11-06T10:00:00Z'), topic: 'global', region: 'Global', coverage: 2, score: 10, matches: [] }], issues: [] })
    await render('Weekly', '2026-11-07')
    expect(state.briefing).toHaveBeenLastCalledWith(expect.objectContaining({ positions: [] }))
    expect(container.textContent).toContain('Global stock markets fall')
    expect(container.textContent).not.toContain('Tata')
    expect(container.querySelector('.story-metric')).toBeNull()
    expect(state.history).not.toHaveBeenCalled()
    await click('Portfolio')
    expect(container.textContent).toContain('Your highlights are private.')
    expect(container.querySelector('.story-news-art')).toBeNull()
  })

  it('shows confirmed next-week NSE events only in Weekly and keeps them private when masked', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-07T10:00:00Z'))
    insightFixture('weekly')
    const holding = (state.store.positions as Position[])[0]
    const event: MarketEvent = {
      id: 'tcs-results', symbol: holding.ticker, holdingId: holding.id, holdingName: holding.name, instrumentIdentity: holdingIdentity(holding),
      kind: 'results', date: '2026-11-12', dateLabel: 'Meeting date', title: 'Board meeting to consider quarterly results',
      source: 'NSE', sourceUrl: 'https://nsearchives.nseindia.com/corporate/TCS_results.pdf',
    }
    state.eventFeed = { events: [event], issues: [], fetchedAt: Date.now() }
    state.briefing.mockResolvedValue({ items: Array.from({ length: 8 }, (_, index) => ({
      id: `weekly-news-${index}`, title: `Global stocks respond to market release ${index}`, source: 'Publisher', sourceUrl: `https://publisher.test/weekly/${index}`,
      publishedAt: Date.parse('2026-11-06T10:00:00Z'), topic: 'global', region: 'Global', coverage: 1, score: 8 - index, matches: [],
    })), issues: [] })
    await render('Weekly', '2026-11-07')
    expect(state.events).toHaveBeenLastCalledWith(expect.any(Array), true, false)
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(7)
    const marker = [...container.querySelectorAll<HTMLButtonElement>('.story-progress button')].find((button) => button.getAttribute('aria-label')?.endsWith('Confirmed company events'))!
    expect(marker).toBeDefined()
    await act(async () => marker.click())
    expect(container.querySelector('.story-content h2')?.textContent).toBe('Next week, on your radar.')
    expect(container.querySelector<HTMLAnchorElement>('.weekly-story--events a')?.href).toBe(event.sourceUrl)
    expect(container.textContent).toContain('Results · Meeting date')
    expect(container.querySelector('.story-metric, .story-rows')).toBeNull()
    await render('Monthly', '2026-11-01')
    expect(state.events).toHaveBeenLastCalledWith(expect.any(Array), false, false)
    expect(container.querySelector('.weekly-story--events')).toBeNull()
    state.store.settings = { ...loadSettings(), allowExternalData: true, hideValues: true }
    await render('Weekly', '2026-11-07')
    expect(state.events).toHaveBeenLastCalledWith(expect.any(Array), true, true)
    expect(container.querySelector('.weekly-story--events')).toBeNull()
    expect(container.textContent).not.toContain(event.symbol)
  })

  it('retries a failed event feed without discarding available Weekly session and sector stories', async () => {
    insightFixture('weekly')
    state.eventFeed = { events: [], issues: [{ source: 'NSE', message: 'Company dates are unavailable.' }], fetchedAt: 0, sourceFailed: true }
    await render('Weekly', '2026-11-07')
    expect(container.querySelector('.story-content h2')?.textContent).toBe(sessionTitle)
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(3)
    const requests = state.history.mock.calls.length
    await click('Retry highlights')
    expect(state.eventsRefresh).toHaveBeenCalledOnce()
    expect(state.history).toHaveBeenCalledTimes(requests)
  })

  it('preserves recap position and cached prices when switching editions', async () => {
    state.store.settings = { ...loadSettings(), allowExternalData: true }
    const item = { title: 'China stocks fall after central bank policy decision', source: 'Publisher', sourceUrl: 'https://publisher.test/a', publishedAt: Date.parse('2026-11-06T10:00:00Z'), topic: 'china', region: 'China', coverage: 1, score: 10, matches: [] }
    state.briefing.mockResolvedValue({ items: [{ ...item, id: 'one' }, { ...item, id: 'two', sourceUrl: 'https://publisher.test/b', title: 'Global stock markets rally after jobs report' }], issues: [] })
    await render('Weekly', '2026-11-07')
    await next()
    await click('Portfolio')
    const requests = state.history.mock.calls.length
    await click('Weekly')
    expect(container.querySelector('.story-content h2')?.textContent).toBe('Global stock markets rally after jobs report')
    await click('Portfolio')
    expect(state.history).toHaveBeenCalledTimes(requests)
    expect(state.briefing).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed weekly edition retryable without manufacturing recap content', async () => {
    state.store.settings = { ...loadSettings(), allowExternalData: true }
    state.briefing.mockResolvedValue({ items: [], issues: ['News is unavailable.'] })
    await render('Weekly', '2026-11-07')
    expect(container.textContent).toContain('This edition is unavailable.')
    expect(container.querySelector('.story-metric, .personal-story, .weekly-story')).toBeNull()
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(0)
    await click('Retry')
    expect(state.briefing).toHaveBeenCalledTimes(2)
    expect(state.briefing).toHaveBeenLastCalledWith(expect.objectContaining({ forceRefresh: true }))
    await click('Portfolio')
    expect(container.querySelector('.personal-story')).toBeNull()
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(0)
  })
})

describe('highlight edition continuation', () => {
  it.each(['news', 'prices'])('waits for the complete Monthly edition when %s arrives first', async (first) => {
    insightFixture()
    await render('Weekly', '2026-11-01')
    let finishPrices!: (points: { date: string; close: number }[]) => void
    let finishNews!: (result: { items: MarketBriefingStory[]; issues: string[] }) => void
    state.history.mockReturnValue(new Promise((resolve) => { finishPrices = resolve }))
    state.briefing.mockReturnValue(new Promise((resolve) => { finishNews = resolve }))
    const article: MarketBriefingStory = { id: 'monthly-first', title: 'Global markets respond to October earnings', source: 'Publisher', sourceUrl: 'https://publisher.test/october', publishedAt: Date.parse('2026-10-26T10:00:00Z'), topic: 'global', region: 'Global', coverage: 2, score: 10, matches: [] }
    const prices = [{ date: '2026-09-30', close: 100 }, { date: '2026-10-30', close: 108 }]
    await click('Monthly')
    expect(container.querySelector('.story-content')).toBeNull()
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(0)
    expect(container.querySelector('.story-empty')?.getAttribute('aria-busy')).toBe('true')
    await act(async () => { if (first === 'news') finishNews({ items: [article], issues: [] }); else finishPrices(prices) })
    expect(container.querySelector('.story-content')).toBeNull()
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(0)
    await act(async () => { if (first === 'news') finishPrices(prices); else finishNews({ items: [article], issues: [] }) })
    expect(container.querySelector('.story-content h2')?.textContent).toBe(article.title)
    expect(container.querySelector('.story-progress button')?.getAttribute('aria-current')).toBe('step')
    await click('Weekly')
    await click('Monthly')
    expect(container.querySelector('.story-content h2')?.textContent).toBe(article.title)
    expect(container.querySelector('.story-empty')).toBeNull()
  })

  async function lastStory() {
    const markers = container.querySelectorAll<HTMLButtonElement>('.story-progress button')
    expect(markers.length).toBeGreaterThan(0)
    await act(async () => markers[markers.length - 1].click())
  }

  function selectedEdition() {
    return container.querySelector('[role="tab"][aria-selected="true"]')?.textContent
  }

  it('continues Portfolio to Weekly to Monthly and restarts a previously visited edition', async () => {
    insightFixture()
    await render('Weekly', '2026-11-01')
    await lastStory()
    await click('Portfolio')
    expect(container.querySelector('.story-content h2')?.textContent).toBe(bridgeTitle)
    expect(container.querySelector('.story-header > div > span')?.textContent).toBe('October 2026')
    await lastStory()
    await next()
    expect(selectedEdition()).toBe('Weekly')
    expect(container.querySelector('.story-progress button')?.getAttribute('aria-current')).toBe('step')
    expect(complete).toHaveBeenCalledWith('portfolio:2026-11')
    expect(close).not.toHaveBeenCalled()
    await lastStory()
    await next()
    expect(selectedEdition()).toBe('Monthly')
    expect(complete).toHaveBeenCalledWith('weekly:2026-10-26')
    expect(close).not.toHaveBeenCalled()
    await lastStory()
    await next()
    expect(complete).toHaveBeenCalledWith('monthly:2026-10')
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([
    { today: '2026-11-07', following: 'Weekly' },
    { today: '2026-12-01', following: 'Monthly' },
  ])('continues directly to the available $following edition', async ({ today, following }) => {
    insightFixture('weekly')
    if (following === 'Monthly') {
      state.history.mockResolvedValue([{ date: '2026-11-30', close: 100 }])
      state.benchmarkHistory.mockResolvedValue([{ date: '2026-11-30', close: 100 }])
    }
    await render('Portfolio', today)
    if (following === 'Weekly') await lastStory()
    else expect(container.querySelectorAll('.story-progress button')).toHaveLength(0)
    await next()
    expect(selectedEdition()).toBe(following)
    expect(close).not.toHaveBeenCalled()
    await lastStory()
    await next()
    expect(close).toHaveBeenCalledOnce()
  })

  it('stays on an empty edition while its period history is still loading', async () => {
    let finish!: (points: { date: string; close: number }[]) => void
    const pending = new Promise<{ date: string; close: number }[]>((resolve) => { finish = resolve })
    state.history.mockReturnValue(pending)
    state.store.settings = { ...loadSettings(), allowExternalData: true }
    await render('Portfolio', '2026-11-01')
    expect(container.querySelectorAll('.story-progress button')).toHaveLength(0)
    expect(container.querySelector('.story-empty')?.getAttribute('aria-busy')).toBe('true')
    await next()
    expect(selectedEdition()).toBe('Portfolio')
    expect(close).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    await act(async () => finish([]))
  })

  it('continues to the next edition when the final story timer completes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-07T10:00:00Z'))
    insightFixture('weekly')
    await render('Portfolio', '2026-11-07')
    await lastStory()
    await act(async () => vi.advanceTimersByTime(12_000))
    expect(selectedEdition()).toBe('Weekly')
    expect(close).not.toHaveBeenCalled()
  })
})
