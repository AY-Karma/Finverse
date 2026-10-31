import './test/storage'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyNsePricing, loadNsePricingCandidates, type NsePricingCandidate } from './nsePricing'
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

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

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

  it('rejects unavailable and ambiguous provider results instead of approving guessed matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 502 })))
    await expect(loadNsePricingCandidates([imported()])).rejects.toThrow('could not be reached')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ candidates: [candidate, { ...candidate, providerSymbol: 'OTHER.NS' }] })))
    await expect(loadNsePricingCandidates([imported()])).rejects.toThrow('invalid matches')
  })

  it.each([0, 60])('removes the retired %s-second preference from saved settings and old backups', (quoteRefreshSeconds) => {
    const legacy = { ...loadSettings(), quoteRefreshSeconds }
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
