// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMarketFeed, type LoadedMarketFeed, type NewsItem } from '../marketNews'
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

function position(ticker: string, name: string, type: Position['type'] = 'stock'): Position {
  return { id: ticker, ticker, name, type, quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }
}

function story(id: string, matches: string[], origin: NewsItem['origin'] = 'wire'): NewsItem {
  return { id, title: `Headline ${id}`, matches, origin, source: 'Publisher', sourceUrl: `https://example.com/${id}`, publishedAt: 1000 }
}

function feed(items: NewsItem[]): LoadedMarketFeed {
  return { items, issues: [], fetchedAt: 1000 }
}

async function renderPanel(props: { initialQuery?: string; selectedTicker?: string; selectedRevision?: number } = {}) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => { root!.render(<MonitorNewsPanel {...props} />) })
}

async function clickButton(name: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === name || item.textContent === name)
  expect(button, `Button ${name}`).toBeDefined()
  await act(async () => { button!.click() })
}

async function selectHolding(ticker: string) {
  const select = container.querySelector<HTMLSelectElement>('.mn-holding-search select')!
  await act(async () => {
    select.value = ticker
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
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
  it('keeps publisher headlines readable and emphasizes only their relevant financial figures', async () => {
    const titles = [
      'TCS shares gain 1.25% as investors assess its AI services update',
      'HDFC Bank shares down 0.86% after quarterly update',
      'TCS shares rise as revenue grows 10% after a ₹5 crore contract',
    ]
    loadFeed.mockResolvedValue(feed(titles.map((title, index) => ({ ...story(String(index), ['TCS']), title }))))
    await renderPanel()
    const links = [...container.querySelectorAll<HTMLAnchorElement>('.mn-story-title')]
    expect(links.map((link) => link.textContent?.trim())).toEqual(titles)
    expect(links[0].querySelector('.mn-title-positive')?.textContent).toBe('1.25%')
    expect(links[1].querySelector('.mn-title-negative')?.textContent).toBe('0.86%')
    expect(links[2].querySelectorAll('.mn-title-positive, .mn-title-negative')).toHaveLength(0)
    expect(links[2].querySelectorAll('strong')).toHaveLength(2)
  })

  it('defaults to headline matches, counts unique eligible holdings, and keeps Market local', async () => {
    state.store.positions.push({ ...state.store.positions[0], id: 'second-folio' })
    loadFeed.mockResolvedValue(feed([story('holding', ['HDFCBANK', 'TCS', 'HDFCBANK', 'FUND']), story('market', [])]))
    await renderPanel()

    expect(container.querySelector('.mn-scope button')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('article')).toHaveLength(1)
    expect(container.querySelector('.mn-coverage strong')?.textContent).toBe('2 of 2 holdings mentioned')
    expect(container.querySelector('.mn-story-tag')?.textContent).toBe('HDFCBANK · TCS')
    expect(container.textContent).toContain('Mutual funds use NAV updates; constituent news is not available.')
    expect(container.querySelector('.mn-holding-search option[value="FUND"]')).toBeNull()
    expect(container.querySelector('.mn-story-title')?.getAttribute('href')).toBe('https://example.com/holding')

    await clickButton('Market')
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.querySelectorAll('.mn-story-tag')[1].textContent).toBe('MARKET')
    expect(loadFeed).toHaveBeenCalledTimes(1)
  })

  it('searches a holding only on selection and retains unmatched search results with honest coverage', async () => {
    loadFeed.mockImplementation(async (_positions, options) => feed(options?.query
      ? [story('wire', ['HDFCBANK']), story('result', [], 'search')]
      : [story('wire', ['HDFCBANK'])]))
    await renderPanel()
    expect(loadFeed.mock.calls[0][1]?.query).toBe('')

    await selectHolding('TCS')
    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(loadFeed.mock.calls[1][1]?.query).toBe('Tata Consultancy Services Ltd')
    expect(container.querySelector<HTMLSelectElement>('.mn-holding-search select')?.value).toBe('TCS')
    expect(container.querySelectorAll('article')).toHaveLength(1)
    expect(container.querySelector('.mn-story-tag')?.textContent).toBe('SEARCH')
    expect(container.querySelector('.mn-coverage strong')?.textContent).toBe('0 of 2 holdings mentioned')
    expect(container.textContent).toContain('Search results may include other companies.')

    await clickButton('Back to wire')
    expect(container.querySelector<HTMLSelectElement>('.mn-holding-search select')?.value).toBe('')
    expect(loadFeed.mock.calls[2][1]?.query).toBe('')
    expect(container.querySelector('.mn-story-title')?.textContent).toContain('Headline wire')
  })

  it('accepts activity selections without repeating searches after quote-only store updates', async () => {
    await renderPanel({ selectedTicker: 'HDFCBANK' })
    expect(loadFeed).toHaveBeenCalledTimes(1)
    expect(loadFeed.mock.calls[0][1]?.query).toBe('HDFC Bank Ltd')

    state.store.positions = state.store.positions.map((holding) => ({ ...holding, lastPrice: 120 }))
    await renderPanel({ selectedTicker: 'HDFCBANK' })
    expect(loadFeed).toHaveBeenCalledTimes(1)

    await renderPanel({ selectedTicker: 'TCS' })
    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(loadFeed.mock.calls[1][1]?.query).toBe('Tata Consultancy Services Ltd')
    await renderPanel({ selectedTicker: 'FUND' })
    expect(loadFeed).toHaveBeenCalledTimes(2)
  })

  it('uses the holding market for global news and keeps manual topic search on its existing default', async () => {
    state.store.positions.push({ ...position('AAPL', 'Apple Inc'), exchange: 'NASDAQ', currency: 'USD' })
    await renderPanel()
    await selectHolding('AAPL')
    expect(loadFeed.mock.calls[1][1]).toEqual(expect.objectContaining({ query: 'Apple Inc', region: 'US' }))

    await clickButton('Search and filter market news')
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search market news"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Federal Reserve')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(loadFeed.mock.calls.at(-1)?.[1]?.query).toBe('Federal Reserve')
    expect(loadFeed.mock.calls.at(-1)?.[1]).not.toHaveProperty('region')
  })

  it('reselects an activity holding after the local picker or Back to wire changes the query', async () => {
    await renderPanel({ selectedTicker: 'HDFCBANK', selectedRevision: 1 })
    await selectHolding('TCS')
    await renderPanel({ selectedTicker: 'HDFCBANK', selectedRevision: 2 })
    expect(loadFeed.mock.calls[2][1]?.query).toBe('HDFC Bank Ltd')
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Find news for a holding"]')?.value).toBe('HDFCBANK')
    await clickButton('Back to wire')
    await renderPanel({ selectedTicker: 'HDFCBANK', selectedRevision: 3 })
    expect(loadFeed.mock.calls[4][1]?.query).toBe('HDFC Bank Ltd')
  })

  it('exits company search when Market is selected and shows the full wire', async () => {
    loadFeed.mockImplementation(async (_positions, options) => feed([
      story('holding', ['HDFCBANK']), story('market', []),
      ...(options?.query ? [story('searched', ['TCS'], 'search')] : []),
    ]))
    await renderPanel()
    await selectHolding('TCS')
    expect(container.querySelectorAll('article')).toHaveLength(1)
    await clickButton('Market')
    expect(container.querySelector('.mn-query')).toBeNull()
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Find news for a holding"]')?.value).toBe('')
    expect(loadFeed.mock.calls[2][1]?.query).toBe('')
    expect(loadFeed.mock.calls[2][1]).not.toHaveProperty('region')
  })

  it('keeps the scope and holding picker visible when external data is disabled', async () => {
    state.store.settings.allowExternalData = false
    await renderPanel()
    expect(container.querySelectorAll('.mn-scope button')).toHaveLength(2)
    expect(container.querySelector<HTMLButtonElement>('.mn-scope button')?.disabled).toBe(true)
    expect(container.querySelector<HTMLSelectElement>('.mn-holding-search select')?.disabled).toBe(true)
    expect(container.textContent).toContain('External data is off')
    expect(loadFeed).not.toHaveBeenCalled()
  })

  it('retains paging and dismissal without refetching', async () => {
    loadFeed.mockResolvedValue(feed([1, 2, 3, 4].map((number) => story(String(number), ['TCS']))))
    await renderPanel()
    expect(container.querySelectorAll('article')).toHaveLength(3)
    await clickButton('Next news page')
    expect(container.querySelectorAll('article')).toHaveLength(1)
    expect(container.querySelector('.mn-story-title')?.textContent).toContain('Headline 4')
    await clickButton('Dismiss Headline 4')
    expect(container.querySelectorAll('article')).toHaveLength(3)
    expect(container.querySelector('nav[aria-label="Market news pages"]')).toBeNull()
    expect(loadFeed).toHaveBeenCalledTimes(1)
  })

  it('aborts previous queries and prevents their late headlines from replacing current results', async () => {
    const pending: ((next: LoadedMarketFeed) => void)[] = []
    loadFeed.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    await renderPanel()
    const firstSignal = loadFeed.mock.calls[0][1]?.signal
    expect(container.querySelector('[aria-label="Loading market news"]')).not.toBeNull()
    await renderPanel({ selectedTicker: 'TCS' })
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
