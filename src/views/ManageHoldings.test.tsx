// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Folio, Position } from '../types'
import { ImportView } from './ImportView'
import { ManageHoldings } from './ManageHoldings'

const state = vi.hoisted(() => ({
  folios: [] as Folio[], positions: [] as Position[],
  previewFile: vi.fn(), commitImport: vi.fn(), removeFolio: vi.fn(),
  exportPortfolio: vi.fn(), undoLastImport: vi.fn(), undoImportFolioId: null as string | null,
}))
vi.mock('../useStore', () => ({ useStore: () => state }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const position: Position = { id: 'holding', ticker: 'ABC', name: 'ABC', type: 'stock', quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100 }
const folio: Folio = { id: 'import-one', name: 'holdings.xlsx', positions: [position], importedAt: 1234 }

beforeEach(() => {
  vi.clearAllMocks()
  state.folios = [folio]
  state.positions = [position]
  state.undoImportFolioId = folio.id
})

describe('holdings management', () => {
  it.each([['settings', ManageHoldings], ['import page', ImportView]])('requires confirmation and supports cancel on the %s', async (_, View) => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const findButton = (label: string) => [...container.querySelectorAll('button')].find((button) => button.textContent === label)!
    try {
      await act(async () => root.render(<View />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove holdings.xlsx"]')!.click())
      expect(state.removeFolio).not.toHaveBeenCalled()
      expect(container.querySelector('[aria-label="Confirm deletion of holdings.xlsx"]')).not.toBeNull()
      await act(async () => findButton('Cancel').click())
      expect(state.removeFolio).not.toHaveBeenCalled()
      expect(container.querySelector('[aria-label="Confirm deletion of holdings.xlsx"]')).toBeNull()
      expect(container.textContent).toContain(folio.name)
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove holdings.xlsx"]')!.click())
      expect(document.activeElement).toBe(findButton('Cancel'))
      await act(async () => findButton('Cancel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(state.removeFolio).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(container.querySelector('[aria-label="Remove holdings.xlsx"]'))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove holdings.xlsx"]')!.click())
      await act(async () => findButton('Delete').click())
      expect(state.removeFolio).toHaveBeenCalledExactlyOnceWith(folio.id)
    } finally { await act(async () => root.unmount()); container.remove() }
  })

  it('keeps import review, exports and confirmed undo available in settings', async () => {
    const preview = { id: 'preview', fileName: 'new.csv', positions: [position], duplicateCount: 0, unmatchedCount: 0, rejectedCount: 0, issues: [] }
    state.previewFile.mockResolvedValue(preview)
    const container = document.createElement('div')
    const root = createRoot(container)
    const findButton = (label: string) => [...container.querySelectorAll('button')].find((button) => button.textContent === label)!
    try {
      await act(async () => root.render(<ManageHoldings />))
      expect(container.querySelector('.manage-actions')?.children).toHaveLength(4)
      await act(async () => findButton('Export CSV').click())
      await act(async () => findButton('Backup JSON').click())
      expect(state.exportPortfolio.mock.calls).toEqual([['csv'], ['json']])
      await act(async () => findButton('Undo import').click())
      expect(state.undoLastImport).not.toHaveBeenCalled()
      await act(async () => findButton('Confirm undo').click())
      expect(state.undoLastImport).toHaveBeenCalledOnce()
      await act(async () => findButton('Import holdings').click())
      expect(findButton('Close import').getAttribute('aria-expanded')).toBe('true')
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
      const file = new File(['Ticker'], 'new.csv')
      Object.defineProperty(input, 'files', { value: [file] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      expect(state.previewFile).toHaveBeenCalledExactlyOnceWith(file)
      expect(state.commitImport).not.toHaveBeenCalled()
      await act(async () => findButton('Add to portfolio').click())
      expect(state.commitImport).toHaveBeenCalledExactlyOnceWith(preview)
      await act(async () => findButton('Close import').click())
      expect(container.querySelector('input[type="file"]')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps import available and disables export and undo when empty', async () => {
    state.folios = []
    state.positions = []
    state.undoImportFolioId = null
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ManageHoldings />))
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('.manage-actions button')]
      expect(buttons.map((button) => button.disabled)).toEqual([false, true, true, true])
    } finally { await act(async () => root.unmount()) }
  })
})
