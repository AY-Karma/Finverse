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
vi.mock('../marketEvents', () => ({ loadMarketEvents: vi.fn() }))
beforeEach(() => { vi.mocked(loadMarketEvents).mockReset().mockResolvedValue({ events: [], issues: [], fetchedAt: Date.now() }) })
const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore> }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('./MonitorNewsPanel', () => ({ MonitorNewsPanel: ({ selectedIdentity, selectedRevision }: { selectedIdentity: string; selectedRevision: number }) => <section data-news-identity={selectedIdentity} data-news-revision={selectedRevision} /> }))

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
  const values = [...container.querySelectorAll('.pa-record-detail dd')]
  expect(values.length).toBeGreaterThan(0)
  expect(values.every(element => element.textContent === '\u2022'.repeat(6))).toBe(true)
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('single-page Monitor', () => {
  it('keeps market news available before importing holdings', async () => {
    await renderWatch()
    state.store.positions = []
    state.store.liveQuotes = {}
    await restoreSaved(saved => { saved.alerts = []; saved.rules = []; saved.events = [] })
    const importHoldings = vi.fn()
    await act(async () => root.render(<MonitorView onRequestImport={importHoldings} />))
    expect(container.querySelector('[data-news-identity]')).not.toBeNull()
    expect(container.querySelector('.mp-monitor-sidebar')).toBeNull()
    await clickButton('Import holdings')
    expect(importHoldings).toHaveBeenCalledOnce()
  })

  it('prefills watch and reminder forms from a selected company', async () => {
    await renderWatch()
    await clickButton('Open company: UP')
    expect(container.querySelector<HTMLDialogElement>('.mp-company-dialog')?.open).toBe(true)
    await clickButton('Create watch')
    const ruleForm = container.querySelector<HTMLDialogElement>('[aria-labelledby="mp-rule-title"]')!
    expect(ruleForm.open).toBe(true)
    expect(ruleForm.querySelector('select')?.value).toBe('UP')
    await clickButton('Close rule form')
    await clickButton('Open company: DOWN')
    await clickButton('Remind me')
    const reminderForm = container.querySelector<HTMLDialogElement>('[aria-labelledby="mp-reminder-title"]')!
    expect(reminderForm.open).toBe(true)
    expect(reminderForm.querySelector('select')?.value).toBe('DOWN')
  })

  it('makes every company filing available in a focusable feed without expansion', async () => {
    const filings: MarketEvent[] = Array.from({ length: 8 }, (_, index) => ({
      id: `filing-${index}`, symbol: 'UP', title: `Filing ${index}`, kind: 'filing', date: '2026-10-27', dateLabel: 'Published', publishedAt: Date.now() - index * 1000,
      source: 'NSE', sourceUrl: `https://nsearchives.nseindia.com/corporate/UP-${index}.pdf`, holdingId: 'UP', instrumentIdentity: '', holdingName: 'UP',
    }))
    vi.mocked(loadMarketEvents).mockResolvedValue({ events: filings, issues: [], fetchedAt: Date.now() })
    await renderWatch()
    const region = container.querySelector('[role="region"][aria-label="Company updates feed"]')!
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
    const filing: MarketEvent = { ...result, id: 'filing', kind: 'filing', date: '2026-10-27', dateLabel: 'Published', publishedAt: Date.now(), title: 'Investor presentation', sourceUrl: 'https://nsearchives.nseindia.com/corporate/UP_27102026.pdf' }
    vi.mocked(loadMarketEvents).mockResolvedValue({ events: [result, filing], issues: [], fetchedAt: Date.now() })
    await renderWatch()
    expect(container.querySelector('.mp-agenda-event time')?.getAttribute('datetime')).toBe(result.date)
    expect(container.querySelector('.mp-developments article > a')?.getAttribute('href')).toBe(filing.sourceUrl)
    await clickButton('Remind me: UP Quarterly results')
    const form = container.querySelector<HTMLDialogElement>('[aria-labelledby="mp-reminder-title"]')!
    expect(form.open).toBe(true)
    expect(form.querySelector('select')?.value).toBe('UP')
    expect(form.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(result.date)
    expect(form.querySelector<HTMLInputElement>('input:not([type])')?.value).toBe(result.title)
  })

  it('clears company context and aborts its event request when masking is enabled', async () => {
    vi.mocked(loadMarketEvents).mockImplementation(() => new Promise(() => {}))
    await renderWatch()
    const signal = vi.mocked(loadMarketEvents).mock.calls[0][1]?.signal
    await clickButton('Open company: UP')
    state.store.settings = { ...state.store.settings, hideValues: true }
    await rerender()
    expect(signal?.aborted).toBe(true)
    expect(container.querySelector('.mp-company-dialog, .mp-developments')).toBeNull()
    expectPrivateWatch()
  })

  it('leads with news on quiet days and keeps setup controls together', async () => {
    await renderWatch()
    state.store.liveQuotes = {}
    await restoreSaved(saved => { saved.alerts = []; saved.rules = []; saved.events = [] })
    await rerender()
    const content = container.querySelector('.mp-monitor-content')!
    expect(content.firstElementChild?.hasAttribute('data-news-identity')).toBe(true)
    expect(container.querySelector('.pa-attention, .pa-history, .mp-check-status')).toBeNull()
    const sidebar = container.querySelector('.mp-monitor-sidebar')!
    expect(sidebar.querySelector('.mp-rule-list')).not.toBeNull()
    expect(sidebar.querySelector('.pa-reminders')).not.toBeNull()
    expect([...sidebar.querySelectorAll('button')].some(button => button.textContent === '+ New rule')).toBe(true)
    expect(sidebar.querySelector('button[aria-label="Add reminder"]')).not.toBeNull()
  })

  it('keeps the initial mobile alert queue short and expands it on request', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    try {
      await renderWatch()
      expect(container.querySelectorAll('.pa-attention > .pa-record')).toHaveLength(1)
      expect(container.querySelector('.pa-attention .mp-badge')?.textContent).toBe('3 open')
      await clickButton('Show more alerts')
      expect(container.querySelectorAll('.pa-attention > .pa-record')).toHaveLength(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shows actionable alerts, reminders and rules together without duplicate portfolio views', async () => {
    await renderWatch()
    expect(container.querySelectorAll('.pa-attention > .pa-record')).toHaveLength(3)
    expect(container.querySelector('.pa-reminders')?.textContent).toContain('Upcoming')
    expect(container.querySelector('.mp-rule-list')?.textContent).toContain('UP')
    expect(container.querySelector('.pa-views, .pa-table, .pa-movers, .pa-pulse, [role="tablist"]')).toBeNull()
    const viewButtons = [...container.querySelectorAll('button')].filter(button => ['Brief', 'Holdings', 'Activity'].includes(button.textContent || ''))
    expect(viewButtons).toHaveLength(0)
  })

  it('moves reviewed alerts into history and reopens them without changing the page view', async () => {
    await renderWatch()
    await clickButton('Mark reviewed: UP')
    expect(container.querySelectorAll('.pa-attention > .pa-record')).toHaveLength(2)
    const history = container.querySelector<HTMLDetailsElement>('.pa-history')!
    expect(history.querySelector('summary')?.textContent).toContain('Reviewed & snoozed')
    await act(async () => { history.querySelector('summary')!.click() })
    expect(history.open).toBe(true)
    expect(history.querySelectorAll('.pa-record')).toHaveLength(1)
    expect(history.querySelector('.pa-record')?.textContent).toContain('Reviewed')
    await clickButton('Reopen item')
    expect(container.querySelector('.pa-history')).toBeNull()
    expect(container.querySelectorAll('.pa-attention > .pa-record')).toHaveLength(3)
    const saved = JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!)
    expect(saved.alerts.every((alert: { state: string }) => alert.state === 'open')).toBe(true)
  })

  it('keeps snoozed records accessible without treating them as open alerts', async () => {
    await renderWatch()
    const earliestDeadline = Date.now() + 24 * 3_600_000
    await clickButton('Snooze: UP')
    await clickButton('24 hours')
    expect(container.querySelectorAll('.pa-attention > .pa-record')).toHaveLength(2)
    expect(container.querySelector('.pa-history .pa-record')?.textContent).toContain('Snoozed')
    expect(container.querySelector('.pa-history button')?.textContent).toContain('Reopen item')
    const saved = JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!) as MonitorState
    expect(saved.alerts.find(alert => alert.state === 'snoozed')?.snoozedUntil).toBeGreaterThanOrEqual(earliestDeadline)
  })

  it('expands a bounded alert queue inline', async () => {
    await renderWatch()
    await restoreSaved(saved => {
      const alert = saved.alerts[0]
      saved.alerts = Array.from({ length: 8 }, (_, index) => ({ ...alert, id: `alert-${index}`, observationKey: `observation-${index}` }))
    })
    expect(container.querySelectorAll('.pa-attention > .pa-record')).toHaveLength(3)
    const more = [...container.querySelectorAll<HTMLElement>('button, summary')].find(button => button.textContent?.startsWith('Show more alerts'))!
    expect(more).toBeDefined()
    await act(async () => { more.click() })
    expect(container.querySelectorAll('.pa-attention > .pa-record').length).toBeGreaterThan(3)
  })

  it('does not imply all-clear when observations are unavailable', async () => {
    await renderWatch()
    state.store.liveQuotes = {}
    await restoreSaved(saved => { saved.alerts = [] })
    await rerender()
    expect(container.querySelectorAll('.pa-attention > .pa-record')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/all clear/i)
    expect(container.querySelector('.mp-check-status, .pa-attention')).toBeNull()
    expect(container.querySelector('.mp-rule-list')?.textContent).toContain('UP')
  })

  it('keeps local rules and reminders accessible while external data is off', async () => {
    await renderWatch()
    state.store.settings = { ...state.store.settings, allowExternalData: false }
    await rerender()
    expect(container.querySelector('.mp-hero')?.textContent).toContain('External data off')
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Refresh prices')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Add reminder"]')?.disabled).toBe(false)
    expect(container.querySelector('.mp-rule-list')?.textContent).toContain('UP')
    expect(container.querySelector('.pa-table, .pa-movers')).toBeNull()
  })

  it('keeps overdue personal reminders actionable and restores a turned-off reminder', async () => {
    await renderWatch()
    await restoreSaved(saved => {
      saved.events = [
        { id: 'overdue', holding: 'UP', holdingId: 'UP', title: 'Review old watch level', date: '2000-01-01', kind: 'Reminder', reminder: true },
        { id: 'future', holding: 'DOWN', holdingId: 'DOWN', title: 'Review future watch level', date: '2099-01-01', kind: 'Reminder', reminder: true },
      ]
    })
    const reminders = container.querySelector('.pa-reminders')!
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

  it('does not recreate fund NAV summaries, price moves or constituent news', async () => {
    await renderWatch()
    const fund = { ...state.store.positions[0], id: 'fund', ticker: 'FUND', name: 'Example Flexi Cap Fund', type: 'mutual-fund' as const }
    state.store.positions = [fund]
    state.store.liveQuotes = { [quoteKey(fund)]: { price: 83.14, source: 'nav', at: Date.now() } }
    await restoreSaved(saved => { saved.alerts = []; saved.rules = [] })
    await rerender()
    expect(container.querySelector('.mp-check-status')).toBeNull()
    expect(container.querySelectorAll('.pa-attention > .pa-record')).toHaveLength(0)
    expect(container.querySelector('.pa-news-button, .pa-table, .pa-movers')).toBeNull()
    expect(container.textContent).not.toContain('83.14')
  })

  it('repeats holding news selection with the same identity and a new revision', async () => {
    await renderWatch()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1 })
    for (const revision of [1, 2]) {
      await clickButton('Open company: UP')
      await clickButton('Related news')
      expect(container.querySelector('[data-news-identity]')?.getAttribute('data-news-identity')).toBe(holdingIdentity(state.store.positions[0]))
      expect(container.querySelector('[data-news-revision]')?.getAttribute('data-news-revision')).toBe(String(revision))
    }
  })

  it('routes same-symbol alerts by the holding listing rather than ticker alone', async () => {
    await renderWatch()
    const base = state.store.positions[0]
    const airline = { ...base, id: 'airline', ticker: 'AAL', name: 'American Airlines', exchange: 'NASDAQ' as const }
    const miner = { ...base, id: 'miner', ticker: 'AAL', name: 'Anglo American plc', exchange: 'LSE' as const }
    state.store.positions = [airline, miner]
    state.store.liveQuotes = {}
    await restoreSaved(saved => {
      const template = saved.alerts[0]
      saved.rules = []
      saved.alerts = [airline, miner].map(holding => ({ ...template, id: holding.id, holdingId: holding.id, holding: holding.name, observationKey: holding.id }))
    })
    await rerender()
    for (const holding of [airline, miner]) {
      await clickButton(`Open company: ${holding.name}`)
      await clickButton('Related news')
      expect(container.querySelector('[data-news-identity]')?.getAttribute('data-news-identity')).toBe(holdingIdentity(holding))
    }
  })
})

describe('Monitor privacy', () => {
  it('omits the observation strip in masked mode too', async () => {
    await renderWatch(true)
    expect(container.querySelector('.mp-check-status')).toBeNull()
  })

  it('redacts alerts, history, reminders and rule labels without changing saved records', async () => {
    await renderWatch()
    await clickButton('Mark reviewed: UP')
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
    expect(container.querySelector('[data-trend="up"]')).not.toBeNull()
    expect(container.querySelector('[data-trend="down"]')).not.toBeNull()
    expect(container.querySelector('.mp-rule-condition svg')).not.toBeNull()
  })

  it('starts neutral while masked and preserves review actions', async () => {
    await renderWatch(true)
    expectPrivateWatch()
    const review = container.querySelector<HTMLButtonElement>('.pa-attention .pa-review-actions button')!
    expect(review.textContent).toContain('Mark reviewed')
    await act(async () => { review.click() })
    expect(container.querySelectorAll('.pa-attention > .pa-record')).toHaveLength(2)
    expect(container.querySelectorAll('.pa-history .pa-record')).toHaveLength(1)
    expectPrivateWatch()
  })
})
