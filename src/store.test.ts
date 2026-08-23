import { describe, expect, it } from 'vitest'
import { sanitizeFolios } from './store'

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
