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

  it('does not include uploaded cell values in parse errors', async () => {
    const csv = new TextEncoder().encode([
      'Account holder,PAN,Client ID',
      'Sensitive Name,ABCDE1234F,SECRET-ACCOUNT',
    ].join('\n')).buffer

    try {
      await parseSpreadsheetInWorker(csv)
      throw new Error('Expected the import to fail')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      expect(message).toContain('No recognizable holdings header found')
      expect(message).not.toContain('Sensitive Name')
      expect(message).not.toContain('ABCDE1234F')
      expect(message).not.toContain('SECRET-ACCOUNT')
    }
  })
})
