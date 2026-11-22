// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdingIdentity, MONITOR_STORAGE_KEY, type MonitorState } from '../monitor'
import { loadSettings } from '../store'
import { quoteKey } from '../valuation'
import type { useStore } from '../useStore'
import { MonitorView } from './MonitorView'
import { loadMarketEvents, type MarketEvent } from '../marketEvents'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true } })
Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; this.dispatchEvent(new Event('close')) } })
vi.mock('../marketEvents', () => ({ loadMarketEvents: vi.fn(), EVENTS_REFRESH_MS: 15 * 60_000 }))
beforeEach(() => { vi.mocked(loadMarketEvents).mockReset().mockResolvedValue({ events: [], issues: [], fetchedAt: Date.now() }) })
const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore> }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('./MonitorNewsPanel', () => ({ MonitorNewsPanel: ({ selectedIdentity, selectedRevision }: { selectedIdentity: string; selectedRevision: number }) => <section data-news-identity={selectedIdentity} data-news-revision={selectedRevision} /> }))
vi.mock('./MonitorIpos', () => ({ MonitorIpos: ({ allowed }: { allowed: boolean }) => <section data-ipo-panel data-allowed={allowed} /> }))

let root: Root
let container: HTMLDivElement

async function renderWatch(hideValues = false) {
  const positions = ['UP', 'DOWN'].map((ticker) => ({
    id: ticker, ticker, name: ticker, type: 'stock' as const, quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100,
  }))
  localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ version: 1, alerts: [], events: [], rules: [
    { id: 'above', holding: 'UP', holdingId: 'UP', instrumentIdentity: holdingIdentity(positions[0]), condition: 'price_above', threshold: 110, active: true },
    { id: 'below', holding: 'DOWN', holdingId: 'DOWN', instrumentIdentity: holdingIdentity(positions[1]), condition: 'price_below', threshold: 90, active: true },
    { id: 'move', holding: 'UP', holdingId: 'UP', instrumentIdentity: holdingIdentity(positions[0]), condition: 'daily_move', threshold: 1, active: true },
  ] }))
  state.store = {
    positions, liveQuotes: {
      [quoteKey(positions[0])]: { price: 120, changePct: 10, at: Date.now(), source: 'yahoo' },
      [quoteKey(positions[1])]: { price: 80, changePct: -10, at: Date.now(), source: 'yahoo' },
    },
    settings: { ...loadSettings(), allowExternalData: true, hideValues },
    refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null,
  } as unknown as ReturnType<typeof useStore>
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await rerender()
}

async function rerender() {
  await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
}

async function clickButton(label: string) {
  const button = [...container.querySelectorAll<HTMLElement>('button, summary')].find((item) => item.textContent === label || item.getAttribute('aria-label') === label)!
  expect(button).toBeDefined()
  await act(async () => { button.click() })
}

async function restoreSaved(change: (saved: MonitorState & { version: number }) => void) {
  const saved = JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!)
  change(saved)
  localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify(saved))
  await act(async () => { window.dispatchEvent(new Event('finverse:monitor-restored')) })
}

function expectPrivateWatch() {
  expect(container.textContent).not.toMatch(/\bUP\b|\bDOWN\b|Daily move up|Daily move down|Price is above|Price is below|10\.00%|120\.00|80\.00/)
  const labels = [...container.querySelectorAll('[aria-label], [title]')].map(element => `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`).join(' ')
  expect(labels).not.toMatch(/\bUP\b|\bDOWN\b/)
  expect(container.querySelector('[data-tone="up"], [data-tone="down"], [data-trend="up"], [data-trend="down"]')).toBeNull()
  expect(container.querySelector('.mp-rule-condition svg, .pa-news-button')).toBeNull()
  expect(container.querySelector('.mp-rule-list')?.innerHTML).not.toMatch(/Price above|Price below|Daily move exceeds/)
}

async function openTab(label: string) {
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.getAttribute('aria-label') === label)
  expect(tab, `Tab: ${label}`).toBeDefined()
  await act(async () => { tab!.click() })
}

const filing = (holding: { id: string; name: string }, index = 0): MarketEvent => ({
  id: `filing-${holding.id}-${index}`, symbol: holding.id, title: `Filing ${index}`, kind: 'filing', date: '2026-10-27', dateLabel: 'Published', publishedAt: Date.now() - index * 1000,
  source: 'NSE', sourceUrl: `https://nsearchives.nseindia.com/corporate/${holding.id}-${index}.pdf`, holdingId: holding.id, instrumentIdentity: '', holdingName: holding.name,
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('single-page Monitor', () => {
  it('shows public IPOs and the economic calendar before a portfolio exists, without owned-company feeds', async () => {
    state.store = { positions: [], liveQuotes: {}, settings: { ...loadSettings(), allowExternalData: true }, refreshNow: vi.fn() } as unknown as ReturnType<typeof useStore>
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const importHoldings = vi.fn()
    await act(async () => root.render(<MonitorView onRequestImport={importHoldings} />))
    expect(container.querySelector('[data-news-identity]')).toBeNull()
    expect(container.querySelector('.mp-monitor-sidebar')).toBeNull()
    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('aria-label'))).toEqual(['IPOs', 'Economic calendar'])
    const calendar = container.querySelector('#monitor-calendar')!
    expect(calendar.querySelector('[data-ipo-panel]')?.getAttribute('data-allowed')).toBe('true')
    const guide = container.querySelector<HTMLDetailsElement>('details.mi-setup')!
    expect(guide.open).toBe(false)
    expect(calendar.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const directImport = container.querySelector<HTMLButtonElement>('.mp-hero button')!
    expect(directImport.textContent).toBe('Import portfolio')
    await act(async () => { directImport.click() })
    expect(importHoldings).toHaveBeenCalledOnce()
    expect(loadMarketEvents).not.toHaveBeenCalled()
    expect(state.store.refreshNow).not.toHaveBeenCalled()

    state.store.positions = [{ id: 'imported', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100 }]
    await rerender()
    expect(container.querySelector('.mo-edition')).toBeNull()
    expect(container.querySelector('[data-news-identity]')).not.toBeNull()
    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('aria-label'))).toEqual(['IPOs', 'Economic calendar', 'Company updates'])
    expect(loadMarketEvents).not.toHaveBeenCalled()
    await openTab('Company updates')
    expect(loadMarketEvents).toHaveBeenCalledOnce()
  })

  it('puts the calendar card under the news and keeps watch rules beside them', async () => {
    await renderWatch()
    const content = container.querySelector('.mp-monitor-content')!
    expect(content.firstElementChild?.hasAttribute('data-news-identity')).toBe(true)
    expect(content.children[1]?.id).toBe('monitor-calendar')
    const sidebar = container.querySelector('.mp-monitor-sidebar')!
    expect(sidebar.querySelector('.mp-rule-list')?.textContent).toContain('UP')
    expect([...sidebar.querySelectorAll('button')].some(button => button.textContent === '+ New rule')).toBe(true)
    expect(sidebar.querySelector('#monitor-calendar, .mi-panel')).toBeNull()
    expect([...container.querySelectorAll('.mp-section-links a')].map((link) => link.textContent)).toEqual(['News', 'Calendar', 'Watches'])
  })

  it('loads each tab only when it is opened and remembers the choice', async () => {
    await renderWatch()
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('aria-label')).toBe('IPOs')
    expect(container.querySelector('[data-ipo-panel]')).not.toBeNull()
    expect(loadMarketEvents).not.toHaveBeenCalled()
    await openTab('Economic calendar')
    expect(container.querySelector('[data-ipo-panel]')).toBeNull()
    expect(container.querySelector('.mc-econ, [aria-label="Loading economic calendar"]')).not.toBeNull()
    expect(sessionStorage.getItem('finverse:monitor-calendar-tab')).toBe('economy')
    expect(loadMarketEvents).not.toHaveBeenCalled()
    expect(container.querySelector('.mc-head button[aria-label="Add reminder"]')).toBeNull()
    await openTab('Company updates')
    expect(container.querySelector('.mc-head button[aria-label="Add reminder"]')).not.toBeNull()
  })

  it('keeps Company updates in place with a loader until events arrive, then shows their result', async () => {
    let finish: (feed: Awaited<ReturnType<typeof loadMarketEvents>>) => void = () => {}
    vi.mocked(loadMarketEvents).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    await renderWatch()
    await openTab('Company updates')
    const company = container.querySelector('.mc-company')!
    expect(company.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Loading company updates')
    expect(container.textContent).not.toContain('No announced events')
    await act(async () => finish({ events: [], issues: [], fetchedAt: Date.now() }))
    expect(container.querySelector('.mc-company')).toBe(company)
    expect(container.querySelector('.skeleton-rows')).toBeNull()
    expect(company.textContent).toContain('No announced events or recent filings for your NSE holdings.')
  })

  it('prefills watch and reminder forms from a selected company', async () => {
    vi.mocked(loadMarketEvents).mockResolvedValue({ events: [filing({ id: 'UP', name: 'UP' }), filing({ id: 'DOWN', name: 'DOWN' })], issues: [], fetchedAt: Date.now() })
    await renderWatch()
    await openTab('Company updates')
    await clickButton('UP')
    expect(container.querySelector<HTMLDialogElement>('.mp-company-dialog')?.open).toBe(true)
    await clickButton('Create watch')
    const ruleForm = container.querySelector<HTMLDialogElement>('[aria-labelledby="mp-rule-title"]')!
    expect(ruleForm.open).toBe(true)
    expect(ruleForm.querySelector<HTMLInputElement>('[role="combobox"]')?.value).toBe('UP')
    await clickButton('Close rule form')
    await clickButton('DOWN')
    await clickButton('Remind me')
    const reminderForm = container.querySelector<HTMLDialogElement>('[aria-labelledby="mp-reminder-title"]')!
    expect(reminderForm.open).toBe(true)
    expect(reminderForm.querySelector('select')?.value).toBe('DOWN')
  })

  it('makes every company filing available in a focusable feed without expansion', async () => {
    vi.mocked(loadMarketEvents).mockResolvedValue({ events: Array.from({ length: 8 }, (_, index) => filing({ id: 'UP', name: 'UP' }, index)), issues: [], fetchedAt: Date.now() })
    await renderWatch()
    await openTab('Company updates')
    const region = container.querySelector('[role="region"][aria-label="Company filings"]')!
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.querySelectorAll('article')).toHaveLength(8)
    expect(container.textContent).not.toContain('Show more updates')
  })

  it('uses confirmed event dates for reminders and links filings to their original document', async () => {
    const result: MarketEvent = {
      id: 'announced-result', symbol: 'UP', title: 'Quarterly results', kind: 'results', date: '2099-11-02', dateLabel: 'Meeting date',
      source: 'NSE', sourceUrl: 'https://www.nseindia.com/companies-listing/corporate-filings-board-meetings',
      holdingId: 'UP', instrumentIdentity: '', holdingName: 'UP',
    }
    const document = filing({ id: 'UP', name: 'UP' })
    vi.mocked(loadMarketEvents).mockResolvedValue({ events: [result, document], issues: [], fetchedAt: Date.now() })
    await renderWatch()
    await openTab('Company updates')
    expect(container.querySelector('.mp-agenda-event time')?.getAttribute('datetime')).toBe(result.date)
    expect(container.querySelector('.mp-updates-scroll article > a')?.getAttribute('href')).toBe(document.sourceUrl)
    await clickButton('Remind me: UP Quarterly results')
    const form = container.querySelector<HTMLDialogElement>('[aria-labelledby="mp-reminder-title"]')!
    expect(form.open).toBe(true)
    expect(form.querySelector('select')?.value).toBe('UP')
    expect(form.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(result.date)
    expect(form.querySelector<HTMLInputElement>('input:not([type])')?.value).toBe(result.title)
  })

  it('clears company context and aborts its event request when masking is enabled', async () => {
    let resolve: (feed: Awaited<ReturnType<typeof loadMarketEvents>>) => void = () => {}
    vi.mocked(loadMarketEvents).mockResolvedValueOnce({ events: [filing({ id: 'UP', name: 'UP' })], issues: [], fetchedAt: Date.now() })
      .mockImplementation(() => new Promise((done) => { resolve = done }))
    await renderWatch()
    await openTab('Company updates')
    await clickButton('UP')
    await clickButton('Refresh prices')
    const signal = vi.mocked(loadMarketEvents).mock.calls.at(-1)?.[1]?.signal
    state.store.settings = { ...state.store.settings, hideValues: true }
    await rerender()
    expect(signal?.aborted).toBe(true)
    void resolve
    expect(container.querySelector('.mp-company-dialog, .mc-company article')).toBeNull()
    expect(container.querySelector('.mc-company')?.textContent).toContain('Company updates are hidden.')
    expectPrivateWatch()
  })

  it('sends new watch alerts to notifications instead of adding a card to Monitor', async () => {
    await renderWatch()
    const saved = JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!) as MonitorState
    expect(saved.alerts.filter((alert) => alert.state === 'open')).toHaveLength(3)
    expect(container.querySelector('.pa-attention, .pa-record, #monitor-alerts-heading')).toBeNull()
    expect(container.querySelector('.mp-toast-message')?.textContent).toBe('3 watch alerts added to notifications.')
  })

  it('keeps local rules and reminders accessible while external data is off', async () => {
    await renderWatch()
    state.store.settings = { ...state.store.settings, allowExternalData: false }
    await rerender()
    await openTab('Company updates')
    expect(container.querySelector('.mp-hero')?.textContent).toContain('Market data paused')
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Refresh prices')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Add reminder"]')?.disabled).toBe(false)
    expect(container.querySelector('.mc-company')?.textContent).toContain('Market data is paused')
    expect(container.querySelector('.mp-rule-list')?.textContent).toContain('UP')
  })

  it('keeps overdue personal reminders actionable and restores a turned-off reminder', async () => {
    await renderWatch()
    await openTab('Company updates')
    await restoreSaved(saved => {
      saved.events = [
        { id: 'overdue', holding: 'UP', holdingId: 'UP', title: 'Review old watch level', date: '2000-01-01', kind: 'Reminder', reminder: true },
        { id: 'future', holding: 'DOWN', holdingId: 'DOWN', title: 'Review future watch level', date: '2099-01-01', kind: 'Reminder', reminder: true },
      ]
    })
    const reminders = container.querySelector('.mc-company')!
    expect(reminders.textContent).toContain('Overdue')
    expect(reminders.textContent).toContain('Review future watch level')
    await clickButton('Turn off reminder: Review old watch level')
    const inactive = reminders.querySelector<HTMLDetailsElement>('.pa-inactive-reminders')!
    expect(inactive.textContent).toContain('Review old watch level')
    expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).events.find((event: { id: string }) => event.id === 'overdue').reminder).toBe(false)
    await act(async () => { inactive.querySelector('summary')!.click() })
    await clickButton('Restore')
    expect(reminders.querySelector('.pa-inactive-reminders')).toBeNull()
    expect(reminders.textContent).toContain('Overdue')
    expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).events.find((event: { id: string }) => event.id === 'overdue').reminder).toBe(true)
  })

  it('deletes only the selected inactive reminder and keeps it deleted after remounting', async () => {
    await renderWatch()
    await openTab('Company updates')
    await restoreSaved(saved => {
      saved.events = [
        { id: 'remove', holding: 'UP', holdingId: 'UP', title: 'Old results reminder', date: '2000-01-01', kind: 'Reminder', reminder: false },
        { id: 'keep-inactive', holding: 'DOWN', holdingId: 'DOWN', title: 'Inactive dividend reminder', date: '2000-01-02', kind: 'Reminder', reminder: false },
        { id: 'keep-active', holding: 'UP', holdingId: 'UP', title: 'Active review reminder', date: '2099-01-01', kind: 'Reminder', reminder: true },
      ]
    })
    await clickButton('Inactive reminders')
    await clickButton('Delete inactive reminder: Old results reminder')
    const remaining = JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).events
    expect(remaining.map((event: { id: string }) => event.id)).toEqual(['keep-inactive', 'keep-active'])
    expect(remaining.find((event: { id: string }) => event.id === 'keep-active').reminder).toBe(true)
    expect(container.textContent).not.toContain('Old results reminder')
    expect(container.textContent).toContain('Reminder deleted.')

    await act(async () => { root.unmount() })
    root = createRoot(container)
    await rerender()
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('aria-label')).toBe('Company updates')
    expect(container.textContent).not.toContain('Old results reminder')
    expect(container.querySelector('.pa-inactive-reminders')?.textContent).toContain('Inactive dividend reminder')
    expect(container.querySelector('.mp-personal-reminders')?.textContent).toContain('Active review reminder')
    expect(container.querySelector('.mp-personal-reminders .mp-reminder-delete')).toBeNull()
  })

  it('keeps an inactive reminder visible when deletion cannot be saved', async () => {
    await renderWatch()
    await openTab('Company updates')
    await restoreSaved(saved => {
      saved.events = [{ id: 'remove', holding: 'UP', holdingId: 'UP', title: 'Old results reminder', date: '2000-01-01', kind: 'Reminder', reminder: false }]
    })
    await clickButton('Inactive reminders')
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full') })
    try {
      await clickButton('Delete inactive reminder: Old results reminder')
      expect(container.querySelector('.pa-inactive-reminders')?.textContent).toContain('Old results reminder')
      expect(container.textContent).toContain('Reminder could not be deleted. Free browser storage and try again.')
      expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).events[0].id).toBe('remove')
    } finally { write.mockRestore() }
  })

  it('does not recreate fund NAV summaries, price moves or constituent news', async () => {
    await renderWatch()
    const fund = { ...state.store.positions[0], id: 'fund', ticker: 'FUND', name: 'Example Flexi Cap Fund', type: 'mutual-fund' as const }
    state.store.positions = [fund]
    state.store.liveQuotes = { [quoteKey(fund)]: { price: 83.14, source: 'nav', at: Date.now() } }
    await restoreSaved(saved => { saved.alerts = []; saved.rules = [] })
    await rerender()
    expect(container.querySelector('.mp-check-status, .pa-news-button, .pa-table, .pa-movers')).toBeNull()
    expect(container.textContent).not.toContain('83.14')
  })

  it('repeats holding news selection with the same identity and a new revision', async () => {
    vi.mocked(loadMarketEvents).mockResolvedValue({ events: [filing({ id: 'UP', name: 'UP' })], issues: [], fetchedAt: Date.now() })
    await renderWatch()
    await openTab('Company updates')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1 })
    for (const revision of [1, 2]) {
      await clickButton('UP')
      await clickButton('Related news')
      expect(container.querySelector('[data-news-identity]')?.getAttribute('data-news-identity')).toBe(holdingIdentity(state.store.positions[0]))
      expect(container.querySelector('[data-news-revision]')?.getAttribute('data-news-revision')).toBe(String(revision))
    }
  })

  it('routes same-symbol companies by the holding listing rather than ticker alone', async () => {
    await renderWatch()
    const base = state.store.positions[0]
    const airline = { ...base, id: 'airline', ticker: 'AAL', name: 'American Airlines', exchange: 'NASDAQ' as const }
    const miner = { ...base, id: 'miner', ticker: 'AAL', name: 'Anglo American plc', exchange: 'LSE' as const }
    vi.mocked(loadMarketEvents).mockResolvedValue({ events: [filing(airline), filing(miner)], issues: [], fetchedAt: Date.now() })
    state.store.positions = [airline, miner]
    state.store.liveQuotes = {}
    await restoreSaved(saved => { saved.rules = []; saved.alerts = [] })
    await rerender()
    await openTab('Company updates')
    for (const holding of [airline, miner]) {
      await clickButton(holding.name)
      await clickButton('Related news')
      expect(container.querySelector('[data-news-identity]')?.getAttribute('data-news-identity')).toBe(holdingIdentity(holding))
    }
  })
})

describe('Monitor privacy', () => {
  it('redacts reminders and rule labels without changing saved records', async () => {
    await renderWatch()
    await openTab('Company updates')
    await restoreSaved(saved => { saved.events = [{ id: 'reminder', holding: 'UP', holdingId: 'UP', title: 'Review UP tomorrow', date: '2099-01-01', kind: 'Reminder', reminder: true }] })
    const saved = localStorage.getItem(MONITOR_STORAGE_KEY)
    state.store.settings = { ...state.store.settings, hideValues: true }
    await rerender()
    expectPrivateWatch()
    expect(container.textContent).not.toContain('Review UP tomorrow')
    expect(localStorage.getItem(MONITOR_STORAGE_KEY)).toBe(saved)
    state.store.settings = { ...state.store.settings, hideValues: false }
    await rerender()
    expect(container.textContent).toContain('Review UP tomorrow')
    expect(container.querySelector('.mp-rule-condition svg')).not.toBeNull()
  })

  it('starts masked without naming holdings in the alert announcement', async () => {
    await renderWatch(true)
    expectPrivateWatch()
    expect(container.querySelector('.mp-toast-message')?.textContent).toBe('3 watch alerts added to notifications.')
  })
})
