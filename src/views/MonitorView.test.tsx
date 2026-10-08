// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdingIdentity, MONITOR_STORAGE_KEY } from '../monitor'
import { loadSettings } from '../store'
import type { useStore } from '../useStore'
import { MonitorView } from './MonitorView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const state = vi.hoisted(() => ({ store: {} as ReturnType<typeof useStore> }))
vi.mock('../useStore', () => ({ useStore: () => state.store }))
vi.mock('./MonitorNewsPanel', () => ({ MonitorNewsPanel: ({ selectedIdentity, selectedRevision }: { selectedIdentity: string; selectedRevision: number }) => <section data-news-identity={selectedIdentity} data-news-revision={selectedRevision} /> }))

let root: Root
let container: HTMLDivElement

async function renderWatch(hideValues: boolean) {
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
      'EQ:UP': { price: 120, changePct: 10, at: Date.now(), source: 'yahoo' },
      'EQ:DOWN': { price: 80, changePct: -10, at: Date.now(), source: 'yahoo' },
    },
    settings: { ...loadSettings(), allowExternalData: true, hideValues },
    refreshNow: vi.fn(), marketDataRefreshing: false, marketDataResult: null,
  } as unknown as ReturnType<typeof useStore>
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
}

function expectNeutralWatch() {
  expect(container.querySelector('[data-tone="up"], [data-tone="down"], [data-trend="up"], [data-trend="down"]')).toBeNull()
  expect(container.querySelector('.mp-rule-condition svg')).toBeNull()
  expect(container.querySelector('.pa-panel')?.textContent).not.toMatch(/Daily move up|Daily move down|Price is above|Price is below|10\.00%|120\.00|80\.00/)
  expect(container.querySelector('.mp-rule-list')?.innerHTML).not.toMatch(/Price above|Price below|Daily move exceeds/)
  expect([...container.querySelectorAll('.pa-record-detail dd')].every((element) => element.textContent === '••••••')).toBe(true)
}

async function clickButton(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label || item.getAttribute('aria-label') === label)!
  expect(button).toBeDefined()
  await act(async () => { button.click() })
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  localStorage.clear()
})

describe('Portfolio Watch masking', () => {
  it('neutralizes quote and alert indicators, titles, and rule labels, then restores them', async () => {
    await renderWatch(false)
    expect(container.querySelector('[data-tone="up"]')).not.toBeNull()
    expect(container.querySelector('[data-tone="down"]')).not.toBeNull()
    expect(container.textContent).toContain('Daily move up 10.00%')
    const saved = localStorage.getItem(MONITOR_STORAGE_KEY)

    state.store.settings = { ...state.store.settings, hideValues: true }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expectNeutralWatch()
    expect(localStorage.getItem(MONITOR_STORAGE_KEY)).toBe(saved)

    state.store.settings = { ...state.store.settings, hideValues: false }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expect(container.querySelector('[data-trend="up"]')).not.toBeNull()
    expect(container.querySelector('[data-trend="down"]')).not.toBeNull()
    expect(container.querySelector('.mp-rule-condition svg')).not.toBeNull()
    expect(container.textContent).toContain('Daily move up 10.00%')
  })

  it('starts neutral when masking is already enabled', async () => {
    await renderWatch(true)
    expectNeutralWatch()
    const review = container.querySelector<HTMLButtonElement>('.pa-review-actions button')!
    expect(review.textContent).toContain('Mark reviewed')
    await act(async () => { review.click() })
    expect(container.querySelector('.pa-pulse')?.textContent).toContain('2 alerts')
    expectNeutralWatch()
  })

  it('keeps values and trends hidden across all three views and restores holding observations', async () => {
    await renderWatch(true)
    for (const view of ['Holdings', 'Activity', 'Brief']) {
      await clickButton(view)
      expectNeutralWatch()
    }
    await clickButton('Holdings')
    state.store.settings = { ...state.store.settings, hideValues: false }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expect(container.querySelector('.pa-table')?.textContent).toContain('120.00')
    expect(container.querySelector('.pa-table')?.textContent).toContain('80.00')
    expect(container.querySelectorAll('.pa-table-row')).toHaveLength(2)
    expect(container.querySelector('.pa-table-row[data-tone="down"]')).not.toBeNull()
  })

  it('keeps review history accessible after an alert leaves Brief', async () => {
    await renderWatch(false)
    await clickButton('Mark reviewed: UP')
    await clickButton('Activity')
    await clickButton('History')
    expect(container.querySelectorAll('.pa-record')).toHaveLength(1)
    expect(container.querySelector('.pa-record')?.textContent).toContain('Reviewed')
    await clickButton('Reopen item')
    expect(container.querySelector('.pa-record')).toBeNull()
    await clickButton('To review')
    expect(container.querySelectorAll('.pa-record')).toHaveLength(3)
  })

  it('opens only the alerts to review from the briefing summary', async () => {
    await renderWatch(false)
    await clickButton('Review 3 open watch alerts')
    expect(container.querySelector('.pa-ledger')).not.toBeNull()
    expect(container.querySelector('.pa-filters button[aria-pressed="true"]')?.textContent).toBe('To review')
    expect(container.querySelectorAll('.pa-record')).toHaveLength(3)
    expect(container.querySelector('.pa-record[data-tone="neutral"]')).toBeNull()
  })

  it.each([true, false])('toggles summary details and activity back to Brief with open alerts: %s', async (hasOpenAlerts) => {
    await renderWatch(false)
    if (!hasOpenAlerts) {
      for (let index = 0; index < 3; index += 1) {
        const review = container.querySelector<HTMLButtonElement>('button[aria-label^="Mark reviewed:"]')!
        await act(async () => { review.click() })
      }
    }
    const details = container.querySelector<HTMLButtonElement>('.pa-summary-footer button')!
    const activity = container.querySelector<HTMLButtonElement>('.pa-summary-review')!
    expect(activity.textContent).toContain(hasOpenAlerts ? 'Review alerts' : 'Open activity')

    await act(async () => { details.click() })
    expect(container.querySelector('.pa-holdings')).not.toBeNull()
    expect(details.getAttribute('aria-expanded')).toBe('true')
    expect(details.textContent).toContain('Hide details')
    await act(async () => { details.click() })
    expect(container.querySelector('.pa-holdings')).toBeNull()
    expect(container.querySelector('.pa-brief')).not.toBeNull()
    expect(details.getAttribute('aria-expanded')).toBe('false')

    await act(async () => { activity.click() })
    expect(container.querySelector('.pa-ledger')).not.toBeNull()
    expect(activity.getAttribute('aria-expanded')).toBe('true')
    expect(activity.textContent).toContain('Close activity')
    await act(async () => { activity.click() })
    expect(container.querySelector('.pa-ledger')).toBeNull()
    expect(container.querySelector('.pa-brief')).not.toBeNull()
    expect(activity.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.pa-views button[aria-pressed="true"]')?.textContent).toBe('Brief')

    await clickButton('Holdings')
    expect(details.getAttribute('aria-expanded')).toBe('true')
    await act(async () => { details.click() })
    expect(container.querySelector('.pa-brief')).not.toBeNull()
    await clickButton('Activity')
    await act(async () => { activity.click() })
    expect(container.querySelector('.pa-brief')).not.toBeNull()
  })

  it('shows a dated largest impact and masks its identity and breadth geometry', async () => {
    await renderWatch(false)
    state.store.liveQuotes = {
      ...state.store.liveQuotes,
      'EQ:UP': { ...state.store.liveQuotes['EQ:UP'], change: 20 },
      'EQ:DOWN': { ...state.store.liveQuotes['EQ:DOWN'], change: -30 },
    }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    const lead = container.querySelector('.pa-summary-lead')!
    expect(lead.querySelector('.pa-summary-value')?.textContent).toBe('−₹30.00')
    expect(lead.querySelector('.pa-summary-context')?.textContent).toContain('DOWN')
    expect(lead.querySelector('.pa-summary-time')?.textContent).toContain('IST')
    expect(lead.textContent).toContain('2 of 2 quote estimates')
    await clickButton('Details')
    expect(container.querySelector('.pa-table')).not.toBeNull()
    state.store.settings = { ...state.store.settings, hideValues: true }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expect(container.querySelector('.pa-summary-lead')?.textContent).not.toContain('DOWN')
    expect(container.querySelector('.pa-summary-value')?.textContent).toBe('••••••')
    expect(container.querySelector('.pa-summary-breadth + .pa-summary-rail')?.children).toHaveLength(0)
    expectNeutralWatch()
  })

  it('separates missing changes from flat moves and does not invent a monetary estimate', async () => {
    await renderWatch(false)
    state.store.liveQuotes = {
      ...state.store.liveQuotes,
      'EQ:DOWN': { price: 80, at: Date.now(), source: 'yahoo' },
    }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expect(container.querySelector('.pa-summary-lead .pa-summary-value')?.textContent).toBe('Not reported')
    expect(container.querySelector('.pa-summary-legend')?.textContent).toContain('0 flat')
    expect(container.querySelector('.pa-summary-legend')?.textContent).toContain('1 not reported')
    expect(container.querySelector('.pa-pulse')?.textContent).toContain('2 quotes · 0 daily NAVs')
  })

  it('shows a true zero impact separately from an unavailable fund NAV', async () => {
    await renderWatch(false)
    state.store.liveQuotes = Object.fromEntries(Object.entries(state.store.liveQuotes).map(([key, quote]) => [key, { ...quote, change: 0, changePct: 0 }]))
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expect(container.querySelector('.pa-summary-lead .pa-summary-value')?.textContent).toBe('₹0.00')
    expect(container.querySelector('.pa-summary-lead')?.textContent).toContain('Available impact estimates are zero')

    state.store.positions = [{ ...state.store.positions[0], ticker: 'FUND', name: 'Example Fund', type: 'mutual-fund' }]
    state.store.liveQuotes = {}
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expect(container.querySelector('.pa-summary-lead .pa-summary-value')?.textContent).toBe('Unavailable')
    expect(container.querySelector('.pa-summary-lead')?.textContent).toContain('No recent fund NAV is available')
    expect(container.querySelector('.pa-summary-lead')?.textContent).not.toContain('price change')
  })

  it('keeps large summary amounts compact while exposing the complete signed amount', async () => {
    await renderWatch(false)
    state.store.positions = state.store.positions.map((position) => ({ ...position, quantity: 10000 }))
    state.store.liveQuotes = { ...state.store.liveQuotes, 'EQ:UP': { ...state.store.liveQuotes['EQ:UP'], change: 20 } }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    const value = container.querySelector('.pa-summary-lead .pa-summary-value')!
    expect(value.textContent).toBe('+₹2L')
    expect(value.getAttribute('aria-label')).toBe('+₹2,00,000.00')
    expect(value.getAttribute('title')).toBe('+₹2,00,000.00')
  })

  it('uses imported prices and suppresses cached market movements when external data is disabled', async () => {
    await renderWatch(false)
    state.store.settings = { ...state.store.settings, allowExternalData: false }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expect(container.querySelector('.pa-movers')).toBeNull()
    await clickButton('Holdings')
    expect(container.querySelector('.pa-table')?.textContent).toContain('Imported price')
    expect(container.querySelector('.pa-table')?.textContent).not.toContain('120.00')
    expect(container.querySelectorAll('.pa-direction')).toHaveLength(4)
    expect([...container.querySelectorAll('.pa-direction')].every((item) => item.textContent === 'Unavailable')).toBe(true)
  })

  it('highlights each reported impact by its own sign and keeps missing or masked impacts neutral', async () => {
    await renderWatch(false)
    expect([...container.querySelectorAll('.pa-impact')].every((item) => item.getAttribute('data-trend') === 'neutral')).toBe(true)
    state.store.liveQuotes = {
      ...state.store.liveQuotes,
      'EQ:UP': { ...state.store.liveQuotes['EQ:UP'], change: 20 },
      'EQ:DOWN': { ...state.store.liveQuotes['EQ:DOWN'], change: -20 },
    }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expect(container.querySelector('.pa-impact[data-trend="up"]')?.textContent).toBe('+₹20.00')
    expect(container.querySelector('.pa-impact[data-trend="down"]')?.textContent).toBe('−₹20.00')
    expect(container.querySelector('.pa-mover[data-tone="down"] .pa-impact-line')?.textContent).toBe('Impact:−₹20.00')
    expect(container.querySelector('.pa-record summary [aria-label="Day move: +10.00%"]')).not.toBeNull()
    await clickButton('Holdings')
    expect(container.querySelector('.pa-impact[data-trend="up"]')?.textContent).toBe('+₹20.00')
    expect(container.querySelector('.pa-impact[data-trend="down"]')?.textContent).toBe('−₹20.00')
    state.store.settings = { ...state.store.settings, hideValues: true }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expectNeutralWatch()
    expect([...container.querySelectorAll('.pa-impact')].every((item) => item.textContent === '••••••')).toBe(true)
  })

  it('starts with a bounded holding list and reveals additional holdings on demand', async () => {
    await renderWatch(false)
    state.store.positions = Array.from({ length: 9 }, (_, index) => ({ ...state.store.positions[0], id: `holding-${index}`, ticker: `SYMBOL${index}`, name: `Holding ${index}` }))
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    await clickButton('Holdings')
    expect(container.querySelectorAll('.pa-table-row')).toHaveLength(6)
    await clickButton('Show more holdings · 3 remaining')
    expect(container.querySelectorAll('.pa-table-row')).toHaveLength(9)
  })

  it('repeats the holding news action even when the ticker has not changed', async () => {
    await renderWatch(false)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1 })
    const action = container.querySelector<HTMLButtonElement>('.pa-news-button[aria-label="View news for UP"]')!
    expect(action.textContent).toBe('View news')
    expect(action.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(action.textContent).not.toContain('↗')
    await clickButton('View news for UP')
    expect(container.querySelector('[data-news-identity]')?.getAttribute('data-news-identity')).toBe(holdingIdentity(state.store.positions[0]))
    expect(container.querySelector('[data-news-identity]')?.getAttribute('data-news-revision')).toBe('1')
    await clickButton('View news for UP')
    expect(container.querySelector('[data-news-identity]')?.getAttribute('data-news-revision')).toBe('2')
    await clickButton('Holdings')
    await clickButton('View news for UP')
    expect(container.querySelector('[data-news-identity]')?.getAttribute('data-news-revision')).toBe('3')
    vi.restoreAllMocks()
  })

  it('routes equal-ticker holdings to their own market identity', async () => {
    await renderWatch(false)
    const base = state.store.positions[0]
    const airline = { ...base, id: 'airline', ticker: 'AAL', name: 'American Airlines', exchange: 'NASDAQ' as const, currency: 'USD' as const }
    const miner = { ...base, id: 'miner', ticker: 'AAL', name: 'Anglo American plc', exchange: 'LSE' as const }
    state.store.positions = [airline, miner]
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    await clickButton('Holdings')
    for (const holding of [airline, miner]) {
      await clickButton(`View news for ${holding.name}`)
      expect(container.querySelector('[data-news-identity]')?.getAttribute('data-news-identity')).toBe(holdingIdentity(holding))
    }
  })

  it('shows published NAV updates without inventing fund moves or constituent news', async () => {
    await renderWatch(false)
    const fund = { ...state.store.positions[0], id: 'fund', ticker: 'FUND', name: 'Example Flexi Cap Fund', type: 'mutual-fund' as const }
    state.store.positions = [fund]
    state.store.liveQuotes = { 'MF:example flexi cap fund': { price: 83.14, source: 'nav', at: Date.now() } }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    const nav = container.querySelector('[aria-label="Latest published fund NAVs"]')!
    expect(nav.textContent).toContain('83.14')
    expect(nav.textContent).toContain('Published NAV')
    expect(nav.querySelector('button')).toBeNull()
    expect(container.querySelector('.pa-summary-lead')?.textContent).toContain('Latest published NAV')
    expect(container.querySelector('.pa-summary-lead .pa-summary-value')?.textContent).toBe('₹83.14')
    expect(container.querySelector('.pa-pulse')?.textContent).toContain('0 quotes · 1 daily NAV')
    expect(container.querySelector('.pa-movers[aria-label="Largest reported holding moves"]')).toBeNull()
    state.store.settings = { ...state.store.settings, hideValues: true }
    await act(async () => { root.render(<MonitorView onRequestImport={() => {}} />) })
    expect(container.textContent).not.toContain('83.14')
    expectNeutralWatch()
  })
})
