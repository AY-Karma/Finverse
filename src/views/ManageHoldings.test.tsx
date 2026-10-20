// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Folio, Position } from '../types'
import { ImportView } from './ImportView'
import { ManageHoldings } from './ManageHoldings'

const state = vi.hoisted(() => ({
  folios: [] as Folio[], positions: [] as Position[],
  settings: { hideValues: false, allowExternalData: false },
  previewFile: vi.fn(), commitImport: vi.fn(), commitImports: vi.fn(), removeFolio: vi.fn(),
  exportPortfolio: vi.fn(), undoLastImport: vi.fn(), undoImportFolioId: null as string | null,
  confirmFolioUnchanged: vi.fn(),
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
  state.confirmFolioUnchanged.mockResolvedValue(undefined)
  state.folios = [folio]
  state.positions = [position]
  state.undoImportFolioId = folio.id
  state.settings.hideValues = false
})

describe('holdings management', () => {
  it('shows unchanged confirmation only after seven days and ignores repeat clicks while saving', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    state.folios = [
      { ...folio, id: 'new', importedAt: now },
      { ...folio, id: 'boundary', importedAt: now - 7 * 86_400_000 },
      { ...folio, id: 'aging', importedAt: now - 7 * 86_400_000 - 1 },
      { ...folio, id: 'reviewed', importedAt: 1234, reviewedAt: now },
    ]
    const container = document.createElement('div')
    const root = createRoot(container)
    const render = () => act(async () => root.render(<ManageHoldings onRequestImport={vi.fn()} reviewOpen={false} onReviewListings={vi.fn()} />))
    let finish!: () => void
    state.confirmFolioUnchanged.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    try {
      await render()
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('.folio-review-actions button')].filter((button) => button.textContent === 'Holdings unchanged')
      expect(buttons).toHaveLength(1)
      await act(async () => { buttons[0].click(); buttons[0].click(); buttons[0].click() })
      expect(state.confirmFolioUnchanged).toHaveBeenCalledExactlyOnceWith('aging')
      expect(buttons[0].disabled).toBe(true)
      state.folios = state.folios.map((account) => account.id === 'aging' ? { ...account, reviewedAt: now } : account)
      await act(async () => finish())
      await render()
      expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Holdings unchanged')).toBe(false)
      expect(container.textContent).toContain('Marked fresh')
      expect(container.querySelectorAll('.folio-review-actions')).toHaveLength(4)
    } finally { await act(async () => root.unmount()); clock.mockRestore() }
  })

  it('targets the selected folio for update and reports failed or successful unchanged confirmations', async () => {
    const onRequestImport = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)
    const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === text)!
    try {
      await act(async () => root.render(<ManageHoldings onRequestImport={onRequestImport} reviewOpen={false} onReviewListings={vi.fn()} />))
      await act(async () => button('Update folio').click())
      expect(onRequestImport).toHaveBeenCalledExactlyOnceWith(folio.id)
      state.confirmFolioUnchanged.mockRejectedValueOnce(new Error('Storage full'))
      await act(async () => button('Holdings unchanged').click())
      expect(container.querySelector('[role="alert"]')?.textContent).toBe('Storage full')
      expect(container.textContent).not.toContain('Marked fresh')
      await act(async () => button('Holdings unchanged').click())
      expect(state.confirmFolioUnchanged).toHaveBeenLastCalledWith(folio.id)
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(container.textContent).toContain('Marked fresh')
    } finally { await act(async () => root.unmount()) }
  })

  it('masks account identities and import details while preserving removal and undo targets', async () => {
    state.settings.hideValues = true
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ManageHoldings onRequestImport={vi.fn()} reviewOpen={false} onReviewListings={vi.fn()} />))
      expect(container.innerHTML).not.toContain(folio.name)
      expect(container.textContent).toContain('Import details hidden')
      expect(container.textContent).not.toContain('1 holding')
      expect(container.textContent).not.toContain('inferred or unresolved')
      expect(container.querySelector('.import-health')).toBeNull()
      const remove = container.querySelector<HTMLButtonElement>('.folio-list .btn-remove')!
      expect(remove.getAttribute('aria-label')).toBe('Remove ••••••')
      await act(async () => remove.click())
      expect(container.innerHTML).not.toContain(folio.name)
      await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Delete')!.click())
      expect(state.removeFolio).toHaveBeenCalledExactlyOnceWith(folio.id)
      await act(async () => container.querySelector<HTMLButtonElement>('.undo-import')!.click())
      await act(async () => container.querySelector<HTMLButtonElement>('.undo-import')!.click())
      expect(state.undoLastImport).toHaveBeenCalledOnce()
    } finally { await act(async () => root.unmount()) }
  })

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
