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
import type { ImportRowIssue } from './spreadsheet'
import {
  fetchUsdInrRate,
  isMarketOpen,
  MANUAL_REFRESH_COOLDOWN_MS,
  manualRefreshCheck,
  recordManualRefresh,
} from './live'

export type View = 'overview' | 'holdings' | 'insights' | 'research' | 'settings'

type RefreshResult =
  | { ok: true; retryInMs: number }
  | { ok: false; reason: 'disabled' | 'cooldown' | 'failed'; retryInMs: number }

const MARKET_CHECK_MS = 30_000 // how often the market-open state is re-evaluated
const REFRESH_MS = 5 * 60_000 // live quote refresh cadence during market hours (5m)
const CLOSED_REFRESH_MS = 24 * 60 * 60_000
const FX_REFRESH_MS = 6 * 60 * 60_000 // Frankfurter publishes daily reference rates
const EMPTY_QUOTES: Record<string, LiveQuote> = {}

export interface ImportPreview {
  id: string
  fileName: string
  positions: Position[]
  duplicateCount: number
  unmatchedCount: number
  issues: ImportRowIssue[]
  rejectedCount: number
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
  marketDataRefreshing: boolean
  marketDataResult: LiveQuotesResult | null
  addFolio: (name: string, positions: Position[]) => void
  removeFolio: (id: string) => void
  setSettings: (s: Settings) => void
  settings: Settings
  previewFile: (file: File) => Promise<ImportPreview>
  commitImport: (preview: ImportPreview) => void
  undoLastImport: () => void
  undoImportFolioId: string | null
  exportPortfolio: (format: 'json' | 'csv') => void
  refreshNow: () => Promise<RefreshResult>
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [folios, setFoliosState] = useState<Folio[]>(() => loadFolios())
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings())
  const [liveQuotes, setLiveQuotesState] = useState<Record<string, LiveQuote>>({})
  const [fxRate, setFxRateState] = useState<FxRate | null>(null)
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>(() => loadPortfolioSnapshots())
  const [marketDataRefreshing, setMarketDataRefreshing] = useState(settings.allowExternalData)
  const [marketDataResult, setMarketDataResult] = useState<LiveQuotesResult | null>(null)
  const [folioSaveFailed, setFolioSaveFailed] = useState(false)
  const liveQuotesRef = useRef<Record<string, LiveQuote>>({})
  const lastImportedFolioId = useRef<string | null>(null)
  const manualRefreshControllers = useRef(new Set<AbortController>())

  useEffect(() => setFolioSaveFailed(!saveFolios(folios)), [folios])
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
    if (lastImportedFolioId.current === id) lastImportedFolioId.current = null
  }, [])

  const setSettings = useCallback((s: Settings) => setSettingsState(s), [])

  const snapshot = useMemo(
    () => investmentWorkspace.readSnapshot({ folios, quotes: settings.allowExternalData ? liveQuotes : EMPTY_QUOTES, fxRate, history: portfolioHistory }),
    [folios, liveQuotes, settings.allowExternalData, fxRate, portfolioHistory],
  )
  const rawPositions = snapshot.rawPositions
  const positions = snapshot.positions
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const folioRefreshKey = useMemo(
    () => folios.map((folio) => `${folio.id}:${folio.positions.length}`).join('|'),
    [folios],
  )
  useEffect(() => () => {
    for (const controller of manualRefreshControllers.current) controller.abort()
    manualRefreshControllers.current.clear()
  }, [folioRefreshKey, settings.allowExternalData])

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
      const { parseSpreadsheetPreviewInWorker } = await import('./spreadsheetClient')
      const parsed = await parseSpreadsheetPreviewInWorker(buffer)
      const summary = importIdentitySummary(parsed.positions)
      return {
        id: crypto.randomUUID(),
        fileName: file.name || 'Portfolio',
        positions: summary.normalized,
        duplicateCount: summary.duplicateCount,
        unmatchedCount: summary.unmatchedCount,
        issues: parsed.issues,
        rejectedCount: parsed.rejectedCount,
        createdAt: Date.now(),
      }
    },
    [],
  )

  const commitImport = useCallback((preview: ImportPreview) => {
    addFolio(preview.fileName, preview.positions)
  }, [addFolio])

  const undoLastImport = useCallback(() => {
    const id = lastImportedFolioId.current
    if (!id) return
    removeFolio(id)
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
    const controller = new AbortController()
    manualRefreshControllers.current.add(controller)
    try {
      const result = await marketData.refreshQuotes(positions, liveQuotesRef.current, controller.signal)
      controller.signal.throwIfAborted()
      setMarketDataResult(result)
      if (result.failed > 0 && result.updated === 0 && result.skipped === 0) {
        return { ok: false, reason: 'failed', retryInMs: 0 }
      }
      setLiveQuotes(result.quotes)
      recordManualRefresh()
      if (settings.currency === 'USD') {
        const rate = await fetchUsdInrRate(controller.signal)
        controller.signal.throwIfAborted()
        if (rate) setFxRateState(rate)
      }
      return { ok: true, retryInMs: MANUAL_REFRESH_COOLDOWN_MS }
    } catch {
      if (!controller.signal.aborted) setMarketDataResult({ quotes: liveQuotesRef.current, updated: 0, failed: positions.length, skipped: 0 })
      return { ok: false, reason: 'failed', retryInMs: 0 }
    } finally {
      manualRefreshControllers.current.delete(controller)
    }
  }, [positions, settings.allowExternalData, settings.currency, setLiveQuotes])

  // Live-quote polling: every 30s while NSE market is open; one final fetch after
  // close to capture the official closing price; and one immediate fetch on load
  // (even off-hours) so the board always shows the latest available price.
  useEffect(() => {
    if (!settings.allowExternalData) {
      setMarketDataRefreshing(false)
      setMarketDataResult(null)
      return
    }
    let open = isMarketOpen()
    let inFlight = false
    let closeRefreshPending = false
    let lastRefreshAt = 0
    let active = true
    const controller = new AbortController()

    const refresh = async () => {
      if (inFlight || document.hidden) return
      inFlight = true
      if (active) setMarketDataRefreshing(true)
      try {
        const result = await marketData.refreshQuotes(positionsRef.current, liveQuotesRef.current, controller.signal)
        if (active) {
          if (result.updated > 0 || result.skipped > 0 || result.failed === 0) lastRefreshAt = Date.now()
          setLiveQuotes(result.quotes)
          setMarketDataResult(result)
        }
      } catch {
        if (active) {
          setMarketDataResult({
            quotes: liveQuotesRef.current,
            updated: 0,
            failed: positionsRef.current.length,
            skipped: 0,
          })
        }
      } finally {
        inFlight = false
        if (active) setMarketDataRefreshing(false)
      }
    }

    // One immediate fetch on load — gets live price during market hours,
    // or the previous day's close after hours.
    void refresh()

    const openTimer = window.setInterval(() => {
      const nowOpen = isMarketOpen()
      // Market just closed: do one final fetch to capture the official close.
      if (open && !nowOpen) closeRefreshPending = true
      open = nowOpen
      if (closeRefreshPending && !document.hidden && !inFlight) {
        closeRefreshPending = false
        void refresh()
      }
    }, MARKET_CHECK_MS)

    const refreshTimer = window.setInterval(() => {
      if (open) void refresh()
    }, REFRESH_MS)

    const onVisibility = () => {
      if (document.hidden) return
      const nowOpen = isMarketOpen()
      const marketOpened = !open && nowOpen
      if (open && !nowOpen) closeRefreshPending = true
      if (marketOpened) closeRefreshPending = false
      open = nowOpen
      if (closeRefreshPending || marketOpened || Date.now() - lastRefreshAt >= (nowOpen ? REFRESH_MS : CLOSED_REFRESH_MS)) {
        if (closeRefreshPending && !inFlight) closeRefreshPending = false
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      active = false
      controller.abort()
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
    const controller = new AbortController()
    const refresh = async () => {
      const rate = await fetchUsdInrRate(controller.signal)
      if (active && rate) setFxRateState(rate)
    }
    void refresh()
    const timer = window.setInterval(refresh, FX_REFRESH_MS)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(timer)
    }
  }, [settings.allowExternalData, settings.currency])

  // Keep a small local performance history so the portfolio story survives
  // between sessions without sending holdings to a remote system.
  useEffect(() => {
    if (snapshot.positions.length === 0 || !snapshot.valuationComplete || snapshot.currentValue <= 0) return
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
  }, [settings.allowExternalData, snapshot.currentValue, snapshot.invested, snapshot.lastUpdatedAt, snapshot.pnl, snapshot.positions.length, snapshot.valuationComplete])

  const value: Store = {
    folios,
    positions,
    rawPositions,
    liveQuotes,
    fxRate,
    snapshot,
    portfolioHistory,
    marketDataRefreshing,
    marketDataResult,
    addFolio,
    removeFolio,
    settings,
    setSettings,
    previewFile,
    commitImport,
    undoLastImport,
    undoImportFolioId: folios.some((folio) => folio.id === lastImportedFolioId.current) ? lastImportedFolioId.current : null,
    exportPortfolio,
    refreshNow,
  }

  return <StoreContext.Provider value={value}>
    {folioSaveFailed && <div className="folio-save-warning" role="alert">
      <span>Portfolio changes could not be saved in this browser. Export a backup before closing this tab.</span>
      <button type="button" onClick={() => exportPortfolio('json')}>Export backup</button>
      <button type="button" onClick={() => setFolioSaveFailed(!saveFolios(folios))}>Retry saving</button>
    </div>}
    {children}
  </StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
