import { describe, expect, it } from 'vitest'
import { parseSpreadsheetInWorker } from './spreadsheetClient'

describe('spreadsheet client', () => {
  it('keeps parsing available when Web Workers are unavailable', async () => {
    const csv = new TextEncoder().encode([
      'Ticker,Quantity,Buy Price,Last Price',
      'INFY,2,100,125',
    ].join('\n')).buffer

    const positions = await parseSpreadsheetInWorker(csv)

    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({ ticker: 'INFY', quantity: 2, buyPrice: 100, lastPrice: 125 })
  })
})
