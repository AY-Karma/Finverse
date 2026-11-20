// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { instrumentKey, normalizePosition } from './instruments'
import { livePace, nextPaceLevel, PACE_STEPS } from './livePace'
import { loadSettings } from './store'
import type { Position } from './types'
import { IdleWhenHidden, StoreProvider, useStore } from './useStore'
import * as live from './live'

const { refreshQuotes } = vi.hoisted(() => ({ refreshQuotes: vi.fn() }))
vi.mock('./marketData', () => ({ marketData: { refreshQuotes } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); refreshQuotes.mockReset() })

const stock: Position = { id: 'tcs', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120,
  exchange: 'NSE', exchangeSource: 'explicit', currency: 'INR', providerSymbol: 'TCS.NS', identityVersion: 2 }

describe('adaptive live-price pacing', () => {
  it('steps to 8s then 10s while frames or responses lag, and back after two calm windows', () => {
    expect(PACE_STEPS).toEqual([5_000, 8_000, 10_000])
    let pace = nextPaceLevel(0, { busy: 0.3, responseMs: 200 }, 0)
    expect(pace.level).toBe(1)
    pace = nextPaceLevel(pace.level, { busy: 0.01, responseMs: 2_000 }, pace.calmWindows)
    expect(pace.level).toBe(2)
    pace = nextPaceLevel(pace.level, { busy: 0.6, responseMs: null }, pace.calmWindows)
    expect(pace.level).toBe(2)
    pace = nextPaceLevel(pace.level, { busy: 0.01, responseMs: 300 }, pace.calmWindows)
    expect(pace).toEqual({ level: 2, calmWindows: 1 })
    pace = nextPaceLevel(pace.level, { busy: 0.01, responseMs: 300 }, pace.calmWindows)
    expect(pace).toEqual({ level: 1, calmWindows: 0 })
  })

  it('holds the current pace in the grey zone between calm and slow', () => {
    expect(nextPaceLevel(1, { busy: 0.1, responseMs: 300 }, 1)).toEqual({ level: 1, calmWindows: 0 })
    expect(nextPaceLevel(1, { busy: 0.01, responseMs: 1_000 }, 1)).toEqual({ level: 1, calmWindows: 0 })
  })

  it('puts every poller on the same beat, at least half an interval ahead, and restarts it on a manual refresh', () => {
    const restarted = vi.fn()
    const stop = livePace.onRestart(restarted)
    try {
      livePace.restartBeat(100_000)
      expect(restarted).toHaveBeenCalledTimes(1)
      expect(livePace.nextBeatAt(100_000)).toBe(105_000)
      expect(livePace.nextBeatAt(102_500)).toBe(105_000)
      expect(livePace.nextBeatAt(102_501)).toBe(110_000)
      expect(livePace.nextBeatAt(105_300)).toBe(110_000)
      livePace.setDemand(false)
      expect(livePace.nextBeatAt(105_300)).toBeNull()
    } finally {
      livePace.setDemand(true)
      livePace.restartBeat(0)
      stop()
    }
  })
})

describe('identity caching', () => {
  it('returns the same identity for the same object and recomputes for a replaced object', () => {
    expect(instrumentKey(stock)).toBe(instrumentKey(stock))
    expect(normalizePosition(stock)).toBe(normalizePosition(stock))
    expect(instrumentKey({ ...stock, providerSymbol: 'INFY.NS', ticker: 'INFY' })).not.toBe(instrumentKey(stock))
  })
})

describe('background price polling', () => {
  it('streams batches on the first load and commits background polls once', async () => {
    vi.useFakeTimers()
    vi.spyOn(live, 'isMarketOpen').mockReturnValue(true)
    localStorage.setItem('finverse:settings', JSON.stringify({ ...loadSettings(), allowExternalData: true }))
    localStorage.setItem('finverse:folios', JSON.stringify([{ id: 'f', name: 'h.xlsx', importedAt: Date.now(), positions: [stock] }]))
    refreshQuotes.mockResolvedValue({ quotes: {}, updated: 1, failed: 0, skipped: 0 })
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<StoreProvider><span /></StoreProvider>))
      await act(async () => { await vi.advanceTimersByTimeAsync(PACE_STEPS[0] * 2) })
      expect(refreshQuotes.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(typeof refreshQuotes.mock.calls[0][3]).toBe('function')
      expect(refreshQuotes.mock.calls.slice(1).every((call) => call[3] === undefined)).toBe(true)
    } finally { await act(async () => root.unmount()) }
  })
})

describe('hidden screens', () => {
  it('skip store updates while hidden and catch up in one render when shown', async () => {
    let store!: ReturnType<typeof useStore>
    let show!: (visible: boolean) => void
    const renders = { hidden: 0 }
    const Probe = () => { renders.hidden += 1; const { settings } = useStore(); return <span data-mode={settings.mode} /> }
    const Capture = () => { store = useStore(); return null }
    const Screen = () => {
      const [visible, setVisible] = useState(false)
      show = setVisible
      return <IdleWhenHidden visible={visible}><Probe /></IdleWhenHidden>
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<StoreProvider><Capture /><Screen /></StoreProvider>))
      const before = renders.hidden
      await act(async () => store.setSettings({ ...store.settings, mode: store.settings.mode === 'dark' ? 'light' : 'dark' }))
      expect(renders.hidden).toBe(before)
      const expected = store.settings.mode
      await act(async () => show(true))
      expect(renders.hidden).toBe(before + 1)
      expect(container.querySelector('span')?.dataset.mode).toBe(expected)
    } finally { await act(async () => root.unmount()) }
  })
})
