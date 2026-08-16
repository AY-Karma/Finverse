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
})
