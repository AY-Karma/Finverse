// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Folio, Position } from '../types'
import { ImportView } from './ImportView'
import { ManageHoldings } from './ManageHoldings'

const state = vi.hoisted(() => ({
  folios: [] as Folio[], positions: [] as Position[],
  previewFile: vi.fn(), commitImport: vi.fn(), commitImports: vi.fn(), removeFolio: vi.fn(),
  exportPortfolio: vi.fn(), undoLastImport: vi.fn(), undoImportFolioId: null as string | null,
}))
vi.mock('../useStore', () => ({ useStore: () => state }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const position: Position = { id: 'holding', ticker: 'ABC', name: 'ABC', type: 'stock', quantity: 1, buyPrice: 100, lastPrice: 100, invested: 100 }
const folio: Folio = { id: 'import-one', name: 'holdings.xlsx', positions: [position], importedAt: 1234 }

beforeEach(() => {
  vi.clearAllMocks()
  state.commitImport.mockResolvedValue(true)
  state.commitImports.mockResolvedValue(true)
  state.undoLastImport.mockResolvedValue(true)
  state.folios = [folio]
  state.positions = [position]
  state.undoImportFolioId = folio.id
})

describe('holdings management', () => {
  it('shows each import age beside its filename and allows updates at every age', async () => {
    const now = Date.parse('2026-10-19T12:00:00Z')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    state.folios = [3, 14, 28].map((days, index) => ({
      ...folio, id: `account-${index}`, name: `holdings-${days}.xlsx`, importedAt: now - days * 86_400_000,
    }))
    const onRequestImport = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ManageHoldings onRequestImport={onRequestImport} reviewOpen={false} onReviewListings={vi.fn()} />))
      const rows = [...container.querySelectorAll('.folio-list > .folio-row')]
      expect(rows.map((row) => row.querySelector('.folio-title > .sym')?.nextElementSibling?.getAttribute('data-status'))).toEqual(['healthy', 'aging', 'old'])
      const importButton = [...container.querySelectorAll<HTMLButtonElement>('.manage-actions button')].find((button) => button.textContent === 'Import holdings')!
      expect(importButton.disabled).toBe(false)
      await act(async () => importButton.click())
      expect(onRequestImport).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      clock.mockRestore()
    }
  })

  it.each([['settings', ManageHoldings], ['import page', ImportView]])('requires confirmation and supports cancel on the %s', async (_, View) => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const findButton = (label: string) => [...container.querySelectorAll('button')].find((button) => button.textContent === label)!
    try {
      await act(async () => root.render(View === ManageHoldings ? <ManageHoldings onRequestImport={vi.fn()} reviewOpen={false} onReviewListings={vi.fn()} /> : <ImportView />))
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

  it('opens the shared import flow and keeps exports and confirmed undo available in settings', async () => {
    const onRequestImport = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)
    const findButton = (label: string) => [...container.querySelectorAll('button')].find((button) => button.textContent === label)!
    try {
      await act(async () => root.render(<ManageHoldings onRequestImport={onRequestImport} reviewOpen={false} onReviewListings={vi.fn()} />))
      expect(container.querySelector('.manage-actions')?.children).toHaveLength(4)
      await act(async () => findButton('Export CSV').click())
      await act(async () => findButton('Backup JSON').click())
      expect(state.exportPortfolio.mock.calls).toEqual([['csv'], ['json']])
      await act(async () => findButton('Undo import').click())
      expect(state.undoLastImport).not.toHaveBeenCalled()
      await act(async () => findButton('Confirm undo').click())
      expect(state.undoLastImport).toHaveBeenCalledOnce()
      await act(async () => findButton('Import holdings').click())
      expect(onRequestImport).toHaveBeenCalledOnce()
      expect(findButton('Import holdings').getAttribute('aria-haspopup')).toBe('dialog')
      expect(container.querySelector('.holdings-import')).toBeNull()
      expect(state.previewFile).not.toHaveBeenCalled()
      expect(state.commitImport).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps import available and disables export and undo when empty', async () => {
    state.folios = []
    state.positions = []
    state.undoImportFolioId = null
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ManageHoldings onRequestImport={vi.fn()} reviewOpen={false} onReviewListings={vi.fn()} />))
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('.manage-actions button')]
      expect(buttons.map((button) => button.disabled)).toEqual([false, true, false, true])
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps confirmed undo available after a failed save and describes persistent account undo', async () => {
    state.undoLastImport.mockResolvedValueOnce(false)
    const container = document.createElement('div')
    const root = createRoot(container)
    const undo = () => container.querySelector<HTMLButtonElement>('.undo-import')!
    try {
      await act(async () => root.render(<ManageHoldings onRequestImport={vi.fn()} reviewOpen={false} onReviewListings={vi.fn()} />))
      expect(undo().title).toContain('after reload')
      expect(undo().title).not.toContain('this session')
      await act(async () => undo().click())
      await act(async () => undo().click())
      expect(state.undoLastImport).toHaveBeenCalledOnce()
      expect(undo().textContent).toBe('Confirm undo')
      await act(async () => undo().click())
      expect(state.undoLastImport).toHaveBeenCalledTimes(2)
      expect(undo().textContent).toBe('Undo import')
    } finally { await act(async () => root.unmount()) }
  })
})
