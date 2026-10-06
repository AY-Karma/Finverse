// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSettings, sanitizeFolios, saveFolios, saveSettings } from './store'

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
    saveSettings({ ...preferences, apiKey: 'retired-key', provider: 'openai' } as typeof preferences)
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
  })
})

describe('saveFolios', () => {
  it('reports a storage failure without throwing', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new DOMException('Full', 'QuotaExceededError') } })
    expect(saveFolios([])).toBe(false)
  })

  it('reports a successful save', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    expect(saveFolios([])).toBe(true)
    expect(setItem).toHaveBeenCalledWith('finverse:folios', '[]')
  })
})

describe('sanitizeFolios', () => {
  it('rejects malformed persisted records', () => {
    expect(sanitizeFolios({ positions: [] })).toEqual([])
    expect(sanitizeFolios([null, { id: 'x', name: 'Broken', positions: 'nope' }])).toEqual([])
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
