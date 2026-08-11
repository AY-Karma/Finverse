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
import type { Folio, FxRate, LiveQuote, Position, Settings } from './types'
import { flattenFolios, loadFolios, loadSettings, saveFolios, saveSettings } from './store'
import { MAX_IMPORT_FILE_BYTES, parseSpreadsheet } from './spreadsheet'
import {
  fetchUsdInrRate,
  fetchLiveQuotes,
  isMarketOpen,
  manualRefreshCheck,
  recordManualRefresh,
} from './live'

export type View = 'overview' | 'import' | 'assistant' | 'settings'

export type RefreshResult =
  | { ok: true }
  | { ok: false; reason: 'disabled' | 'cooldown' | 'limit'; retryInMs: number }

const MARKET_CHECK_MS = 30_000 // how often the market-open state is re-evaluated
const REFRESH_MS = 60_000 // live quote refresh cadence during market hours

interface Store {
  folios: Folio[]
  positions: Position[]
  liveQuotes: Record<string, LiveQuote>
  fxRate: FxRate | null
  setFolios: (f: Folio[]) => void
  addFolio: (name: string, positions: Position[]) => void
  removeFolio: (id: string) => void
  setSettings: (s: Settings) => void
  settings: Settings
  uploadFile: (file: File) => Promise<void>
  refreshNow: () => Promise<RefreshResult>
  refreshFxRate: () => Promise<boolean>
  quickMode: boolean
  setQuickMode: (v: boolean) => void
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [folios, setFoliosState] = useState<Folio[]>(() => loadFolios())
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings())
  const [liveQuotes, setLiveQuotesState] = useState<Record<string, LiveQuote>>({})
  const [fxRate, setFxRateState] = useState<FxRate | null>(null)
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
      const extension = file.name.toLowerCase().split('.').pop()
      if (!extension || !['xlsx', 'xls', 'csv'].includes(extension)) {
        throw new Error('Use an .xlsx, .xls, or .csv portfolio file.')
      }
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        throw new Error('Portfolio files must be 10 MB or smaller.')
      }
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
    if (!settings.allowExternalData) {
      return { ok: false, reason: 'disabled', retryInMs: 0 }
    }
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
    if (settings.currency === 'USD') {
      const rate = await fetchUsdInrRate()
      if (rate) setFxRateState(rate)
    }
    return { ok: true }
  }, [folios, settings.allowExternalData, settings.currency, setLiveQuotes])

  // Live-quote polling: only while the NSE market is open, only while the tab
  // is visible, and at most once every 60s. Stops entirely off-hours/holidays.
  useEffect(() => {
    if (!settings.allowExternalData) return
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
  }, [folios, settings.allowExternalData, setLiveQuotes])

  // USD display converts the INR-denominated import using a short-lived rate.
  // The rate is intentionally kept in memory and fetched only after explicit
  // consent to external data requests.
  const refreshFxRate = useCallback(async (): Promise<boolean> => {
    if (!settings.allowExternalData || settings.currency !== 'USD') {
      setFxRateState(null)
      return false
    }
    const rate = await fetchUsdInrRate()
    if (!rate) return false
    setFxRateState(rate)
    return true
  }, [settings.allowExternalData, settings.currency])

  useEffect(() => {
    if (!settings.allowExternalData || settings.currency !== 'USD') {
      setFxRateState(null)
      return
    }
    let active = true
    const refresh = async () => {
      const rate = await fetchUsdInrRate()
      if (active && rate) setFxRateState(rate)
    }
    void refresh()
    const timer = window.setInterval(refresh, 15 * 60 * 1000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [settings.allowExternalData, settings.currency])

  const value: Store = {
    folios,
    positions,
    liveQuotes,
    fxRate,
    setFolios,
    addFolio,
    removeFolio,
    settings,
    setSettings,
    uploadFile,
    refreshNow,
    refreshFxRate,
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
