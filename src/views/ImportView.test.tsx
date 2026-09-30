// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ImportView } from './ImportView'

const state = vi.hoisted(() => ({ previewFile: vi.fn(), commitImport: vi.fn(), folios: [], positions: [], removeFolio: vi.fn(), undoLastImport: vi.fn(), undoImportFolioId: null, exportPortfolio: vi.fn() }))
vi.mock('../useStore', () => ({ useStore: () => state }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('import exceptions', () => {
  it('shows rejected rows before committing only the accepted holdings', async () => {
    const preview = { id: 'preview', fileName: 'holdings.csv', positions: [{ id: 'valid', ticker: 'VALID', type: 'stock', currency: 'INR', quantity: 1, buyPrice: 100, invested: 100 }], duplicateCount: 0, unmatchedCount: 0, rejectedCount: 1, issues: [{ sheet: 'Sheet1', row: 3, field: 'Cost', message: 'Enter a numeric cost.' }] }
    state.previewFile.mockResolvedValue(preview)
    state.commitImport.mockClear()
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ImportView compact />))
      const input = container.querySelector('input[type="file"]')!
      Object.defineProperty(input, 'files', { value: [new File(['Ticker'], 'holdings.csv')] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('1 row rejected')
      expect(container.textContent).toContain('Sheet1, row 3, Cost: Enter a numeric cost.')
      expect(state.commitImport).not.toHaveBeenCalled()
      const confirm = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Add accepted holdings')!
      await act(async () => confirm.click())
      expect(state.commitImport).toHaveBeenCalledExactlyOnceWith(preview)
    } finally { await act(async () => root.unmount()) }
  })
})
