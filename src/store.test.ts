// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadFolios, loadSettings, sanitizeFolios, saveFolios, saveSettings } from './store'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

describe('settings persistence', () => {
  it('removes retired connection settings and browser data while preserving preferences and portfolios', () => {
    const preferences = {
      currency: 'USD', allowExternalData: true, density: 'compact', accent: 'custom',
      customAccent: '#7c6cff', mode: 'light', hideValues: true,
    }
    localStorage.setItem('finverse:settings', JSON.stringify({
      ...preferences, provider: 'openai', apiKey: 'retired-key', model: 'retired-model',
      baseUrl: 'https://retired.example', confirmRemoteOllama: true, monitorNewsApiKey: 'retired-news-key',
    }))
    const portfolio = JSON.stringify([{ id: 'saved', positions: [] }])
    localStorage.setItem('finverse:folios', portfolio)
    const retiredKeys = ['finverse:chat', 'finverse:quickMode', 'finverse:apiKey:session', 'finverse:monitorNewsApiKey:session']
    for (const key of retiredKeys) {
      localStorage.setItem(key, 'retired-value')
      sessionStorage.setItem(key, 'retired-value')
    }

    expect(loadSettings()).toEqual(preferences)
    expect(JSON.parse(localStorage.getItem('finverse:settings')!)).toEqual(preferences)
    expect(localStorage.getItem('finverse:folios')).toBe(portfolio)
    for (const key of retiredKeys) {
      expect(localStorage.getItem(key)).toBeNull()
      expect(sessionStorage.getItem(key)).toBeNull()
    }
  })

  it('saves only supported preferences even when an older caller supplies retired fields', () => {
    const preferences = loadSettings()
    expect(saveSettings({ ...preferences, apiKey: 'retired-key', provider: 'openai' } as typeof preferences)).toBe(true)
    expect(JSON.parse(localStorage.getItem('finverse:settings')!)).toEqual(preferences)
    expect(sessionStorage.length).toBe(0)
  })

  it.each(['null', '[]', '"old settings"', '{invalid'])('replaces malformed settings with defaults: %s', (raw) => {
    localStorage.setItem('finverse:settings', raw)
    const preferences = loadSettings()
    expect(preferences).toEqual({
      currency: 'INR', allowExternalData: false, density: 'comfortable',
      accent: 'indigo', mode: 'dark', hideValues: false,
    })
    expect(JSON.parse(localStorage.getItem('finverse:settings')!)).toEqual(preferences)
  })

  it('uses defaults when browser storage cannot be read, cleaned or saved', () => {
    const blocked = () => { throw new DOMException('Blocked', 'SecurityError') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    vi.stubGlobal('sessionStorage', { removeItem: blocked })
    expect(loadSettings()).toEqual({
      currency: 'INR', allowExternalData: false, density: 'comfortable',
      accent: 'indigo', mode: 'dark', hideValues: false,
    })
    expect(saveSettings(loadSettings())).toBe(false)
  })
})

describe('saveFolios', () => {
  it('reports a storage failure without throwing', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new DOMException('Full', 'QuotaExceededError') } })
    expect(saveFolios([])).toBe(false)
  })

  it('reports a successful save', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem })
    expect(saveFolios([])).toBe(true)
    expect(setItem).toHaveBeenCalledWith('finverse:folios', '[]')
  })
})

describe('sanitizeFolios', () => {
  it('preserves reviewed scheme mappings on save/reload and rekeys legacy fund identities', () => {
    const mfScheme = { code: 2, name: 'Example Equity Fund Direct IDCW', source: 'confirmed' as const }
    const folios = [{ id: 'folio', name: 'Portfolio', importedAt: 1, positions: [{ id: 'fund', ticker: 'Fund', name: 'Fund', type: 'mutual-fund' as const, quantity: 1, buyPrice: 100, lastPrice: 120, invested: 100, instrumentKey: 'MF:fund', mfScheme }] }]
    expect(saveFolios(folios)).toBe(true)
    expect(loadFolios()[0].positions[0]).toMatchObject({ mfScheme, instrumentKey: 'MF:mfapi:2' })
    const invalid = sanitizeFolios([{ ...folios[0], positions: [{ ...folios[0].positions[0], mfScheme: { ...mfScheme, code: '2' } }] }])
    expect(invalid[0].positions[0].mfScheme).toBeUndefined()
    expect(invalid[0].positions[0].instrumentKey).toBe('MF:fund')
  })

  it('rejects malformed persisted records', () => {
    expect(sanitizeFolios({ positions: [] })).toEqual([])
    expect(sanitizeFolios([null, { id: 'x', name: 'Broken', positions: 'nope' }])).toEqual([])
  })

  it('keeps active holdings but removes invalid or nested undo revisions', () => {
    const statement = { id: 'first', fileName: 'first.csv', statementDate: '2026-10-01', completeness: 'complete' }
    const position = { id: 'row', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 1, buyPrice: 100, lastPrice: 120, invested: 100 }
    const account = { id: 'account', name: 'Broker', importedAt: 2, positions: [position], statement, previousRevision: { statement, importedAt: 1, positions: [position] }, lastOperation: 'updated', operationAt: 2 }
    expect(sanitizeFolios([account])[0]).toMatchObject({ previousRevision: { statement }, lastOperation: 'updated', operationAt: 2 })
    const nested = sanitizeFolios([{ ...account, previousRevision: { ...account.previousRevision, previousRevision: account.previousRevision } }])[0]
    expect(nested.positions).toHaveLength(1)
    expect(nested.previousRevision).toBeUndefined()
    expect(nested.lastOperation).toBeUndefined()
    const invalidDate = sanitizeFolios([{ ...account, statement: { ...statement, statementDate: '2026-02-30' } }])[0]
    expect(invalidDate.statement).toBeUndefined()
  })

  it('keeps valid positions and removes invalid rows', () => {
    const result = sanitizeFolios([{
      id: 'folio-1',
      name: 'Portfolio',
      importedAt: 1,
      positions: [
        { id: 'p-1', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 2, buyPrice: 100, lastPrice: 110, invested: 200 },
        { id: 'bad', ticker: 'BAD', type: 'stock', quantity: '2', buyPrice: 100, invested: 200 },
      ],
    }])
    expect(result).toHaveLength(1)
    expect(result[0].positions).toHaveLength(1)
    expect(result[0].positions[0].providerSymbol).toBe('TCS.NS')
  })

  it('promotes legacy "other" rows that trade on a listed venue to stocks', () => {
    const result = sanitizeFolios([{
      id: 'folio-1',
      name: 'Portfolio',
      importedAt: 1,
      positions: [
        { id: 'p-1', ticker: 'RELIANCE', name: 'Reliance', type: 'other', quantity: 1, buyPrice: 100, invested: 100, exchange: 'NSE' },
        { id: 'p-2', ticker: 'AAPL', name: 'Apple', type: 'other', quantity: 1, buyPrice: 100, invested: 100, providerSymbol: 'AAPL' },
        { id: 'p-3', ticker: 'GOLD', name: 'Digital gold', type: 'other', quantity: 1, buyPrice: 50, invested: 50 },
        { id: 'p-4', ticker: 'UNK', name: 'Unknown listing', type: 'other', quantity: 1, buyPrice: 50, invested: 50, exchange: 'OTHER' },
      ],
    }])

    const types = Object.fromEntries(result[0].positions.map((position) => [position.id, position.type]))
    expect(types['p-1']).toBe('stock')
    expect(types['p-2']).toBe('stock')
    expect(types['p-3']).toBe('other')
    expect(types['p-4']).toBe('other')
  })

})
