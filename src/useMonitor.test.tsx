// @vitest-environment jsdom
import { Activity, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyMonitorState, holdingIdentity, MONITOR_STORAGE_KEY } from './monitor'
import { useMonitor, type MonitorController } from './useMonitor'
import { loadSettings } from './store'
import type { LiveQuote, Position } from './types'
import { quoteKey } from './valuation'

const state = vi.hoisted(() => ({ positions: [] as Position[], liveQuotes: {} as Record<string, LiveQuote>, allowExternalData: false, workspaceReadOnly: false, refreshNow: vi.fn() }))
vi.mock('./useStore', () => ({ useStore: () => ({ positions: state.positions, liveQuotes: state.liveQuotes, settings: { ...loadSettings(), allowExternalData: state.allowExternalData }, workspaceReadOnly: state.workspaceReadOnly, refreshNow: state.refreshNow, marketDataRefreshing: false, marketDataResult: null }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { localStorage.clear(); state.positions = []; state.liveQuotes = {}; state.allowExternalData = false; state.workspaceReadOnly = false; state.refreshNow.mockReset(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('monitor workspace reload', () => {
  it.each([
    ['no-live-listings', 'No verified NSE match', 'Imported values are retained'],
    ['scheduled-nav', 'Mutual-fund NAVs', 'scheduled publication checks'],
  ])('explains %s without telling an enabled user to enable external data', async (reason, summary, detail) => {
    state.allowExternalData = true
    state.refreshNow.mockResolvedValue({ ok: false, reason, retryInMs: 0 })
    let controller!: MonitorController
    const Capture = () => { controller = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Capture />))
      await act(async () => controller.refresh())
      expect(controller.statusMessage).toContain(summary)
      expect(controller.statusMessage).toContain(detail)
      expect(controller.statusMessage).not.toContain('Enable external')
    } finally { await act(async () => root.unmount()) }
  })

  it('shares saved changes between controllers in one document without a tab-conflict warning', async () => {
    const controllers: MonitorController[] = []
    const Capture = ({ index }: { index: number }) => { controllers[index] = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    const issue = { id: 'xflot:shared', name: 'Shared IPO', status: 'OPEN' as const, openDate: '2030-01-01', closeDate: '2030-01-03', sourceUrl: 'https://www.xflot.com/ipo/shared' }
    try {
      await act(async () => root.render(<><Capture index={0} /><Capture index={1} /></>))
      await act(async () => { expect(controllers[0].addIpoWatch(issue)).toBe(true) })
      expect(controllers[1].ipoWatches.map((watch) => watch.id)).toEqual([issue.id])
      expect(controllers.every((controller) => !controller.statusMessage.includes('another tab'))).toBe(true)
      await act(async () => controllers[1].deleteIpoWatch(issue.id))
      expect(controllers[0].ipoWatches).toEqual([])
      expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).ipoWatches).toEqual([])
    } finally { await act(async () => root.unmount()) }
  })

  it('restores same-document changes when an Activity controller becomes visible again', async () => {
    const controllers: MonitorController[] = []
    const Capture = ({ index }: { index: number }) => { controllers[index] = useMonitor(); return null }
    const App = ({ monitor }: { monitor: boolean }) => <>
      <Activity mode={monitor ? 'hidden' : 'visible'}><Capture index={0} /></Activity>
      {monitor && <Capture index={1} />}
    </>
    const root = createRoot(document.createElement('div'))
    const issue = { id: 'xflot:revisit', name: 'Revisited IPO', status: 'OPEN' as const, openDate: '2030-01-01', closeDate: '2030-01-03', sourceUrl: 'https://www.xflot.com/ipo/revisit' }
    try {
      await act(async () => root.render(<App monitor={false} />))
      await act(async () => root.render(<App monitor />))
      await act(async () => { expect(controllers[1].addIpoWatch(issue)).toBe(true) })
      await act(async () => root.render(<App monitor={false} />))
      expect(controllers[0].ipoWatches.map((watch) => watch.id)).toEqual([issue.id])
      expect(controllers[0].statusMessage).not.toContain('another tab')
      await act(async () => controllers[0].deleteIpoWatch(issue.id))
      expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).ipoWatches).toEqual([])
    } finally { await act(async () => root.unmount()) }
  })

  it('shares evaluated rules and reading changes without replacing other saved fields', async () => {
    const position: Position = { id: 'holding', ticker: 'EXAMPLE', name: 'Example', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110 }
    state.positions = [position]
    state.allowExternalData = true
    state.liveQuotes = { [quoteKey(position)]: { price: 200, at: Date.now(), source: 'yahoo' } }
    const controllers: MonitorController[] = []
    const Capture = ({ index }: { index: number }) => { controllers[index] = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    const reading = { articles: [], follows: [{ id: 'banks', query: 'Banks', region: 'IN' as const }] }
    try {
      await act(async () => root.render(<><Capture index={0} /><Capture index={1} /></>))
      await act(async () => { expect(controllers[0].saveRule({ holdingId: position.id, condition: 'price_above', threshold: 120 })).toBe(true) })
      expect(controllers[1].rules).toHaveLength(1)
      expect(controllers[0].alerts).toHaveLength(1)
      expect(controllers[1].alerts).toHaveLength(1)
      await act(async () => { expect(controllers[1].updateReading(reading)).toBe(true) })
      expect(controllers[0].reading).toEqual(reading)
      const persisted = JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!)
      expect(persisted.rules).toHaveLength(1)
      expect(persisted.alerts).toHaveLength(1)
      expect(persisted.reading).toEqual(reading)
      expect(controllers.every((controller) => !controller.statusMessage.includes('another tab'))).toBe(true)
    } finally { await act(async () => root.unmount()) }
  })

  it('saves IPO watches without holdings, prevents duplicates and past issues, and persists removal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T08:00:00Z'))
    const issue = { id: 'xflot:example', name: 'Example', status: 'OPEN' as const, openDate: '2026-11-06', closeDate: '2026-11-08', sourceUrl: 'https://www.xflot.com/ipo/example' }
    let controller!: MonitorController
    const Capture = () => { controller = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Capture />))
      await act(async () => { expect(controller.addIpoWatch(issue)).toBe(true) })
      expect(controller.ipoWatches).toHaveLength(1)
      expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).ipoWatches[0]).toMatchObject({ id: issue.id, closeDate: issue.closeDate })
      await act(async () => {
        expect(controller.addIpoWatch(issue)).toBe(false)
        expect(controller.addIpoWatch({ ...issue, id: 'listed', status: 'LISTED' })).toBe(false)
        expect(controller.addIpoWatch({ ...issue, id: 'past', closeDate: '2026-11-07' })).toBe(false)
        expect(controller.addIpoWatch({ ...issue, id: 'unknown', closeDate: null })).toBe(false)
      })
      expect(controller.ipoWatches).toHaveLength(1)
      await act(async () => controller.deleteIpoWatch(issue.id))
      expect(controller.ipoWatches).toEqual([])
      expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).ipoWatches).toEqual([])
    } finally { await act(async () => root.unmount()) }
  })

  it('does not add an IPO watch when storage fails or the workspace is read-only', async () => {
    const issue = { id: 'xflot:example', name: 'Example', status: 'UPCOMING' as const, openDate: '2030-01-01', closeDate: '2030-01-03', sourceUrl: 'https://www.xflot.com/ipo/example' }
    let controller!: MonitorController
    const Capture = () => { controller = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Capture />))
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
      await act(async () => { expect(controller.addIpoWatch(issue)).toBe(false) })
      expect(controller.ipoWatches).toEqual([])
      expect(controller.statusMessage).toContain('could not be saved')
      state.workspaceReadOnly = true
      await act(async () => root.render(<Capture />))
      await act(async () => { expect(controller.addIpoWatch(issue)).toBe(false) })
      expect(controller.ipoWatches).toEqual([])
      expect(controller.statusMessage).toContain('Reload it before making changes')
    } finally { await act(async () => root.unmount()) }
  })

  it('writes each reading change once and still persists later rule changes', async () => {
    const position: Position = { id: 'holding', ticker: 'EXAMPLE', name: 'Example', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110 }
    state.positions = [position]
    let controller!: MonitorController
    const Capture = () => { controller = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Capture />))
      const writes = vi.spyOn(Storage.prototype, 'setItem')
      await act(async () => { expect(controller.updateReading({ articles: [], follows: [{ id: 'banks', query: 'Banks', region: 'IN' }] })).toBe(true) })
      expect(writes.mock.calls.filter(([key]) => key === MONITOR_STORAGE_KEY)).toHaveLength(1)
      writes.mockClear()
      await act(async () => { expect(controller.saveRule({ holdingId: position.id, condition: 'price_above', threshold: 120 })).toBe(true) })
      expect(writes.mock.calls.filter(([key]) => key === MONITOR_STORAGE_KEY)).toHaveLength(1)
      expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!)).toMatchObject({ rules: [{ threshold: 120 }], reading: { follows: [{ query: 'Banks' }] } })
    } finally { await act(async () => root.unmount()) }
  })

  it('persists timed snoozes, reopens them when due while data is off, and clears explicit reopens', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T10:00:00Z'))
    const now = Date.now()
    localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ version: 1, ...emptyMonitorState(), alerts: [{ id: 'alert', holdingId: 'removed', holding: 'Example', kind: 'price', state: 'open', observationKey: 'sample', at: now, time: '', title: '', reason: '', evidence: '', metrics: [] }] }))
    let controller!: MonitorController
    const Capture = () => { controller = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Capture />))
      await act(async () => { expect(controller.snoozeAlert('alert', now)).toBe(false) })
      await act(async () => { expect(controller.snoozeAlert('alert', now + 60_000)).toBe(true) })
      expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).alerts[0].snoozedUntil).toBe(now + 60_000)
      await act(async () => { vi.advanceTimersByTime(60_000) })
      expect(controller.alerts[0].state).toBe('open')
      expect(controller.alerts[0].snoozedUntil).toBeUndefined()
      await act(async () => { controller.setAlertState('alert', 'snoozed') })
      expect(controller.alerts[0].snoozedUntil).toBe(Date.now() + 86_400_000)
      await act(async () => { controller.setAlertState('alert', 'open') })
      expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).alerts[0].snoozedUntil).toBeUndefined()
    } finally { await act(async () => root.unmount()) }
  })

  it('saves reading state alongside rules and reloads it from the same workspace record', async () => {
    const position: Position = { id: 'holding', ticker: 'EXAMPLE', name: 'Example', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110 }
    state.positions = [position]
    let controller!: MonitorController
    const Capture = () => { controller = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    const reading = { articles: [], follows: [{ id: 'banks', query: 'Banks', region: 'IN' as const }] }
    try {
      await act(async () => root.render(<Capture />))
      await act(async () => { expect(controller.updateReading(reading)).toBe(true) })
      await act(async () => { expect(controller.saveRule({ holdingId: position.id, condition: 'price_above', threshold: 120 })).toBe(true) })
      expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).reading).toEqual(reading)
      await act(async () => window.dispatchEvent(new Event('finverse:monitor-restored')))
      expect(controller.reading).toEqual(reading)
      expect(controller.rules).toHaveLength(1)
      state.workspaceReadOnly = true
      await act(async () => root.render(<Capture />))
      await act(async () => { expect(controller.updateReading({ articles: [], follows: [] })).toBe(false) })
      expect(controller.reading).toEqual(reading)
    } finally { await act(async () => root.unmount()) }
  })

  it('does not claim reading preferences were saved when storage rejects the write', async () => {
    let controller!: MonitorController
    const Capture = () => { controller = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Capture />))
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
      await act(async () => { expect(controller.updateReading({ articles: [], follows: [{ id: 'banks', query: 'Banks', region: 'IN' }] })).toBe(false) })
      expect(controller.reading.follows).toEqual([])
      expect(controller.statusMessage).toContain('could not be saved')
    } finally { await act(async () => root.unmount()) }
  })

  it('reloads durable mapping changes and shows unresolved reminders without modifying their stored labels', async () => {
    const position: Position = { id: 'holding', ticker: 'EXAMPLE', name: 'Example', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110 }
    state.positions = [position]
    let controller!: MonitorController
    const Capture = () => { controller = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Capture />))
      const restored = {
        ...emptyMonitorState(),
        rules: [{ id: 'restored', holdingId: position.id, holding: position.name, instrumentIdentity: `${holdingIdentity(position)}-old`, condition: 'price_above', threshold: 120, active: true, unresolved: true }],
        events: [{ id: 'reminder', holdingId: 'removed', holding: 'Removed fund', title: 'Review fund', date: '2030-01-01', kind: 'Reminder', reminder: true, unresolved: true }],
      }
      localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ version: 1, ...restored }))
      await act(async () => window.dispatchEvent(new Event('finverse:monitor-restored')))
      expect(controller.rules[0]).toMatchObject({ id: 'restored', unresolved: true })
      expect(controller.counts.activeRules).toBe(0)
      expect(controller.counts.upcoming).toBe(0)
      expect(controller.events[0].holding).toBe('Removed fund · Holding unavailable')
      expect(controller.events[0].title).toBe('Review fund')
      expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!).events[0]).toMatchObject({ holding: 'Removed fund', title: 'Review fund', unresolved: true })
    } finally { await act(async () => root.unmount()) }
  })

  it('rejects an edit from stale mounted state instead of overwriting another tab’s rules', async () => {
    const position: Position = { id: 'holding', ticker: 'EXAMPLE', name: 'Example', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110 }
    state.positions = [position]
    let controller!: MonitorController
    const Capture = () => { controller = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Capture />))
      const external = JSON.stringify({ version: 1, ...emptyMonitorState(), rules: [{ id: 'other-tab', holdingId: position.id, holding: position.name, instrumentIdentity: holdingIdentity(position), condition: 'price_above', threshold: 120, active: false }] })
      localStorage.setItem(MONITOR_STORAGE_KEY, external)
      let saved = true
      await act(async () => { saved = controller.saveRule({ holdingId: position.id, condition: 'price_below', threshold: 90 }) })
      expect(saved).toBe(false)
      expect(JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY)!)).toEqual(JSON.parse(external))
      expect(controller.rules.map((rule) => rule.id)).toEqual(['other-tab'])
      expect(controller.statusMessage).toContain('changed in another tab')
    } finally { await act(async () => root.unmount()) }
  })

  it('blocks evaluation, writes and actions while the workspace is read-only', async () => {
    const position: Position = { id: 'holding', ticker: 'EXAMPLE', name: 'Example', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 110 }
    state.positions = [position]
    state.workspaceReadOnly = true
    state.allowExternalData = true
    state.liveQuotes = { [quoteKey(position)]: { price: 200, at: Date.now(), source: 'yahoo' } }
    const persisted = JSON.stringify({ version: 1, ...emptyMonitorState(), rules: [{ id: 'rule', holdingId: position.id, holding: position.name, instrumentIdentity: holdingIdentity(position), condition: 'price_above', threshold: 120, active: true }] })
    localStorage.setItem(MONITOR_STORAGE_KEY, persisted)
    let controller!: MonitorController
    const Capture = () => { controller = useMonitor(); return null }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Capture />))
      expect(controller.alerts).toEqual([])
      await act(async () => {
        expect(controller.saveRule({ holdingId: position.id, condition: 'price_below', threshold: 90 })).toBe(false)
        expect(controller.addReminder({ holdingId: position.id, title: 'Review', date: '2030-01-01' })).toBe(false)
        controller.toggleRule('rule')
        controller.deleteRule('rule')
        await controller.refresh()
      })
      expect(controller.rules[0].active).toBe(true)
      expect(controller.statusMessage).toContain('Reload it before making changes')
      expect(state.refreshNow).not.toHaveBeenCalled()
      expect(localStorage.getItem(MONITOR_STORAGE_KEY)).toBe(persisted)
    } finally { await act(async () => root.unmount()) }
  })
})
