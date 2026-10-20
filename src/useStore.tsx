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
import { canConfirmFolioUnchanged } from './importFreshness'
import { loadFolios, loadSettings, saveFolios, saveSettings } from './store'
import { MAX_IMPORT_FILE_BYTES } from './importLimits'
import { exportPortfolioCsv, importIdentitySummary, investmentWorkspace, type InvestmentSnapshot } from './investmentWorkspace'
import { appendPortfolioSnapshot, loadPortfolioSnapshots, updatePortfolioSnapshots } from './portfolioHistory'
import { marketData } from './marketData'
import type { LiveQuotesResult } from './live'
import type { ImportRowIssue } from './spreadsheet'
import { createWorkspaceArchive } from './workspaceArchive'
import { canConfirmFundScheme, type FundSchemeCandidate } from './fundSchemes'
import { normalizePosition } from './instruments'
import { combinedPositionMembers, hasSupportedValuationCurrency } from './valuation'
import { loadMonitorState } from './monitor'
import { remapMonitorReferences } from './workspaceReferences'
import { captureWorkspaceRecords, workspaceWritesBlocked, writeWorkspaceRecords } from './workspaceStorage'
import { latestUndoableAccount, planStatementImport, undoStatementImport, type StatementImportOptions } from './accountStatements'
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
export type InstrumentCorrection = Pick<Position, 'ticker' | 'type' | 'exchange' | 'currency' | 'providerSymbol' | 'isin' | 'sector'>

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
  removeFolio: (id: string) => Promise<boolean>
  confirmFolioUnchanged: (id: string) => Promise<void>
  setSettings: (s: Settings) => void
  settings: Settings
  previewFile: (file: File) => Promise<ImportPreview>
  commitImport: (preview: ImportPreview, options?: StatementImportOptions) => Promise<boolean>
  commitImports: (previews: ImportPreview[], options: StatementImportOptions) => Promise<boolean>
  undoLastImport: () => Promise<boolean>
  undoImportFolioId: string | null
  exportPortfolio: (format: 'json' | 'csv') => void
  confirmFundScheme: (holdingId: string, candidate: FundSchemeCandidate) => Promise<void>
  confirmInstrument: (holdingId: string, correction: InstrumentCorrection) => Promise<void>
  workspaceReadOnly: boolean
  settingsSaved: boolean
  refreshNow: () => Promise<RefreshResult>
}

const StoreContext = createContext<Store | null>(null)

function readPersistedFolios(): string | null | undefined {
  try { return localStorage.getItem('finverse:folios') } catch { return undefined }
}

function readPersistedSettings(): string | null | undefined {
  try { return localStorage.getItem('finverse:settings') } catch { return undefined }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [folios, setFoliosState] = useState<Folio[]>(() => loadFolios())
  const [savedSettings, setSettingsState] = useState<Settings>(() => loadSettings())
  const [liveQuotes, setLiveQuotesState] = useState<Record<string, LiveQuote>>({})
  const [fxRate, setFxRateState] = useState<FxRate | null>(null)
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>(() => loadPortfolioSnapshots())
  const [marketDataRefreshing, setMarketDataRefreshing] = useState(savedSettings.allowExternalData)
  const [marketDataResult, setMarketDataResult] = useState<LiveQuotesResult | null>(null)
  const [folioSaveFailed, setFolioSaveFailed] = useState(false)
  const [settingsSaveFailed, setSettingsSaveFailed] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [workspaceChanged, setWorkspaceChanged] = useState(false)
  const settings = useMemo(() => workspaceChanged
    ? { ...savedSettings, allowExternalData: false } : savedSettings, [savedSettings, workspaceChanged])
  const workspaceChangedRef = useRef(false)
  const foliosRef = useRef(folios)
  foliosRef.current = folios
  const [initialDurableFolios] = useState(readPersistedFolios)
  const durableFoliosRef = useRef(initialDurableFolios)
  const [initialDurableSettings] = useState(readPersistedSettings)
  const durableSettingsRef = useRef(initialDurableSettings)
  const liveQuotesRef = useRef<Record<string, LiveQuote>>({})
  const manualRefreshControllers = useRef(new Set<AbortController>())

  const assertCurrentWorkspace = useCallback(() => {
    if (workspaceChangedRef.current
      || (durableFoliosRef.current !== undefined && localStorage.getItem('finverse:folios') !== durableFoliosRef.current)
      || (durableSettingsRef.current !== undefined && localStorage.getItem('finverse:settings') !== durableSettingsRef.current)) {
      workspaceChangedRef.current = true
      setWorkspaceChanged(true)
      for (const controller of manualRefreshControllers.current) controller.abort()
      throw new Error('This workspace changed in another tab. Reload before saving changes.')
    }
    if (workspaceWritesBlocked()) throw new Error('Workspace recovery is pending. Reload before saving changes.')
  }, [])

  useEffect(() => {
    if (workspaceChangedRef.current) return
    if (readPersistedFolios() !== durableFoliosRef.current) {
      workspaceChangedRef.current = true
      setWorkspaceChanged(true)
      return
    }
    const saved = durableFoliosRef.current != null ? !workspaceWritesBlocked() : saveFolios(foliosRef.current)
    setFolioSaveFailed(!saved)
    if (saved) durableFoliosRef.current = localStorage.getItem('finverse:folios')
  }, [initialDurableFolios])
  useEffect(() => {
    if (workspaceChangedRef.current) return
    try {
      assertCurrentWorkspace()
      const saved = saveSettings(savedSettings)
      setSettingsSaveFailed(!saved)
      if (saved) durableSettingsRef.current = readPersistedSettings()
    } catch (cause) {
      setSettingsSaveFailed(true)
      setWorkspaceError(cause instanceof Error ? cause.message : 'Preferences could not be saved.')
    }
  }, [savedSettings, assertCurrentWorkspace])
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (!event.key || !['finverse:folios', 'finverse:settings', 'finverse:monitor:v1', 'finverse:workspace-write:v1'].includes(event.key)) return
      workspaceChangedRef.current = true
      setWorkspaceChanged(true)
      for (const controller of manualRefreshControllers.current) controller.abort()
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])

  const setSettings = useCallback((s: Settings) => {
    try { assertCurrentWorkspace(); setSettingsState(s) }
    catch (cause) { setWorkspaceError(cause instanceof Error ? cause.message : 'Preferences could not be changed.') }
  }, [assertCurrentWorkspace])

  const holdings = useMemo(() => investmentWorkspace.prepareHoldings(folios), [folios])
  const snapshot = useMemo(
    () => investmentWorkspace.readSnapshot({ folios, holdings, quotes: settings.allowExternalData ? liveQuotes : EMPTY_QUOTES, fxRate, history: portfolioHistory }),
    [folios, holdings, liveQuotes, settings.allowExternalData, fxRate, portfolioHistory],
  )
  const rawPositions = snapshot.rawPositions
  const positions = snapshot.positions
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const folioRefreshKey = useMemo(
    () => folios.map((folio) => `${folio.id}:${folio.positions.map((position) => position.instrumentKey).join(',')}`).join('|'),
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

  const persistPortfolioChange = useCallback(async (next: Folio[], history?: PortfolioSnapshot[]) => {
    assertCurrentWorkspace()
    const before = foliosRef.current.flatMap((folio) => folio.positions)
    const loaded = loadMonitorState()
    if (loaded.error) throw new Error(loaded.error)
    const monitor = remapMonitorReferences(loaded.state, before, next.flatMap((folio) => folio.positions))
    createWorkspaceArchive(next, settings, history ?? loadPortfolioSnapshots(), monitor)
    const expected = captureWorkspaceRecords()
    await writeWorkspaceRecords({ ...expected, 'finverse:folios': JSON.stringify(next), 'finverse:monitor:v1': JSON.stringify({ version: 1, ...monitor }), ...(history ? { 'finverse:portfolio-snapshots': JSON.stringify(history) } : {}) }, expected, { keepRecoveryCopy: false })
    durableFoliosRef.current = localStorage.getItem('finverse:folios')
    foliosRef.current = next
    for (const controller of manualRefreshControllers.current) controller.abort()
    setLiveQuotes({})
    setFoliosState(next)
    if (history) setPortfolioHistory(history)
    window.dispatchEvent(new Event('finverse:monitor-restored'))
  }, [assertCurrentWorkspace, setLiveQuotes, settings])

  const confirmFolioUnchanged = useCallback(async (id: string) => {
    assertCurrentWorkspace()
    const target = foliosRef.current.find((folio) => folio.id === id)
    if (!target) throw new Error('This folio is no longer available. Reload and try again.')
    const reviewedAt = Date.now()
    if (!canConfirmFolioUnchanged(target, reviewedAt)) throw new Error('This folio is fresh. Review it again after 7 days.')
    const next = foliosRef.current.map((folio) => folio.id === id ? { ...folio, reviewedAt } : folio)
    const expected = captureWorkspaceRecords()
    await writeWorkspaceRecords({ ...expected, 'finverse:folios': JSON.stringify(next) }, expected, { keepRecoveryCopy: false, invalidateCaches: false })
    durableFoliosRef.current = localStorage.getItem('finverse:folios')
    foliosRef.current = next
    setFoliosState(next)
  }, [assertCurrentWorkspace])

  const confirmFundScheme = useCallback(async (holdingId: string, candidate: FundSchemeCandidate) => {
    if (!settings.allowExternalData) throw new Error('Enable external market data before confirming a provider scheme.')
    const before = foliosRef.current.flatMap((folio) => folio.positions)
    const members = combinedPositionMembers(before).get(holdingId) ?? before.filter((position) => position.id === holdingId)
    if (!members.length || members.some((position) => position.type !== 'mutual-fund' || !canConfirmFundScheme(position.name || position.ticker, candidate))) throw new Error('Choose a scheme compatible with this fund, plan and option.')
    if (members.some((position) => !hasSupportedValuationCurrency(position))) throw new Error('MFAPI NAV and history support INR mutual-fund holdings only. Original native amounts are retained.')
    const ids = new Set(members.map((position) => position.id))
    const next = foliosRef.current.map((folio) => ({ ...folio, positions: folio.positions.map((position) => ids.has(position.id)
      ? normalizePosition({ ...position, mfScheme: { code: candidate.schemeCode, name: candidate.schemeName, source: 'confirmed' } }) : position) }))
    const history = loadPortfolioSnapshots().map((balance) => ({ ...balance, dataQuality: 'legacy-instrument-identity' as const }))
    await persistPortfolioChange(next, history)
  }, [persistPortfolioChange, settings.allowExternalData])

  const confirmInstrument = useCallback(async (holdingId: string, correction: InstrumentCorrection) => {
    const before = foliosRef.current.flatMap((folio) => folio.positions)
    const members = combinedPositionMembers(before).get(holdingId) ?? before.filter((position) => position.id === holdingId)
    if (!members.length || members.some((position) => position.type === 'mutual-fund') || correction.type === 'mutual-fund') throw new Error('Choose a current equity or ETF listing to correct.')
    const ids = new Set(members.map((position) => position.id))
    const next = foliosRef.current.map((folio) => ({ ...folio, positions: folio.positions.map((position) => {
      if (!ids.has(position.id)) return position
      const corrected = normalizePosition({ ...position, ...correction, ticker: correction.ticker.trim(), providerSymbol: correction.providerSymbol?.trim() || undefined, isin: correction.isin?.trim() || undefined, sector: correction.sector?.trim() || undefined, instrumentKey: undefined, identityVersion: 2, exchangeSource: 'explicit', identityIssue: undefined, reportedExchange: undefined, reportedCurrency: undefined })
      if (corrected.identityIssue) throw new Error(corrected.identityIssue)
      return corrected
    }) }))
    const history = loadPortfolioSnapshots().map((balance) => ({ ...balance, dataQuality: 'legacy-instrument-identity' as const }))
    await persistPortfolioChange(next, history)
  }, [persistPortfolioChange])

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

  const balanceEventHistory = useCallback((next: Folio[], event: NonNullable<PortfolioSnapshot['event']>) => {
    const result = investmentWorkspace.readSnapshot({ folios: next, quotes: settings.allowExternalData ? liveQuotesRef.current : EMPTY_QUOTES, fxRate })
    const history = loadPortfolioSnapshots()
    if (!result.valuationComplete) return history
    return updatePortfolioSnapshots({ at: Date.now(), value: result.currentValue, invested: result.invested, pnl: result.pnl, holdingCount: result.positions.length, event }, history)
  }, [settings.allowExternalData, fxRate])

  const commitImports = useCallback(async (previews: ImportPreview[], options: StatementImportOptions) => {
    assertCurrentWorkspace()
    if (!previews.length) throw new Error('Choose a statement before importing.')
    if (options.operation === 'replace' && previews.length !== 1) throw new Error('Update one account with one complete statement at a time.')
    let next = foliosRef.current
    let lastPlan: ReturnType<typeof planStatementImport> | undefined
    for (const preview of previews) {
      const plan = planStatementImport(next, { preview, ...options, accountAlias: previews.length === 1 ? options.accountAlias : undefined })
      if (!plan.noOp) { next = plan.nextFolios; lastPlan = plan }
    }
    if (!lastPlan) return true
    const history = balanceEventHistory(next, { kind: options.operation === 'replace' ? 'account-update' : 'account-import', accountId: lastPlan.accountId, statementId: lastPlan.statementId })
    await persistPortfolioChange(next, history)
    setFolioSaveFailed(false)
    return true
  }, [assertCurrentWorkspace, balanceEventHistory, persistPortfolioChange])

  const commitImport = useCallback((preview: ImportPreview, options: StatementImportOptions = { operation: 'add', statementDate: null, complete: false }) => commitImports([preview], options), [commitImports])

  const undoLastImport = useCallback(async () => {
    try {
      const target = latestUndoableAccount(foliosRef.current)
      if (!target) return false
      const next = undoStatementImport(foliosRef.current, target.id)
      const statementId = next.find((folio) => folio.id === target.id)?.statement?.id ?? target.statement?.id ?? `legacy:${target.id}`
      await persistPortfolioChange(next, balanceEventHistory(next, { kind: 'account-undo', accountId: target.id, statementId }))
      return true
    } catch (cause) { setWorkspaceError(cause instanceof Error ? cause.message : 'The account change could not be undone.'); return false }
  }, [persistPortfolioChange, balanceEventHistory])

  const removeFolio = useCallback(async (id: string) => {
    try {
      const target = foliosRef.current.find((folio) => folio.id === id)
      if (!target) return false
      const next = foliosRef.current.filter((folio) => folio.id !== id)
      await persistPortfolioChange(next, balanceEventHistory(next, { kind: 'account-remove', accountId: id, statementId: target.statement?.id ?? `legacy:${id}` }))
      return true
    } catch (cause) { setWorkspaceError(cause instanceof Error ? cause.message : 'The account could not be removed.'); return false }
  }, [persistPortfolioChange, balanceEventHistory])

  const exportPortfolio = useCallback((format: 'json' | 'csv') => {
    setWorkspaceError('')
    try {
      const content = format === 'json' ? JSON.stringify(createWorkspaceArchive(folios, settings, portfolioHistory), null, 2) : exportPortfolioCsv(positions)
      const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `finverse-portfolio.${format}`
      link.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : 'The backup could not be created.')
    }
  }, [folios, positions, settings, portfolioHistory])

  // Manual refresh: fetches last-trade prices for every holding on demand,
  // regardless of market hours. The quote module deduplicates requests, bounds
  // concurrency, and keeps the daily NAV guard in place.
  const refreshNow = useCallback(async (): Promise<RefreshResult> => {
    try { assertCurrentWorkspace() }
    catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : 'Reload the workspace before requesting market data.')
      return { ok: false, reason: 'disabled', retryInMs: 0 }
    }
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
      const fxRefresh = settings.currency === 'USD' ? fetchUsdInrRate(controller.signal).catch(() => null) : Promise.resolve(null)
      const result = await marketData.refreshQuotes(positions, liveQuotesRef.current, controller.signal)
      controller.signal.throwIfAborted()
      setMarketDataResult(result)
      if (result.failed > 0 && result.updated === 0 && result.skipped === 0) {
        return { ok: false, reason: 'failed', retryInMs: 0 }
      }
      setLiveQuotes(result.quotes)
      recordManualRefresh()
      const rate = await fxRefresh
      controller.signal.throwIfAborted()
      if (rate) setFxRateState(rate)
      return { ok: true, retryInMs: MANUAL_REFRESH_COOLDOWN_MS }
    } catch {
      if (!controller.signal.aborted) setMarketDataResult({ quotes: liveQuotesRef.current, updated: 0, failed: positions.length, skipped: 0 })
      return { ok: false, reason: 'failed', retryInMs: 0 }
    } finally {
      controller.abort()
      manualRefreshControllers.current.delete(controller)
    }
  }, [assertCurrentWorkspace, positions, settings.allowExternalData, settings.currency, setLiveQuotes])

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
      if (workspaceChangedRef.current || inFlight || document.hidden) return
      try { assertCurrentWorkspace() } catch { return }
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
  }, [assertCurrentWorkspace, folioRefreshKey, settings.allowExternalData, setLiveQuotes])

  useEffect(() => {
    if (!settings.allowExternalData || settings.currency !== 'USD') {
      setFxRateState(null)
      return
    }
    let active = true
    const controller = new AbortController()
    const refresh = async () => {
      if (workspaceChangedRef.current) return
      try { assertCurrentWorkspace() } catch { return }
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
  }, [assertCurrentWorkspace, settings.allowExternalData, settings.currency])

  // Keep a small local performance history so the portfolio story survives
  // between sessions without sending holdings to a remote system.
  useEffect(() => {
    if (workspaceChangedRef.current) return
    try { assertCurrentWorkspace() } catch { return }
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

  const value = useMemo<Store>(() => ({
    folios,
    positions,
    rawPositions,
    liveQuotes,
    fxRate,
    snapshot,
    portfolioHistory,
    marketDataRefreshing,
    marketDataResult,
    removeFolio,
    confirmFolioUnchanged,
    settings,
    setSettings,
    previewFile,
    commitImport,
    commitImports,
    undoLastImport,
    undoImportFolioId: latestUndoableAccount(folios)?.id ?? null,
    exportPortfolio,
    confirmFundScheme,
    confirmInstrument,
    workspaceReadOnly: workspaceChanged,
    settingsSaved: !settingsSaveFailed && !workspaceChanged,
    refreshNow,
  }), [folios, positions, rawPositions, liveQuotes, fxRate, snapshot, portfolioHistory, marketDataRefreshing,
    marketDataResult, removeFolio, confirmFolioUnchanged, settings, setSettings, previewFile, commitImport, commitImports,
    undoLastImport, exportPortfolio, confirmFundScheme, confirmInstrument, workspaceChanged, settingsSaveFailed, refreshNow])

  return <StoreContext.Provider value={value}>
    {!!snapshot.unsupportedCurrencyCount && <div className="folio-save-warning" role="status"><span>Partial INR totals. {snapshot.unsupportedCurrencyCount} holding{snapshot.unsupportedCurrencyCount === 1 ? '' : 's'} in unsupported native currencies excluded. Native currency conversion is not supported; original amounts remain in exports.</span></div>}
    {workspaceChanged && <div className="folio-save-warning" role="alert"><span>This workspace changed in another tab. Reload before saving more changes.</span><button type="button" onClick={() => window.location.reload()}>Reload workspace</button></div>}
    {settingsSaveFailed && <div className="folio-save-warning" role="alert"><span>Preferences could not be saved. They will only last in this session. A workspace backup includes the current preferences.</span></div>}
    {workspaceError && <div className="folio-save-warning" role="alert"><span>{workspaceError}</span><button type="button" onClick={() => setWorkspaceError('')}>Dismiss</button></div>}
    {folioSaveFailed && <div className="folio-save-warning" role="alert">
      <span>Portfolio changes could not be saved in this browser. Export a backup before closing this tab.</span>
      <button type="button" onClick={() => exportPortfolio('json')}>Export backup</button>
      <button type="button" onClick={() => {
        try {
          assertCurrentWorkspace()
          const saved = saveFolios(foliosRef.current)
          setFolioSaveFailed(!saved)
          if (saved) durableFoliosRef.current = readPersistedFolios()
          const settingsSaved = saveSettings(savedSettings)
          setSettingsSaveFailed(!settingsSaved)
          if (settingsSaved) durableSettingsRef.current = readPersistedSettings()
        }
        catch (cause) { setWorkspaceError(cause instanceof Error ? cause.message : 'The workspace could not be saved.') }
      }}>Retry saving</button>
    </div>}
    {children}
  </StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
