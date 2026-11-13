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
import type { Folio, LiveQuote, PortfolioSnapshot, Position, Settings } from './types'
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
import { applyNsePricing, preferNsePricing, type NsePricingCandidate } from './nsePricing'
import { nextNavRefreshAt as navRefreshDeadline } from './navRefreshSchedule'
import { loadCachedQuotes, saveCachedQuotes } from './liveQuoteCache'
import { BSE_PRICING_NOTICE, hasInrDenomination, normalizePosition } from './instruments'
import { combinedPositionMembers, hasSupportedValuationCurrency, quoteKey } from './valuation'
import { loadMonitorState } from './monitor'
import { remapMonitorReferences } from './workspaceReferences'
import { captureWorkspaceRecords, workspaceWritesBlocked, writeWorkspaceRecords } from './workspaceStorage'
import { latestUndoableAccount, planStatementImport, undoStatementImport, type StatementImportOptions } from './accountStatements'
import {
  isMarketOpen,
  resolveYahooSymbol,
  MANUAL_REFRESH_COOLDOWN_MS,
  CLOSED_QUOTE_RECHECK_MS,
  manualRefreshCheck,
  recordManualRefresh,
} from './live'

export type View = 'overview' | 'holdings' | 'insights' | 'research' | 'settings'

type RefreshResult =
  | { ok: true; retryInMs: number }
  | { ok: false; reason: 'disabled' | 'no-live-listings' | 'scheduled-nav' | 'cooldown' | 'failed'; retryInMs: number }

const EQUITY_REFRESH_MS = 1_000
const FAILED_QUOTE_REFRESH_MS = 30_000
const MAX_REFRESH_BACKOFF_MS = 5 * 60_000
const NAV_SLOT_WINDOW_MS = 60_000
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
  snapshot: InvestmentSnapshot
  portfolioHistory: PortfolioSnapshot[]
  marketDataRefreshing: boolean
  marketDataResult: LiveQuotesResult | null
  quoteLastCheckedAt: number | null
  quoteNextRefreshAt: number | null
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
  confirmNsePricing: (holdingId: string, candidate: NsePricingCandidate) => Promise<void>
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
  const [liveQuotes, setLiveQuotesState] = useState<Record<string, LiveQuote>>(() => savedSettings.allowExternalData
    ? loadCachedQuotes(folios.flatMap((folio) => folio.positions)) : {})
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>(() => loadPortfolioSnapshots())
  const [marketDataRefreshing, setMarketDataRefreshing] = useState(savedSettings.allowExternalData && folios.some((folio) => folio.positions.length > 0))
  const [marketDataResult, setMarketDataResult] = useState<LiveQuotesResult | null>(null)
  const [quoteLastCheckedAt, setQuoteLastCheckedAt] = useState<number | null>(null)
  const [quoteNextRefreshAt, setQuoteNextRefreshAt] = useState<number | null>(null)
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
  const liveQuotesRef = useRef(liveQuotes)
  const lastQuoteCacheWrite = useRef<number | null>(null)
  const activeRefreshControllers = useRef(new Set<AbortController>())
  const activeQuoteController = useRef<AbortController | null>(null)
  const activeNavController = useRef<AbortController | null>(null)
  const quoteResults = useRef<Partial<Record<'equity' | 'nav', LiveQuotesResult>>>({})
  const loadedQuoteKey = useRef<string | null>(null)
  const failedQuoteChecks = useRef(0)
  const lastQuoteCheck = useRef(0)
  const scheduleQuotes = useRef<((failed: boolean, checked?: boolean) => void) | null>(null)

  const assertCurrentWorkspace = useCallback(() => {
    if (workspaceChangedRef.current
      || (durableFoliosRef.current !== undefined && localStorage.getItem('finverse:folios') !== durableFoliosRef.current)
      || (durableSettingsRef.current !== undefined && localStorage.getItem('finverse:settings') !== durableSettingsRef.current)) {
      workspaceChangedRef.current = true
      setWorkspaceChanged(true)
      for (const controller of activeRefreshControllers.current) controller.abort()
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
      if (!event.key || !['finverse:folios', 'finverse:settings', 'finverse:monitor:v1', 'finverse:workspace-write:v1', 'finverse:investment-ledger:v1', 'finverse:market-cap:v1'].includes(event.key)) return
      workspaceChangedRef.current = true
      setWorkspaceChanged(true)
      for (const controller of activeRefreshControllers.current) controller.abort()
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])

  const setSettings = useCallback((s: Settings) => {
    try { assertCurrentWorkspace(); setSettingsState(s) }
    catch (cause) { setWorkspaceError(cause instanceof Error ? cause.message : 'Preferences could not be changed.') }
  }, [assertCurrentWorkspace])

  const holdings = useMemo(() => investmentWorkspace.prepareHoldings(folios), [folios])
  const valuation = useMemo(
    () => investmentWorkspace.readSnapshot({ folios, holdings, quotes: settings.allowExternalData ? liveQuotes : EMPTY_QUOTES }),
    [folios, holdings, liveQuotes, settings.allowExternalData],
  )
  const snapshot = useMemo(() => ({ ...valuation, history: portfolioHistory }), [valuation, portfolioHistory])
  const rawPositions = snapshot.rawPositions
  const positions = snapshot.positions
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const folioRefreshKey = useMemo(
    () => folios.map((folio) => `${folio.id}:${folio.positions.map((position) => position.instrumentKey).join(',')}`).join('|'),
    [folios],
  )
  useEffect(() => () => {
    for (const controller of activeRefreshControllers.current) {
      controller.abort()
      if (activeQuoteController.current === controller) activeQuoteController.current = null
    }
    activeRefreshControllers.current.clear()
  }, [folioRefreshKey, settings.allowExternalData])

  const setLiveQuotes = useCallback((q: Record<string, LiveQuote>) => {
    const current = liveQuotesRef.current
    const keys = Object.keys(q)
    if (keys.length === Object.keys(current).length && keys.every((key) => {
      const before = current[key], after = q[key]
      return before && before.price === after.price && before.at === after.at && before.source === after.source
        && before.fetchedAt === after.fetchedAt && before.change === after.change && before.changePct === after.changePct
    })) return current
    liveQuotesRef.current = q
    setLiveQuotesState(q)
    const now = Date.now()
    if (lastQuoteCacheWrite.current == null || now - lastQuoteCacheWrite.current >= 10_000) {
      saveCachedQuotes(positionsRef.current, q, now)
      lastQuoteCacheWrite.current = now
    }
    return q
  }, [])

  useEffect(() => {
    const flush = () => {
      if (!workspaceChangedRef.current) saveCachedQuotes(positionsRef.current, liveQuotesRef.current)
    }
    const visibility = () => { if (document.hidden) flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', visibility)
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', visibility); flush() }
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
    for (const controller of activeRefreshControllers.current) controller.abort()
    const activeKeys = new Set(next.flatMap((folio) => folio.positions).map(quoteKey))
    setLiveQuotes(Object.fromEntries(Object.entries(liveQuotesRef.current).filter(([key]) => activeKeys.has(key))))
    setFoliosState(next)
    if (history) setPortfolioHistory(history)
    window.dispatchEvent(new Event('finverse:monitor-restored'))
  }, [assertCurrentWorkspace, setLiveQuotes, settings])

  useEffect(() => {
    if (!settings.allowExternalData || !folios.length) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let busy = false
    const enrich = async () => {
      if (busy || document.hidden || controller.signal.aborted) return
      busy = true
      try {
        assertCurrentWorkspace()
        const original = foliosRef.current.flatMap((folio) => folio.positions)
        const enriched = await preferNsePricing(original, controller.signal)
        controller.signal.throwIfAborted()
        if (enriched === original) return
        const resolved = new Map(enriched.map((position) => [position.id, position]))
        const next = foliosRef.current.map((folio) => ({ ...folio,
          positions: folio.positions.map((position) => resolved.get(position.id) ?? position) }))
        await persistPortfolioChange(next)
      } catch {
        if (!controller.signal.aborted) timer = setTimeout(() => { void enrich() }, 5 * 60_000)
      } finally { busy = false }
    }
    void enrich()
    document.addEventListener('visibilitychange', enrich)
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', enrich) }
  }, [assertCurrentWorkspace, folioRefreshKey, persistPortfolioChange, settings.allowExternalData, folios.length])

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
    if (members.some((position) => !hasInrDenomination(position))) throw new Error('Import a corrected INR statement before reviewing this listing. Original unsupported amounts are retained.')
    const ids = new Set(members.map((position) => position.id))
    const next = foliosRef.current.map((folio) => ({ ...folio, positions: folio.positions.map((position) => {
      if (!ids.has(position.id)) return position
      const corrected = normalizePosition({ ...position, ...correction, ticker: correction.ticker.trim(), providerSymbol: correction.providerSymbol?.trim() || undefined, isin: correction.isin?.trim() || undefined, sector: correction.sector?.trim() || undefined, pricingListing: undefined, instrumentKey: undefined, identityVersion: 2, exchangeSource: 'explicit', identityIssue: undefined, reportedExchange: undefined, reportedCurrency: undefined })
      if (corrected.identityIssue && corrected.identityIssue !== BSE_PRICING_NOTICE) throw new Error(corrected.identityIssue)
      return corrected
    }) }))
    const history = loadPortfolioSnapshots().map((balance) => ({ ...balance, dataQuality: 'legacy-instrument-identity' as const }))
    await persistPortfolioChange(next, history)
  }, [persistPortfolioChange])

  const confirmNsePricing = useCallback(async (holdingId: string, candidate: NsePricingCandidate) => {
    if (!settings.allowExternalData) throw new Error('Enable external market data before approving NSE pricing.')
    const before = foliosRef.current.flatMap((folio) => folio.positions)
    const members = combinedPositionMembers(before).get(holdingId) ?? before.filter((position) => position.id === holdingId)
    if (!members.length) throw new Error('This holding is no longer available. Reload and try again.')
    if (members.some((position) => !hasSupportedValuationCurrency(position))) throw new Error('NSE pricing supports INR holdings only.')
    const ids = new Set(members.map((position) => position.id))
    const next = foliosRef.current.map((folio) => ({ ...folio, positions: folio.positions.map((position) =>
      ids.has(position.id) ? applyNsePricing(position, candidate) : position) }))
    const history = loadPortfolioSnapshots().map((balance) => ({ ...balance, dataQuality: 'legacy-instrument-identity' as const }))
    await persistPortfolioChange(next, history)
  }, [persistPortfolioChange, settings.allowExternalData])

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
      let imported = parsed.positions
      if (settings.allowExternalData) {
        const controller = new AbortController()
        activeRefreshControllers.current.add(controller)
        try {
          assertCurrentWorkspace()
          imported = await preferNsePricing(imported, controller.signal)
        } catch { /* An unavailable reference must not block an offline import. */ }
        finally { activeRefreshControllers.current.delete(controller) }
      }
      const summary = importIdentitySummary(imported)
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
    [assertCurrentWorkspace, settings.allowExternalData],
  )

  const balanceEventHistory = useCallback((next: Folio[], event: NonNullable<PortfolioSnapshot['event']>) => {
    const result = investmentWorkspace.readSnapshot({ folios: next, quotes: settings.allowExternalData ? liveQuotesRef.current : EMPTY_QUOTES })
    const history = loadPortfolioSnapshots()
    if (!result.valuationComplete) return history
    return updatePortfolioSnapshots({ at: Date.now(), value: result.currentValue, invested: result.invested, pnl: result.pnl, holdingCount: result.positions.length, event }, history)
  }, [settings.allowExternalData])

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

  // Equities and scheduled NAV batches have independent request lifecycles.
  const refreshQuoteGroup = useCallback(async (group: 'equity' | 'nav'): Promise<LiveQuotesResult | null> => {
    if (!settings.allowExternalData || workspaceChangedRef.current) return null
    assertCurrentWorkspace()
    const slot = group === 'equity' ? activeQuoteController : activeNavController
    if (slot.current && !slot.current.signal.aborted) return null
    const requested = positionsRef.current.filter((position) => (position.type === 'mutual-fund') === (group === 'nav'))
    if (!requested.length) return null
    const controller = new AbortController()
    slot.current = controller
    activeRefreshControllers.current.add(controller)
    const ownsIndicator = group === 'equity' || !positionsRef.current.some((position) => position.type !== 'mutual-fund' && resolveYahooSymbol(position))
    if (ownsIndicator) setMarketDataRefreshing(true)
    if (group === 'equity') setQuoteNextRefreshAt(null)
    const apply = (result: LiveQuotesResult) => {
      const activeKeys = new Set(positionsRef.current.map(quoteKey))
      const requestedKeys = new Set(requested.map(quoteKey))
      const merged = Object.fromEntries(Object.entries(liveQuotesRef.current).filter(([key]) => activeKeys.has(key)))
      for (const [key, quote] of Object.entries(result.quotes)) {
        if (!activeKeys.has(key) || !requestedKeys.has(key)) continue
        if (!merged[key] || merged[key].at <= quote.at) merged[key] = quote
      }
      const applied = setLiveQuotes(merged)
      quoteResults.current[group] = result
      const results = Object.values(quoteResults.current)
      setMarketDataResult({ quotes: applied, updated: results.reduce((sum, item) => sum + item.updated, 0),
        failed: results.reduce((sum, item) => sum + item.failed, 0), skipped: results.reduce((sum, item) => sum + item.skipped, 0) })
    }
    try {
      const result = await marketData.refreshQuotes(requested, liveQuotesRef.current, controller.signal, (partial) => {
        if (!controller.signal.aborted && !workspaceChangedRef.current) apply(partial)
      })
      controller.signal.throwIfAborted()
      assertCurrentWorkspace()
      apply(result)
      return result
    } catch (cause) {
      if (controller.signal.aborted || workspaceChangedRef.current) throw cause
      const result = { quotes: {}, updated: 0, failed: requested.length, skipped: 0 }
      apply(result)
      return result
    } finally {
      activeRefreshControllers.current.delete(controller)
      if (slot.current === controller) {
        slot.current = null
        if (ownsIndicator) setMarketDataRefreshing(false)
      }
    }
  }, [assertCurrentWorkspace, settings.allowExternalData, setLiveQuotes])

  const refreshNow = useCallback(async (): Promise<RefreshResult> => {
    try { assertCurrentWorkspace() }
    catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : 'Reload the workspace before requesting market data.')
      return { ok: false, reason: 'disabled', retryInMs: 0 }
    }
    if (!settings.allowExternalData || positionsRef.current.length === 0) return { ok: false, reason: 'disabled', retryInMs: 0 }
    const hasEquities = positionsRef.current.some((position) => position.type !== 'mutual-fund' && resolveYahooSymbol(position))
    if (!hasEquities) return { ok: false, reason: positionsRef.current.every((position) => position.type === 'mutual-fund') ? 'scheduled-nav' : 'no-live-listings', retryInMs: 0 }
    const slot = activeQuoteController
    if (slot.current && !slot.current.signal.aborted) return { ok: false, reason: 'cooldown', retryInMs: 1000 }
    const check = manualRefreshCheck()
    if (!check.allowed) return { ok: false, reason: 'cooldown', retryInMs: check.retryInMs ?? 0 }
    try {
      const result = await refreshQuoteGroup('equity')
      if (!result) return { ok: false, reason: 'cooldown', retryInMs: 1000 }
      const failed = result.failed > 0 && result.updated === 0 && result.skipped === 0
      scheduleQuotes.current?.(failed)
      if (failed) return { ok: false, reason: 'failed', retryInMs: 0 }
      recordManualRefresh()
      return { ok: true, retryInMs: MANUAL_REFRESH_COOLDOWN_MS }
    } catch {
      if (!workspaceChangedRef.current) scheduleQuotes.current?.(false, false)
      return { ok: false, reason: 'failed', retryInMs: 0 }
    }
  }, [assertCurrentWorkspace, settings.allowExternalData, refreshQuoteGroup])

  useEffect(() => {
    quoteResults.current = {}
    if (!settings.allowExternalData || positions.length === 0) {
      setMarketDataRefreshing(false)
      setMarketDataResult(null)
      setQuoteNextRefreshAt(null)
      setQuoteLastCheckedAt(null)
      loadedQuoteKey.current = null
    }
    if (!positionsRef.current.some((position) => position.type === 'mutual-fund' || resolveYahooSymbol(position))) {
      setMarketDataRefreshing(false)
      setQuoteNextRefreshAt(null)
    }
  }, [folioRefreshKey, settings.allowExternalData, positions.length])

  useEffect(() => {
    if (!settings.allowExternalData || !positionsRef.current.some((position) => position.type !== 'mutual-fund' && resolveYahooSymbol(position))) return
    let open = isMarketOpen()
    let closeRefreshPending = false
    let active = true
    let nextAt = 0
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const queue = () => {
      clearTimeout(refreshTimer)
      if (open && !document.hidden) refreshTimer = setTimeout(() => {
        updateMarket()
        if (open) void refresh()
      }, Math.max(0, nextAt - Date.now()))
    }
    const schedule = (failed: boolean, checked = true) => {
      if (!active) return
      if (checked) {
        lastQuoteCheck.current = Date.now()
        setQuoteLastCheckedAt(lastQuoteCheck.current)
      }
      failedQuoteChecks.current = failed ? Math.min(failedQuoteChecks.current + 1, 4) : 0
      nextAt = Date.now() + (failed ? Math.min(FAILED_QUOTE_REFRESH_MS * 2 ** failedQuoteChecks.current, MAX_REFRESH_BACKOFF_MS) : EQUITY_REFRESH_MS)
      setQuoteNextRefreshAt(open && !document.hidden ? nextAt : null)
      queue()
    }
    scheduleQuotes.current = schedule
    const refresh = async () => {
      if (!active || document.hidden || (activeQuoteController.current && !activeQuoteController.current.signal.aborted)) return
      loadedQuoteKey.current = folioRefreshKey
      try {
        const result = await refreshQuoteGroup('equity')
        if (active && result) schedule(result.failed > 0 && result.updated === 0 && result.skipped === 0)
      } catch {
        if (active && !workspaceChangedRef.current) schedule(false, false)
      }
    }
    if (loadedQuoteKey.current !== folioRefreshKey) void refresh()
    else schedule(false, false)
    const updateMarket = () => {
      const nowOpen = isMarketOpen()
      if (open && !nowOpen) closeRefreshPending = true
      const marketOpened = !open && nowOpen
      open = nowOpen
      if (marketOpened) { closeRefreshPending = false; void refresh() }
      else if (closeRefreshPending && !document.hidden && !activeQuoteController.current) {
        closeRefreshPending = false
        void refresh()
      }
      if (!open) setQuoteNextRefreshAt(null)
    }
    const timer = window.setInterval(updateMarket, EQUITY_REFRESH_MS)
    const visibility = () => {
      clearTimeout(refreshTimer)
      if (document.hidden) { setQuoteNextRefreshAt(null); return }
      updateMarket()
      if ((open && Date.now() >= nextAt) || loadedQuoteKey.current !== folioRefreshKey
        || (!open && Date.now() - lastQuoteCheck.current >= CLOSED_QUOTE_RECHECK_MS)) void refresh()
      else { setQuoteNextRefreshAt(open ? nextAt : null); queue() }
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      active = false
      activeQuoteController.current?.abort()
      if (scheduleQuotes.current === schedule) scheduleQuotes.current = null
      window.clearInterval(timer)
      clearTimeout(refreshTimer)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [folioRefreshKey, settings.allowExternalData, positions.length, refreshQuoteGroup])

  useEffect(() => {
    if (!settings.allowExternalData || !positionsRef.current.some((position) => position.type === 'mutual-fund')) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const scheduledAt = navRefreshDeadline()
      timer = setTimeout(() => {
        if (!active) return
        schedule()
        const lateness = Date.now() - scheduledAt
        // A suspended tab skips missed windows rather than fetching on return.
        if (document.hidden || lateness < 0 || lateness >= NAV_SLOT_WINDOW_MS) return
        void refreshQuoteGroup('nav').catch(() => {
          // Permission, workspace or identity changes cancel the old request.
        })
      }, Math.max(0, scheduledAt - Date.now()))
    }
    schedule()
    return () => {
      active = false
      activeNavController.current?.abort()
      clearTimeout(timer)
    }
  }, [folioRefreshKey, settings.allowExternalData, positions.length, refreshQuoteGroup])

  // Keep a small local performance history so the portfolio story survives
  // between sessions without sending holdings to a remote system.
  useEffect(() => {
    if (workspaceChangedRef.current) return
    try { assertCurrentWorkspace() } catch { return }
    if (snapshot.positions.length === 0 || !snapshot.valuationComplete || snapshot.currentValue <= 0) return
    // When external prices are enabled, wait for the first quote response.
    // Recording the imported fallback first created artificial intraday cliffs.
    if (settings.allowExternalData && (snapshot.lastUpdatedAt == null || !marketDataResult?.updated)) return
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
  }, [settings.allowExternalData, marketDataResult?.updated, snapshot.currentValue, snapshot.invested, snapshot.lastUpdatedAt, snapshot.pnl, snapshot.positions.length, snapshot.valuationComplete])

  const value = useMemo<Store>(() => ({
    folios,
    positions,
    rawPositions,
    liveQuotes,
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
    confirmNsePricing,
    quoteLastCheckedAt,
    quoteNextRefreshAt,
    workspaceReadOnly: workspaceChanged,
    settingsSaved: !settingsSaveFailed && !workspaceChanged,
    refreshNow,
  }), [folios, positions, rawPositions, liveQuotes, snapshot, portfolioHistory, marketDataRefreshing,
    marketDataResult, removeFolio, confirmFolioUnchanged, settings, setSettings, previewFile, commitImport, commitImports,
    undoLastImport, exportPortfolio, confirmFundScheme, confirmInstrument, confirmNsePricing, quoteLastCheckedAt, quoteNextRefreshAt, workspaceChanged, settingsSaveFailed, refreshNow])

  return <StoreContext.Provider value={value}>
    {!!snapshot.unsupportedCurrencyCount && <div className="folio-save-warning" role="status"><span>Partial INR totals. {snapshot.unsupportedCurrencyCount} holding{snapshot.unsupportedCurrencyCount === 1 ? '' : 's'} in unsupported native currencies excluded. Original amounts remain in exports.</span></div>}
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
