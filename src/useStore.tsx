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
import type { Folio, FxRate, LiveQuote, PortfolioSnapshot, Position, Settings } from './types'
import { loadFolios, loadSettings, saveFolios, saveSettings } from './store'
import { MAX_IMPORT_FILE_BYTES } from './importLimits'
import { exportPortfolioCsv, importIdentitySummary, investmentWorkspace, type InvestmentSnapshot } from './investmentWorkspace'
import { appendPortfolioSnapshot, loadPortfolioSnapshots } from './portfolioHistory'
import { marketData } from './marketData'
import type { LiveQuotesResult } from './live'
import {
  fetchUsdInrRate,
  isMarketOpen,
  MANUAL_REFRESH_COOLDOWN_MS,
  manualRefreshCheck,
  recordManualRefresh,
} from './live'

export type View = 'overview' | 'holdings' | 'insights' | 'research' | 'assistant' | 'settings'

export type RefreshResult =
  | { ok: true; retryInMs: number }
  | { ok: false; reason: 'disabled' | 'cooldown' | 'failed'; retryInMs: number }

const MARKET_CHECK_MS = 30_000 // how often the market-open state is re-evaluated
const REFRESH_MS = 5 * 60_000 // live quote refresh cadence during market hours (5m)

export interface ImportPreview {
  id: string
  fileName: string
  positions: Position[]
  duplicateCount: number
  unmatchedCount: number
  createdAt: number
}

interface Store {
  folios: Folio[]
  positions: Position[]
  /** The un-combined holdings exactly as imported (duplicates included). */
  rawPositions: Position[]
  liveQuotes: Record<string, LiveQuote>
  fxRate: FxRate | null
  snapshot: InvestmentSnapshot
  portfolioHistory: PortfolioSnapshot[]
  addFolio: (name: string, positions: Position[]) => void
  removeFolio: (id: string) => void
  setSettings: (s: Settings) => void
  settings: Settings
  previewFile: (file: File) => Promise<ImportPreview>
  commitImport: (preview: ImportPreview) => void
  uploadFile: (file: File) => Promise<void>
  undoLastImport: () => void
  exportPortfolio: (format: 'json' | 'csv') => void
  refreshNow: () => Promise<RefreshResult>
  quickMode: boolean
  setQuickMode: (v: boolean) => void
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [folios, setFoliosState] = useState<Folio[]>(() => loadFolios())
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings())
  const [liveQuotes, setLiveQuotesState] = useState<Record<string, LiveQuote>>({})
  const [fxRate, setFxRateState] = useState<FxRate | null>(null)
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>(() => loadPortfolioSnapshots())
  const [quickMode, setQuickModeState] = useState(false)
  const liveQuotesRef = useRef<Record<string, LiveQuote>>({})
  const lastImportedFolioId = useRef<string | null>(null)

  useEffect(() => saveFolios(folios), [folios])
  useEffect(() => saveSettings(settings), [settings])

  const addFolio = useCallback((name: string, positions: Position[]) => {
    const id = crypto.randomUUID()
    setFoliosState((prev) => [
      ...prev,
      { id, name, importedAt: Date.now(), positions: investmentWorkspace.normalizeImport(positions) },
    ])
    lastImportedFolioId.current = id
  }, [])

  const removeFolio = useCallback((id: string) => {
    setFoliosState((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const setSettings = useCallback((s: Settings) => setSettingsState(s), [])

  const setQuickMode = useCallback((v: boolean) => setQuickModeState(v), [])

  const snapshot = useMemo(
    () => investmentWorkspace.readSnapshot({ folios, quotes: liveQuotes, fxRate, history: portfolioHistory }),
    [folios, liveQuotes, fxRate, portfolioHistory],
  )
  const rawPositions = snapshot.rawPositions
  const positions = snapshot.positions
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const folioRefreshKey = useMemo(
    () => folios.map((folio) => `${folio.id}:${folio.positions.length}`).join('|'),
    [folios],
  )

  const setLiveQuotes = useCallback((q: Record<string, LiveQuote>) => {
    liveQuotesRef.current = q
    setLiveQuotesState(q)
  }, [])

  const previewFile = useCallback(
    async (file: File): Promise<ImportPreview> => {
      const extension = file.name.toLowerCase().split('.').pop()
      if (!extension || !['xlsx', 'xls', 'csv'].includes(extension)) {
        throw new Error('Use an .xlsx, .xls, or .csv portfolio file.')
      }
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        throw new Error('Portfolio files must be 10 MB or smaller.')
      }
      const buffer = await file.arrayBuffer()
      const { parseSpreadsheetInWorker } = await import('./spreadsheet')
      const parsed = await parseSpreadsheetInWorker(buffer)
      const summary = importIdentitySummary(parsed)
      return {
        id: crypto.randomUUID(),
        fileName: file.name || 'Portfolio',
        positions: summary.normalized,
        duplicateCount: summary.duplicateCount,
        unmatchedCount: summary.unmatchedCount,
        createdAt: Date.now(),
      }
    },
    [],
  )

  const commitImport = useCallback((preview: ImportPreview) => {
    addFolio(preview.fileName, preview.positions)
  }, [addFolio])

  const uploadFile = useCallback(async (file: File) => {
    const preview = await previewFile(file)
    commitImport(preview)
  }, [commitImport, previewFile])

  const undoLastImport = useCallback(() => {
    const id = lastImportedFolioId.current
    if (!id) return
    removeFolio(id)
    lastImportedFolioId.current = null
  }, [removeFolio])

  const exportPortfolio = useCallback((format: 'json' | 'csv') => {
    const content = format === 'json' ? JSON.stringify({ exportedAt: Date.now(), folios, positions }, null, 2) : exportPortfolioCsv(positions)
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `finverse-portfolio.${format}`
    link.click()
    URL.revokeObjectURL(url)
  }, [folios, positions])

  // Manual refresh: fetches last-trade prices for every holding on demand,
  // regardless of market hours. The quote module deduplicates requests, bounds
  // concurrency, and keeps the daily NAV guard in place.
  const refreshNow = useCallback(async (): Promise<RefreshResult> => {
    if (!settings.allowExternalData) {
      return { ok: false, reason: 'disabled', retryInMs: 0 }
    }
    const check = manualRefreshCheck()
    if (!check.allowed) {
      return { ok: false, reason: 'cooldown', retryInMs: check.retryInMs ?? 0 }
    }
    let result: LiveQuotesResult
    try {
      result = await marketData.refreshQuotes(positions, liveQuotesRef.current)
    } catch {
      return { ok: false, reason: 'failed', retryInMs: 0 }
    }
    if (result.failed > 0 && result.updated === 0 && result.skipped === 0) {
      return { ok: false, reason: 'failed', retryInMs: 0 }
    }
    setLiveQuotes(result.quotes)
    recordManualRefresh()
    if (settings.currency === 'USD') {
      const rate = await fetchUsdInrRate()
      if (rate) setFxRateState(rate)
    }
    return { ok: true, retryInMs: MANUAL_REFRESH_COOLDOWN_MS }
  }, [positions, settings.allowExternalData, settings.currency, setLiveQuotes])

  // Live-quote polling: every 30s while NSE market is open; one final fetch after
  // close to capture the official closing price; and one immediate fetch on load
  // (even off-hours) so the board always shows the latest available price.
  useEffect(() => {
    if (!settings.allowExternalData) return
    let open = isMarketOpen()
    let inFlight = false
    let hasFetchedAfterClose = false

    const refresh = async () => {
      if (inFlight || document.hidden) return
      inFlight = true
      try {
        const { quotes } = await marketData.refreshQuotes(positionsRef.current, liveQuotesRef.current)
        setLiveQuotes(quotes)
      } catch {
        /* keep the previous quotes on any failure */
      } finally {
        inFlight = false
      }
    }

    // One immediate fetch on load — gets live price during market hours,
    // or the previous day's close after hours.
    void refresh()

    const openTimer = window.setInterval(() => {
      const nowOpen = isMarketOpen()
      // Market just closed: do one final fetch to capture the official close.
      if (open && !nowOpen && !hasFetchedAfterClose) {
        hasFetchedAfterClose = true
        void refresh()
      }
      open = nowOpen
    }, MARKET_CHECK_MS)

    const refreshTimer = window.setInterval(() => {
      if (open) void refresh()
    }, REFRESH_MS)

    const onVisibility = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(openTimer)
      window.clearInterval(refreshTimer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [folioRefreshKey, settings.allowExternalData, setLiveQuotes])

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

  // Keep a small local performance history so the portfolio story survives
  // between sessions without sending holdings to a remote system.
  useEffect(() => {
    if (snapshot.positions.length === 0 || snapshot.currentValue <= 0) return
    // When external prices are enabled, wait for the first quote response.
    // Recording the imported fallback first created artificial intraday cliffs.
    if (settings.allowExternalData && snapshot.lastUpdatedAt == null) return
    setPortfolioHistory((current) => {
      const next = appendPortfolioSnapshot({
        at: Date.now(),
        value: snapshot.currentValue,
        invested: snapshot.invested,
        pnl: snapshot.pnl,
        holdingCount: snapshot.positions.length,
      }, current)
      return next.length === current.length && next[next.length - 1]?.at === current[current.length - 1]?.at ? current : next
    })
  }, [settings.allowExternalData, snapshot.currentValue, snapshot.invested, snapshot.lastUpdatedAt, snapshot.pnl, snapshot.positions.length])

  const value: Store = {
    folios,
    positions,
    rawPositions,
    liveQuotes,
    fxRate,
    snapshot,
    portfolioHistory,
    addFolio,
    removeFolio,
    settings,
    setSettings,
    previewFile,
    commitImport,
    uploadFile,
    undoLastImport,
    exportPortfolio,
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
