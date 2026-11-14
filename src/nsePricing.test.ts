import './test/storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyNsePricing, loadNseInstrumentTypes, loadNsePricingCandidates, type NsePricingCandidate } from './nsePricing'
import { hasVerifiedNsePricing, normalizePosition } from './instruments'
import { loadFolios, loadSettings, saveFolios, saveSettings } from './store'
import { createWorkspaceArchive, parseWorkspaceArchive } from './workspaceArchive'
import { exportPortfolioCsv } from './investmentWorkspace'
import { parseSpreadsheetWithDiagnostics } from './spreadsheet'
import { quoteKey } from './valuation'
import { resolveYahooSymbol } from './live'
import { planStatementImport } from './accountStatements'
import type { Position } from './types'

const candidate: NsePricingCandidate = { exchange: 'NSE', type: 'stock', isin: 'INE467B01029', providerSymbol: 'TCS.NS' }
const imported = (): Position => normalizePosition({ id: 'bse-tcs', type: 'stock', ticker: '532540', name: 'TCS', exchange: 'BSE',
  isin: candidate.isin, quantity: 10, buyPrice: 100, invested: 1000, lastPrice: 120, currency: 'INR', exchangeSource: 'explicit' })

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear() })

describe('verified NSE valuation preference', () => {
  it('preserves imported BSE details while routing current and historical quote identity to NSE', () => {
    const before = imported()
    const result = applyNsePricing(before, candidate)
    expect(result).toMatchObject({ ticker: before.ticker, exchange: 'BSE', providerSymbol: '532540.BO', quantity: 10, buyPrice: 100, invested: 1000 })
    expect(result.identityIssue).toBeUndefined()
    expect(hasVerifiedNsePricing(result)).toBe(true)
    expect(resolveYahooSymbol(result)).toBe('TCS.NS')
    expect(quoteKey(result)).toBe(quoteKey(normalizePosition({ ...before, ticker: 'TCS', exchange: 'NSE', providerSymbol: 'TCS.NS', identityIssue: undefined })))
    expect(quoteKey(result)).not.toBe(quoteKey(before))
  })

  it.each([
    { ...candidate, isin: 'INE009A01021' },
    { ...candidate, type: 'etf' as const },
    { ...candidate, providerSymbol: 'TCS.BO' },
  ])('rejects incompatible security, type or venue %j', (mapping) => {
    expect(() => applyNsePricing(imported(), mapping)).toThrow('same ISIN and asset type')
  })

  it('round-trips the pricing source through browser storage, backups and CSV without replacing the import venue', () => {
    const result = applyNsePricing(imported(), candidate)
    const folios = [{ id: 'account', name: 'Account', importedAt: 1, positions: [result] }]
    saveFolios(folios)
    expect(loadFolios()[0].positions[0].pricingListing).toEqual(result.pricingListing)
    const archive = createWorkspaceArchive(folios, loadSettings(), [])
    expect(parseWorkspaceArchive(JSON.stringify(archive)).archive).toMatchObject({
      folios: [{ positions: [{ exchange: 'BSE', pricingListing: result.pricingListing }] }],
    })
    const csv = exportPortfolioCsv([result])
    const parsed = parseSpreadsheetWithDiagnostics(new TextEncoder().encode(csv).buffer as ArrayBuffer)
    expect(parsed.issues).toEqual([])
    expect(parsed.positions[0]).toMatchObject({ exchange: 'BSE', ticker: '532540', pricingListing: result.pricingListing })
    const tampered = JSON.parse(JSON.stringify(archive))
    tampered.folios[0].positions[0].pricingListing.isin = 'INE009A01021'
    expect(() => parseWorkspaceArchive(JSON.stringify(tampered))).toThrow('NSE pricing preference')
  })

  it('retains a verified preference on a same-ISIN account update, but never carries it to a different security', () => {
    const previous = applyNsePricing(imported(), candidate)
    const folios = [{ id: 'account', name: 'Account', importedAt: 1, statement: { id: 'old', fileName: 'old.csv', statementDate: '2026-10-28', completeness: 'complete' as const }, positions: [previous] }]
    const incoming = [imported(), { ...imported(), id: 'other', isin: 'INE009A01021' }]
    const plan = planStatementImport(folios, { operation: 'replace', accountId: 'account', expectedStatementId: 'old', complete: true, statementDate: '2026-10-29',
      preview: { id: 'new', fileName: 'new.csv', positions: incoming, duplicateCount: 0, unmatchedCount: 0, issues: [], rejectedCount: 0, createdAt: 1 } }, Date.parse('2026-10-30T06:00:00Z'))
    expect(plan.nextFolios[0].positions[0].pricingListing).toEqual(previous.pricingListing)
    expect(plan.nextFolios[0].positions[1].pricingListing).toBeUndefined()
  })

  it('only requests valid INR security ISINs and filters unexpected asset types', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ candidates: [candidate] }))
    vi.stubGlobal('fetch', fetcher)
    expect(await loadNsePricingCandidates([{ ...imported(), isin: undefined }])).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
    expect(await loadNsePricingCandidates([imported(), imported()])).toEqual([candidate])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(String(fetcher.mock.calls[0][0])).toContain(candidate.isin)
    expect(await loadNsePricingCandidates([{ ...imported(), type: 'etf' }])).toEqual([])
  })

  it('can identify an ETF when its imported type defaulted to stock, without approving a mismatched pricing preference', async () => {
    const etf = { ...candidate, type: 'etf' as const, providerSymbol: 'GOLDBEES.NS' }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ candidates: [etf] })))
    expect(await loadNseInstrumentTypes([imported()])).toEqual([etf])
    expect(await loadNsePricingCandidates([imported()])).toEqual([])
  })

  it('rejects unavailable and ambiguous provider results instead of approving guessed matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 502 })))
    await expect(loadNsePricingCandidates([imported()])).rejects.toThrow('could not be reached')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ candidates: [candidate, { ...candidate, providerSymbol: 'OTHER.NS' }] })))
    await expect(loadNsePricingCandidates([imported()])).rejects.toThrow('invalid matches')
  })

  it('removes the retired zero-second preference from saved settings and old backups', () => {
    const legacy = { ...loadSettings(), quoteRefreshSeconds: 0 }
    localStorage.setItem('finverse:settings', JSON.stringify(legacy))
    expect(loadSettings()).not.toHaveProperty('quoteRefreshSeconds')
    expect(JSON.parse(localStorage.getItem('finverse:settings')!)).not.toHaveProperty('quoteRefreshSeconds')
    saveSettings(legacy)
    expect(JSON.parse(localStorage.getItem('finverse:settings')!)).not.toHaveProperty('quoteRefreshSeconds')
    const archive = createWorkspaceArchive([], loadSettings(), [])
    const restored = parseWorkspaceArchive(JSON.stringify({ ...archive, settings: legacy }))
    expect(restored.archive.settings).not.toHaveProperty('quoteRefreshSeconds')
  })
})

describe('automatic NSE pricing preference', () => {
  beforeEach(() => vi.resetModules())

  it('maps a parsed BSE CSV by official ISIN without changing its imported financials or venue', async () => {
    const { preferNsePricing } = await import('./nsePricing')
    const csv = 'Symbol,Quantity,Average Price,Last Price,Exchange,ISIN\n532540,10,100,120,BSE,INE467B01029'
    const parsed = parseSpreadsheetWithDiagnostics(new TextEncoder().encode(csv).buffer as ArrayBuffer).positions
    const before = structuredClone(parsed[0])
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ candidates: [candidate] })))
    const [preferred] = await preferNsePricing(parsed)
    expect(preferred).toMatchObject({ ticker: before.ticker, exchange: 'BSE', providerSymbol: before.providerSymbol,
      isin: before.isin, quantity: 10, buyPrice: 100, invested: 1000, lastPrice: 120, currency: 'INR', pricingListing: candidate })
    expect(preferred.identityIssue).toBeUndefined()
    expect(resolveYahooSymbol(preferred)).toBe('TCS.NS')
    expect(parsed[0]).toEqual(before)
  })

  it('uses the exact official security type when the export called an ETF a stock', async () => {
    const { preferNsePricing } = await import('./nsePricing')
    const etf = { ...candidate, type: 'etf' as const, providerSymbol: 'GOLDBEES.NS' }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ candidates: [etf] })))
    const [preferred] = await preferNsePricing([imported()])
    expect(preferred.type).toBe('etf')
    expect(preferred.quantity).toBe(10)
    expect(preferred.exchange).toBe('BSE')
    expect(resolveYahooSymbol(preferred)).toBe('GOLDBEES.NS')
  })

  it('leaves BSE-only holdings on imported values and reuses verified no-match results for one hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { preferNsePricing } = await import('./nsePricing')
    const fetcher = vi.fn(async () => Response.json({ candidates: [] }))
    vi.stubGlobal('fetch', fetcher)
    const positions = [imported()]
    expect(await preferNsePricing(positions)).toBe(positions)
    vi.setSystemTime(Date.now() + 59 * 60_000)
    expect(await preferNsePricing(positions)).toBe(positions)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(resolveYahooSymbol(positions[0])).toBeNull()
    vi.setSystemTime(Date.now() + 60_000)
    await preferNsePricing(positions)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not send already-verified, missing-ISIN, foreign-currency, foreign-venue or fund holdings', async () => {
    const { preferNsePricing } = await import('./nsePricing')
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const positions = [applyNsePricing(imported(), candidate), { ...imported(), isin: undefined },
      { ...imported(), currency: undefined, reportedCurrency: 'EUR' }, { ...imported(), exchange: 'LSE' as const },
      { ...imported(), type: 'mutual-fund' as const }]
    expect(await preferNsePricing(positions)).toBe(positions)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('shares pending reference requests and reuses a completed exact match', async () => {
    const { preferNsePricing } = await import('./nsePricing')
    let release!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
    vi.stubGlobal('fetch', fetcher)
    const first = preferNsePricing([imported()])
    const second = preferNsePricing([{ ...imported(), id: 'another-account' }])
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    release(Response.json({ candidates: [candidate] }))
    expect((await first)[0].pricingListing).toMatchObject(candidate)
    expect((await second)[0].pricingListing).toMatchObject(candidate)
    await preferNsePricing([imported()])
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('rejects mismatched or ambiguous results without caching them as valid mappings', async () => {
    const { preferNsePricing } = await import('./nsePricing')
    const fetcher = vi.fn(async () => Response.json({ candidates: [{ ...candidate, isin: 'INE009A01021' }] }))
    vi.stubGlobal('fetch', fetcher)
    await expect(preferNsePricing([imported()])).rejects.toThrow('invalid matches')
    fetcher.mockImplementation(async () => Response.json({ candidates: [candidate, candidate] }))
    await expect(preferNsePricing([imported()])).rejects.toThrow('invalid matches')
    fetcher.mockImplementation(async () => Response.json({ candidates: [candidate] }))
    expect((await preferNsePricing([imported()]))[0].pricingListing).toMatchObject(candidate)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('honours cancellation before work and while an exact reference request is pending', async () => {
    const { preferNsePricing } = await import('./nsePricing')
    const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(preferNsePricing([imported()], cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
    const controller = new AbortController()
    const pending = preferNsePricing([imported()], controller.signal)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect((fetcher.mock.calls[0][1]!.signal as AbortSignal).aborted).toBe(true)
  })
})
