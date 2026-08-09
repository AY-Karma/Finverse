import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Folio, LiveQuote, Position, Settings } from './types'
import { flattenFolios, loadFolios, loadSettings, saveFolios, saveSettings } from './store'
import { parseSpreadsheet } from './spreadsheet'
import {
  fetchLiveQuotes,
  isMarketOpen,
  manualRefreshCheck,
  recordManualRefresh,
} from './live'

export type View = 'overview' | 'import' | 'assistant' | 'settings'

export type RefreshResult =
  | { ok: true }
  | { ok: false; reason: 'cooldown' | 'limit'; retryInMs: number }

const MARKET_CHECK_MS = 30_000 // how often the market-open state is re-evaluated
const REFRESH_MS = 60_000 // live quote refresh cadence during market hours

interface Store {
  folios: Folio[]
  positions: Position[]
  liveQuotes: Record<string, LiveQuote>
  setFolios: (f: Folio[]) => void
  addFolio: (name: string, positions: Position[]) => void
  removeFolio: (id: string) => void
  setSettings: (s: Settings) => void
  settings: Settings
  uploadFile: (file: File) => Promise<void>
  refreshNow: () => Promise<RefreshResult>
  quickMode: boolean
  setQuickMode: (v: boolean) => void
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [folios, setFoliosState] = useState<Folio[]>(() => loadFolios())
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings())
  const [liveQuotes, setLiveQuotesState] = useState<Record<string, LiveQuote>>({})
  const [quickMode, setQuickModeState] = useState(false)
  const liveQuotesRef = useRef<Record<string, LiveQuote>>({})

  useEffect(() => saveFolios(folios), [folios])
  useEffect(() => saveSettings(settings), [settings])

  const setFolios = useCallback((f: Folio[]) => setFoliosState(f), [])

  const addFolio = useCallback((name: string, positions: Position[]) => {
    setFoliosState((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name, importedAt: Date.now(), positions },
    ])
  }, [])

  const removeFolio = useCallback((id: string) => {
    setFoliosState((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const setSettings = useCallback((s: Settings) => setSettingsState(s), [])

  const setQuickMode = useCallback((v: boolean) => setQuickModeState(v), [])

  const positions = useMemo(() => flattenFolios(folios), [folios])

  const setLiveQuotes = useCallback((q: Record<string, LiveQuote>) => {
    liveQuotesRef.current = q
    setLiveQuotesState(q)
  }, [])

  const uploadFile = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer()
      const parsed = parseSpreadsheet(buffer)
      addFolio(file.name || 'Portfolio', parsed)
    },
    [addFolio],
  )

  // Manual refresh: fetches last-trade prices for every holding on demand,
  // regardless of market hours, bounded by a rate limit so the free quote
  // relays can't be spammed. `force` bypasses the once-per-day NAV guard.
  const refreshNow = useCallback(async (): Promise<RefreshResult> => {
    const check = manualRefreshCheck()
    if (!check.allowed) {
      return { ok: false, reason: check.reason ?? 'cooldown', retryInMs: check.retryInMs ?? 0 }
    }
    recordManualRefresh()
    try {
      const { quotes } = await fetchLiveQuotes(
        flattenFolios(folios),
        liveQuotesRef.current,
        { force: true },
      )
      setLiveQuotes(quotes)
    } catch {
      /* keep the previous quotes on any failure */
    }
    return { ok: true }
  }, [folios, setLiveQuotes])

  // Live-quote polling: only while the NSE market is open, only while the tab
  // is visible, and at most once every 60s. Stops entirely off-hours/holidays.
  useEffect(() => {
    if (settings.currency !== 'INR') return
    let open = isMarketOpen()
    let inFlight = false

    const refresh = async () => {
      if (!open || inFlight || document.hidden) return
      inFlight = true
      try {
        const { quotes } = await fetchLiveQuotes(
          flattenFolios(folios),
          liveQuotesRef.current,
        )
        setLiveQuotes(quotes)
      } catch {
        /* keep the previous quotes on any failure */
      } finally {
        inFlight = false
      }
    }

    const openTimer = window.setInterval(() => {
      open = isMarketOpen()
    }, MARKET_CHECK_MS)
    const refreshTimer = window.setInterval(refresh, REFRESH_MS)
    const onVisibility = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)

    void refresh() // one immediate fetch on load (if the market is open)

    return () => {
      window.clearInterval(openTimer)
      window.clearInterval(refreshTimer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [folios, settings.currency, setLiveQuotes])

  const value: Store = {
    folios,
    positions,
    liveQuotes,
    setFolios,
    addFolio,
    removeFolio,
    settings,
    setSettings,
    uploadFile,
    refreshNow,
    quickMode,
    setQuickMode,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
