// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMarketFeed, type LoadedMarketFeed, type NewsItem } from '../marketNews'
import { holdingIdentity } from '../monitor'
import { emptyMonitorReadingState, newsReadingKey, updateArticleReading } from '../monitorReading'
import * as readingOperations from '../monitorReading'
import * as headlineTone from '../headlineTone'
import type { Position } from '../types'
import type { useStore } from '../useStore'
import { MonitorNewsPanel } from './MonitorNewsPanel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore> }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('../marketNews', async (importOriginal) => ({
  ...await importOriginal<typeof import('../marketNews')>(),
  loadMarketFeed: vi.fn(),
}))

const loadFeed = vi.mocked(loadMarketFeed)
let root: Root | undefined
let container: HTMLDivElement
let savedReading = emptyMonitorReadingState()
let saveSucceeds = true
type RenderProps = { initialQuery?: string; selectedIdentity?: string; selectedRevision?: number; readOnly?: boolean; onOpenHolding?: (identity: string) => void }

function TestPanel(props: RenderProps) {
  const [reading, setReading] = useState(savedReading)
  return <MonitorNewsPanel {...props} reading={reading} onReadingChange={(next) => {
    if (!saveSucceeds) return false
    savedReading = next
    setReading(next)
    return true
  }} />
}

function position(ticker: string, name: string, type: Position['type'] = 'stock'): Position {
  return { id: ticker, ticker, name, type, quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }
}

function story(id: string, matches: string[], origin: NewsItem['origin'] = 'wire'): NewsItem {
  return { id, title: `Headline ${id}`, matches, origin, source: 'Publisher', sourceUrl: `https://example.com/${id}`, publishedAt: 1000 }
}

function feed(items: NewsItem[]): LoadedMarketFeed {
  return { items, issues: [], fetchedAt: 1000 }
}

async function renderPanel(props: RenderProps = {}) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => { root!.render(<TestPanel {...props} />) })
}

async function clickButton(name: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === name || item.textContent === name)
  expect(button, `Button ${name}`).toBeDefined()
  await act(async () => { button!.click() })
}

function newsIdentity(ticker: string) {
  return holdingIdentity(state.store.positions.find((holding) => holding.ticker === ticker)!)
}

async function selectHolding(holding: string | Position) {
  const select = container.querySelector<HTMLSelectElement>('.mn-holding-search select')!
  await act(async () => {
    select.value = typeof holding === 'string' ? newsIdentity(holding) : holdingIdentity(holding)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  savedReading = emptyMonitorReadingState()
  saveSucceeds = true
  loadFeed.mockReset()
  state.store = {
    positions: [position('HDFCBANK', 'HDFC Bank Ltd'), position('TCS', 'Tata Consultancy Services Ltd'), position('FUND', 'Small Cap Fund', 'mutual-fund')],
    settings: { allowExternalData: true },
  } as unknown as ReturnType<typeof useStore>
  loadFeed.mockResolvedValue(feed([story('holding', ['HDFCBANK', 'TCS']), story('market', [])]))
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  root = undefined
  container?.remove()
})

describe('portfolio news', () => {
  it('restores a dismissed headline with Undo after leaving and remounting Monitor', async () => {
    await renderPanel()
    await clickButton('Dismiss Headline holding')
    await act(async () => root!.unmount())
    root = undefined
    container.remove()
    await renderPanel()
    expect(container.querySelector('.mn-stories')?.textContent).not.toContain('Headline holding')
    await clickButton('Undo')
    expect(container.querySelector('.mn-stories')?.textContent).toContain('Headline holding')
    expect(savedReading.articles.find((article) => article.key === newsReadingKey(story('holding', [])))?.dismissedAt).toBeUndefined()
  })

  it('does not regroup or reassess unchanged headlines while typing with a queued refresh', async () => {
    const items = Array.from({ length: 150 }, (_,index) => story(String(index), []))
    loadFeed.mockResolvedValueOnce(feed(items))
    await renderPanel()
    await clickButton('Save: Headline 0')
    loadFeed.mockResolvedValueOnce(feed([{ ...story('new', []), publishedAt: 2000 }, ...items]))
    await clickButton('Refresh market news')
    expect(container.textContent).toContain('Show 1 new headline')
    const group = vi.spyOn(readingOperations, 'groupNewsItems')
    const classify = vi.spyOn(headlineTone, 'classifyHeadline')
    try {
      await clickButton('Search market news')
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Search market news"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Banks')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(group).not.toHaveBeenCalled()
      expect(classify).not.toHaveBeenCalled()
      expect(container.querySelectorAll('.mn-stories article')).toHaveLength(150)
      expect(container.textContent).toContain('Show 1 new headline')
    } finally { group.mockRestore(); classify.mockRestore() }
  })

  it('opens search in the header, focuses the field, and closes on Escape or outside interaction', async () => {
    await renderPanel()
    const tools = container.querySelector('#monitor-news-tools')!
    const input = tools.querySelector('input')!
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Search market news"]')!
    expect(tools.closest('.mn-head')).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(tools.hasAttribute('inert')).toBe(true)

    await clickButton('Search market news')
    expect(document.activeElement).toBe(input)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(tools.hasAttribute('inert')).toBe(false)
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)

    await clickButton('Search market news')
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(loadFeed).toHaveBeenCalledTimes(1)
  })

  it('submits a topic from the compact field and returns focus to its trigger', async () => {
    await renderPanel()
    await clickButton('Search market news')
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search market news"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Interest rates')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await clickButton('Submit news search')
    const toggle = container.querySelector('button[aria-label="Search market news"]')!
    expect(loadFeed.mock.lastCall?.[1]?.query).toBe('Interest rates')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
  })

  it('remembers opened and saved stories across leaving the page, including their snapshots', async () => {
    await renderPanel()
    await clickButton('Mark read: Headline holding')
    await clickButton('Save: Headline holding')
    expect(savedReading.articles.find((article) => article.key === newsReadingKey(story('holding', [])))).toMatchObject({ openedAt: expect.any(Number), savedAt: expect.any(Number) })
    await act(async () => { root!.unmount() })
    root = undefined
    container.remove()
    loadFeed.mockResolvedValue(feed([story('new-only', [])]))
    await renderPanel()
    expect(container.querySelector('.mn-saved')?.textContent).toContain('Headline holding')
    expect(container.querySelector('.mn-saved .mn-story--opened')).not.toBeNull()
  })

  it('persists dismissal, supports Undo and keeps reading actions off the network', async () => {
    await renderPanel()
    await clickButton('Dismiss Headline holding')
    expect(container.querySelector('.mn-stories')?.textContent).not.toContain('Headline holding')
    expect(savedReading.articles.find((article) => article.key === newsReadingKey(story('holding', [])))?.dismissedAt).toEqual(expect.any(Number))
    await clickButton('Undo')
    expect(container.querySelector('.mn-stories')?.textContent).toContain('Headline holding')
    expect(savedReading.articles.find((article) => article.key === newsReadingKey(story('holding', [])))?.dismissedAt).toBeUndefined()
    expect(loadFeed).toHaveBeenCalledTimes(1)
  })

  it('queues new headlines until the user chooses to update the list', async () => {
    await renderPanel()
    const previous = [...container.querySelectorAll('.mn-story-title')].map((link) => link.textContent)
    loadFeed.mockResolvedValueOnce(feed([{ ...story('new', []), publishedAt: 2000 }, story('holding', ['HDFCBANK']), story('market', [])]))
    await clickButton('Refresh market news')
    expect([...container.querySelectorAll('.mn-story-title')].map((link) => link.textContent)).toEqual(previous)
    expect(savedReading.articles.some((article) => article.item.title === 'Headline new')).toBe(false)
    await clickButton('Show 1 new headline')
    expect(container.querySelector('.mn-story-title')?.textContent).toContain('Headline new')
    expect(savedReading.articles.some((article) => article.item.title === 'Headline new')).toBe(true)
  })

  it('groups identical publisher coverage with access to each original source', async () => {
    loadFeed.mockResolvedValue(feed([story('holding', []), { ...story('other-source', []), title: 'Headline holding', source: 'Other publisher' }]))
    await renderPanel()
    expect(container.querySelectorAll('.mn-stories article')).toHaveLength(1)
    expect(container.querySelector('.mn-sources summary')?.textContent).toBe('2 sources')
    expect(container.querySelectorAll('.mn-sources a')).toHaveLength(2)
  })

  it('follows a selected company with its market and restores that preference after leaving', async () => {
    state.store.positions.push({ ...position('AAPL', 'Apple Inc'), exchange: 'NASDAQ' })
    await renderPanel()
    await selectHolding('AAPL')
    await clickButton('Follow')
    expect(savedReading.follows[0]).toMatchObject({ query: 'Apple Inc', region: 'US' })
    await clickButton('Back to wire')
    const followed = container.querySelector<HTMLButtonElement>('.mn-following li .mn-text-button')!
    await act(async () => followed.click())
    expect(loadFeed.mock.lastCall?.[1]).toMatchObject({ query: 'Apple Inc', region: 'US' })
    await clickButton('Unfollow Apple Inc')
    expect(savedReading.follows).toHaveLength(0)
  })

  it('opens company context only for a unique matched listing', async () => {
    const onOpenHolding = vi.fn()
    await renderPanel({ onOpenHolding })
    await clickButton('View HDFCBANK')
    expect(onOpenHolding).toHaveBeenCalledWith(newsIdentity('HDFCBANK'))
    state.store.positions = [{ ...position('AAL', 'American Airlines'), exchange: 'NASDAQ' }, { ...position('AAL', 'Anglo American'), id: 'miner', exchange: 'LSE' }]
    loadFeed.mockResolvedValue(feed([story('ambiguous', ['AAL'])]))
    await renderPanel({ onOpenHolding })
    expect(container.querySelector('.mn-company')).toBeNull()
  })

  it('keeps persisted company context hidden while masked', async () => {
    savedReading = updateArticleReading(emptyMonitorReadingState(), story('private-holding', ['HDFCBANK']), { savedAt: 1 })
    savedReading.follows = [{ id: 'follow', query: 'HDFC Bank Ltd', region: 'IN' }]
    state.store.settings.hideValues = true
    await renderPanel()
    expect(container.querySelector('.mn-following, .mn-saved')).toBeNull()
    expect(container.textContent).not.toContain('private-holding')
    expect(container.textContent).not.toContain('HDFC Bank')
    expect(loadFeed.mock.lastCall?.[0]).toEqual([])
  })

  it('does not claim success when saving is unavailable and disables preference changes in read-only mode', async () => {
    await renderPanel()
    saveSucceeds = false
    await clickButton('Save: Headline holding')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be saved')
    expect(savedReading.articles.some((article) => article.savedAt)).toBe(false)
    await renderPanel({ readOnly: true })
    expect([...container.querySelectorAll<HTMLButtonElement>('.mn-story-actions button')].every((button) => button.disabled)).toBe(true)
  })

  it('keeps the general wire available while masked without sending portfolio context', async () => {
    state.store.settings.hideValues = true
    await renderPanel({ initialQuery: 'HDFC Bank Ltd', selectedIdentity: newsIdentity('HDFCBANK'), selectedRevision: 1 })
    expect(loadFeed.mock.lastCall?.[0]).toEqual([])
    expect(loadFeed.mock.lastCall?.[1]?.query).toBe('')
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.querySelector('.mn-holding-search')).toBeNull()
    expect(container.textContent).not.toMatch(/HDFCBANK|HDFC Bank|TCS|Tata Consultancy/)
    expect(container.querySelector('.mn-story-tag')).toBeNull()
  })

  it('clears company searches and aborts pending requests immediately when masking changes', async () => {
    await renderPanel({ initialQuery: 'HDFC Bank Ltd' })
    const signal = loadFeed.mock.lastCall![1]!.signal!
    state.store.settings.hideValues = true
    await renderPanel({ initialQuery: 'HDFC Bank Ltd' })
    expect(signal.aborted).toBe(true)
    expect(container.textContent).not.toContain('HDFC Bank')
    expect(container.querySelector('.mn-query')).toBeNull()
    expect(loadFeed.mock.lastCall?.[0]).toEqual([])
    expect(loadFeed.mock.lastCall?.[1]?.query).toBe('')
  })

  it('shows the full market wire by default with honest holding mentions and plain publisher titles', async () => {
    const title = 'TCS shares gain 1.25% after quarterly update'
    loadFeed.mockResolvedValue(feed([{ ...story('holding', ['TCS', 'TCS', 'FUND']), title }, story('market', [])]))
    await renderPanel()
    expect(container.querySelector('h2')?.textContent).toBe('Market news')
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.querySelector('.mn-scope')).toBeNull()
    expect(container.querySelector('.mn-story-tag')?.textContent).toBe('Headline match \u00b7 TCS')
    expect(container.querySelector('.mn-story-title')?.textContent?.trim()).toBe(title)
    expect(container.querySelector('.mn-title-number')).toBeNull()
    expect([...container.querySelectorAll('.mn-holding-search option')].some((option) => option.textContent?.includes('Small Cap Fund'))).toBe(false)
    expect(container.querySelector('.mn-story-title')?.getAttribute('href')).toBe('https://example.com/holding')
  })

  it('shows explained headline status indicators without implying certainty for ambiguous headlines', async () => {
    const titles = ['TCS shares gain 2%', 'HDFC Bank shares fall 1%', 'Revenue rises but profit falls', 'Shares could rise after results']
    loadFeed.mockResolvedValue(feed(titles.map((title, index) => ({ ...story(String(index), []), title }))))
    await renderPanel()
    const badges = [...container.querySelectorAll('.mn-tone')]
    expect(badges.map((badge) => badge.textContent)).toEqual(['+ Positive', '\u2212 Negative', '\u00b1 Mixed', '? Unclear'])
    for (const [index, status] of ['positive', 'negative', 'mixed', 'unknown'].entries()) {
      expect(badges[index].classList.contains(`mn-tone-${status}`)).toBe(true)
      expect(badges[index].getAttribute('role')).toBe('img')
      expect(badges[index].getAttribute('aria-label')).toContain(`Estimated headline tone: ${status === 'unknown' ? 'unclear' : status}.`)
      expect(badges[index].getAttribute('title')).toBe(badges[index].getAttribute('aria-label'))
    }
    expect(badges[3].getAttribute('aria-label')).toContain('does not establish a clear financial direction')
    expect(container.querySelector('.mn-scope')).toBeNull()
  })

  it('searches a holding only on selection and retains unmatched search results', async () => {
    loadFeed.mockImplementation(async (_positions, options) => feed(options?.query
      ? [story('wire', ['HDFCBANK']), story('result', [], 'search')]
      : [story('wire', ['HDFCBANK'])]))
    await renderPanel()
    expect(loadFeed.mock.calls[0][1]?.query).toBe('')

    await selectHolding('TCS')
    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(loadFeed.mock.calls[1][1]?.query).toBe('Tata Consultancy Services Ltd')
    expect(container.querySelector<HTMLSelectElement>('.mn-holding-search select')?.value).toBe(newsIdentity('TCS'))
    expect(container.querySelectorAll('article')).toHaveLength(1)
    expect(container.querySelector('.mn-story-tag')).toBeNull()
    expect(container.textContent).toContain('Company or topic search')

    await clickButton('Back to wire')
    expect(container.querySelector<HTMLSelectElement>('.mn-holding-search select')?.value).toBe('')
    expect(loadFeed.mock.calls[2][1]?.query).toBe('')
    expect(container.querySelector('.mn-story-title')?.textContent).toContain('Headline wire')
  })

  it('omits country suffixes and empty name separators while searching with the holding ticker', async () => {
    state.store.positions = [position('FMCGIETF', '', 'etf'), position('HDFCBANK', 'HDFC Bank Ltd')]
    loadFeed.mockImplementation(async (_positions, options) => feed(options?.query === 'FMCGIETF'
      ? [story('etf-result', ['FMCGIETF'], 'search')]
      : []))
    await renderPanel()

    await selectHolding('FMCGIETF')
    expect(loadFeed.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ query: 'FMCGIETF', region: 'IN' }))
    expect(container.querySelector('.mn-story-title')?.textContent).toContain('Headline etf-result')
    expect([...container.querySelectorAll('.mn-holding-search option')].map((option) => option.textContent)).toEqual([
      'Find news for a holding', 'FMCGIETF', 'HDFCBANK \u00b7 HDFC Bank Ltd',
    ])
  })

  it('accepts activity selections without repeating searches after quote-only store updates', async () => {
    await renderPanel({ selectedIdentity: newsIdentity('HDFCBANK') })
    expect(loadFeed).toHaveBeenCalledTimes(1)
    expect(loadFeed.mock.calls[0][1]?.query).toBe('HDFC Bank Ltd')

    state.store.positions = state.store.positions.map((holding) => ({ ...holding, lastPrice: 120 }))
    await renderPanel({ selectedIdentity: newsIdentity('HDFCBANK') })
    expect(loadFeed).toHaveBeenCalledTimes(1)

    await renderPanel({ selectedIdentity: newsIdentity('TCS') })
    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(loadFeed.mock.calls[1][1]?.query).toBe('Tata Consultancy Services Ltd')
    await renderPanel({ selectedIdentity: newsIdentity('FUND') })
    expect(loadFeed).toHaveBeenCalledTimes(2)
  })

  it('uses the holding market for global news and keeps manual topic search on its existing default', async () => {
    state.store.positions.push({ ...position('AAPL', 'Apple Inc'), exchange: 'NASDAQ' })
    await renderPanel()
    await selectHolding('AAPL')
    expect(loadFeed.mock.calls[1][1]).toEqual(expect.objectContaining({ query: 'Apple Inc', region: 'US' }))

    await clickButton('Search market news')
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search market news"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Federal Reserve')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(loadFeed.mock.calls.at(-1)?.[1]?.query).toBe('Federal Reserve')
    expect(loadFeed.mock.calls.at(-1)?.[1]).not.toHaveProperty('region')
  })

  it.each([false, true])('searches equal tickers in their own markets regardless of import order: %s', async (reverseOrder) => {
    const airline: Position = { ...position('AAL', 'American Airlines'), id: 'airline', exchange: 'NASDAQ' }
    const miner: Position = { ...position('AAL', 'Anglo American plc'), id: 'miner', exchange: 'LSE' }
    state.store.positions = reverseOrder ? [miner, airline] : [airline, miner]
    await renderPanel({ selectedIdentity: holdingIdentity(airline), selectedRevision: 1 })
    expect(loadFeed.mock.calls[0][1]).toEqual(expect.objectContaining({ query: 'American Airlines', region: 'US' }))
    const select = container.querySelector<HTMLSelectElement>('.mn-holding-search select')!
    expect([...select.options].map((option) => option.value)).toEqual(expect.arrayContaining([holdingIdentity(airline), holdingIdentity(miner)]))
    expect(select.options).toHaveLength(3)

    await selectHolding(miner)
    expect(loadFeed.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ query: 'Anglo American plc', region: 'GB' }))
    await renderPanel({ selectedIdentity: holdingIdentity(airline), selectedRevision: 2 })
    expect(loadFeed.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ query: 'American Airlines', region: 'US' }))
    expect(select.value).toBe(holdingIdentity(airline))
  })

  it('reselects an activity holding after the local picker or Back to wire changes the query', async () => {
    await renderPanel({ selectedIdentity: newsIdentity('HDFCBANK'), selectedRevision: 1 })
    await selectHolding('TCS')
    await renderPanel({ selectedIdentity: newsIdentity('HDFCBANK'), selectedRevision: 2 })
    expect(loadFeed.mock.calls[2][1]?.query).toBe('HDFC Bank Ltd')
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Find news for a holding"]')?.value).toBe(newsIdentity('HDFCBANK'))
    await clickButton('Back to wire')
    await renderPanel({ selectedIdentity: newsIdentity('HDFCBANK'), selectedRevision: 3 })
    expect(loadFeed.mock.calls[4][1]?.query).toBe('HDFC Bank Ltd')
  })

  it('returns from company search to the full wire', async () => {
    loadFeed.mockImplementation(async (_positions, options) => feed([
      story('holding', ['HDFCBANK']), story('market', []),
      ...(options?.query ? [story('searched', ['TCS'], 'search')] : []),
    ]))
    await renderPanel()
    await selectHolding('TCS')
    expect(container.querySelectorAll('article')).toHaveLength(1)
    await clickButton('Back to wire')
    expect(container.querySelector('.mn-query')).toBeNull()
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Find news for a holding"]')?.value).toBe('')
    expect(loadFeed.mock.calls[2][1]?.query).toBe('')
    expect(loadFeed.mock.calls[2][1]).not.toHaveProperty('region')
  })

  it('respects external data settings without showing company controls', async () => {
    state.store.settings.allowExternalData = false
    await renderPanel()
    expect(container.querySelector('.mn-search, .mn-holding-search')).toBeNull()
    expect(container.textContent).toContain('External data is off')
    expect(loadFeed).not.toHaveBeenCalled()
  })

  it('loads general headlines without imported holdings', async () => {
    state.store.positions = []
    await renderPanel()
    expect(loadFeed.mock.lastCall?.[0]).toEqual([])
    expect(container.querySelectorAll('article')).toHaveLength(2)
  })

  it('makes every headline available inside the keyboard-accessible feed without expansion', async () => {
    loadFeed.mockResolvedValue(feed([1, 2, 3, 4, 5].map((number) => story(String(number), ['TCS']))))
    await renderPanel()
    const scrollRegion = container.querySelector('[role="region"][aria-label="Market news feed"]')!
    expect(scrollRegion.getAttribute('tabindex')).toBe('0')
    expect(scrollRegion.querySelectorAll('article')).toHaveLength(5)
    expect(container.textContent).not.toContain('Show more headlines')
    await clickButton('Dismiss Headline 5')
    expect(container.querySelectorAll('article')).toHaveLength(4)
    expect(container.querySelector('.mn-footer')).toBeNull()
    expect(loadFeed).toHaveBeenCalledTimes(1)
  })

  it('keeps same-query headlines during refresh and after failure but clears them for a new query', async () => {
    await renderPanel()
    let rejectRefresh: (reason: Error) => void = () => {}
    loadFeed.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRefresh = reject }))
    await clickButton('Refresh market news')
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.textContent).toContain('Refreshing')
    await act(async () => { rejectRefresh(new Error('Offline')) })
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.querySelector('.mn-issues')?.textContent).toContain('Showing available headlines')
    loadFeed.mockImplementationOnce(() => new Promise(() => {}))
    await selectHolding('TCS')
    expect(container.querySelector('article')).toBeNull()
  })

  it('shows available partial results with source failures and missing publication times', async () => {
    loadFeed.mockImplementation(async (_positions, options) => {
      const partial = { items: [{ ...story('partial', []), publishedAt: undefined }], issues: [{ source: 'Publisher B', message: 'Unavailable' }], fetchedAt: 1000 }
      options?.onPartial?.(partial)
      return partial
    })
    await renderPanel()
    expect(container.querySelectorAll('article')).toHaveLength(1)
    expect(container.querySelector('.mn-story-meta')?.textContent).toContain('Time unavailable')
    expect(container.querySelector('.mn-issues')?.textContent).toContain('Publisher B: Unavailable')
  })

  it('aborts previous queries and prevents their late headlines from replacing current results', async () => {
    const pending: ((next: LoadedMarketFeed) => void)[] = []
    loadFeed.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    await renderPanel()
    const firstSignal = loadFeed.mock.calls[0][1]?.signal
    expect(container.querySelector('[aria-label="Loading market news"]')).not.toBeNull()
    await renderPanel({ selectedIdentity: newsIdentity('TCS') })
    expect(firstSignal?.aborted).toBe(true)

    await act(async () => { pending[1](feed([story('current', ['TCS'], 'search')])) })
    await act(async () => { pending[0](feed([story('stale', ['HDFCBANK'])])) })
    expect(container.querySelector('.mn-story-title')?.textContent).toContain('Headline current')
    expect(container.textContent).not.toContain('Headline stale')
  })

  it('shows a useful failure and allows a refresh', async () => {
    loadFeed.mockRejectedValueOnce(new Error('Network unavailable'))
    await renderPanel()
    expect(container.querySelector('.mn-issues')?.textContent).toContain('News could not be loaded. Try again later.')
    await clickButton('Refresh market news')
    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.mn-story-title')?.textContent).toContain('Headline holding')
  })
})
