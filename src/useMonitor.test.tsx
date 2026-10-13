// @vitest-environment jsdom
import { act } from 'react'
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
afterEach(() => { localStorage.clear(); state.positions = []; state.liveQuotes = {}; state.allowExternalData = false; state.workspaceReadOnly = false; state.refreshNow.mockReset() })

describe('monitor workspace reload', () => {
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
