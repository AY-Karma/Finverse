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
  it('groups mutual-fund schemes directly below instrument listings with the same disclosure styling', async () => {
    state.positions = [position, { ...position, id: 'fund', type: 'mutual-fund' }]
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ManageHoldings onRequestImport={vi.fn()} reviewOpen={false} onReviewListings={vi.fn()} />))
      const listings = container.querySelector('#listing-review-trigger')!.parentElement!
      const schemes = listings.nextElementSibling!
      expect(schemes.matches('details.fund-review.listing-review')).toBe(true)
      expect(schemes.querySelector('summary.listing-review-trigger .listing-review-copy strong')!.textContent).toBe('Mutual-fund schemes')
      expect(schemes.querySelector('.listing-review-action')!.textContent).toBe('Review schemes')
    } finally { await act(async () => root.unmount()) }
  })

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
      expect(container.querySelector('.folio-facts')).toBeNull()
      expect(container.querySelector('.listing-review-copy')?.textContent).toContain('Listing details are hidden.')
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
      expect(rows.map((row) => row.querySelector('.import-health-label')?.textContent)).toEqual(['Recent import', 'Review soon', 'Update suggested'])
      expect(rows.every((row) => row.querySelector('.dither-bar') !== null)).toBe(true)
      const importButton = [...container.querySelectorAll<HTMLButtonElement>('.manage-actions button')].find((button) => button.textContent === 'Import holdings')!
      expect(importButton.disabled).toBe(false)
      await act(async () => importButton.click())
      expect(onRequestImport).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      clock.mockRestore()
    }
  })

  it('separates statement facts from the filename and actions', async () => {
    const importedAt = Date.parse('2026-10-10T12:00:00Z')
    const reviewedAt = Date.parse('2026-10-20T12:00:00Z')
    state.folios = [{ ...folio, importedAt, reviewedAt }]
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ManageHoldings onRequestImport={vi.fn()} reviewOpen={false} onReviewListings={vi.fn()} />))
      expect(container.querySelector('.imported-statements > h3')?.textContent).toBe('Imported statements')
      expect(container.querySelector('.folio-title > .sym')?.textContent).toBe(folio.name)
      const facts = Object.fromEntries([...container.querySelectorAll('.folio-facts > div')].map((item) => [item.querySelector('dt')?.textContent, item.querySelector('dd')?.textContent]))
      expect(facts.Holdings).toBe('1')
      expect(facts.Statement).toBeUndefined()
      expect(container.textContent).not.toContain('Date not provided')
      expect(facts.Imported).toMatch(/10.*Oct.*2026/)
      expect(facts.Reviewed).toMatch(/20.*Oct.*2026/)
      state.folios = [{ ...state.folios[0], statement: { id: 'dated', fileName: folio.name, statementDate: '2026-10-01', completeness: 'complete' } }]
      await act(async () => root.render(<ManageHoldings onRequestImport={vi.fn()} reviewOpen={false} onReviewListings={vi.fn()} />))
      const datedFacts = [...container.querySelectorAll('.folio-facts > div')].find((item) => item.querySelector('dt')?.textContent === 'Statement')
      expect(datedFacts?.querySelector('dd')?.textContent).toMatch(/1.*Oct.*2026/)
    } finally { await act(async () => root.unmount()) }
  })

  it('distinguishes pending review from ready listings and connects the disclosure', async () => {
    const onReviewListings = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)
    const render = () => act(async () => root.render(<ManageHoldings onRequestImport={vi.fn()} reviewOpen={false} onReviewListings={onReviewListings} />))
    try {
      await render()
      const trigger = container.querySelector<HTMLButtonElement>('#listing-review-trigger')!
      expect(trigger.textContent).toContain('1 listing needs your confirmation.')
      expect(trigger.querySelector('.listing-review-action')?.textContent).toBe('Review listings')
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      const content = container.querySelector<HTMLElement>(`#${trigger.getAttribute('aria-controls')}`)!
      expect(content.hidden).toBe(true)
      expect(container.querySelector('#instrument-review')).toBeNull()
      await act(async () => trigger.click())
      expect(onReviewListings).toHaveBeenCalledOnce()

      state.positions = [{ ...position, exchangeSource: 'explicit' }]
      await render()
      expect(trigger.textContent).toContain('No listings need review.')
      expect(trigger.querySelector('.listing-review-action')?.textContent).toBe('View listings')
      expect(trigger.textContent).not.toContain('0 inferred')

      state.settings.hideValues = true
      await render()
      expect(trigger.textContent).toContain('Listing details are hidden.')
      expect(trigger.textContent).not.toContain('No listings need review')
    } finally { await act(async () => root.unmount()) }
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
      const toggle = container.querySelector<HTMLButtonElement>('[aria-label="More holdings actions"]')!
      const actions = container.querySelector<HTMLElement>('.manage-actions-reveal')!
      expect(actions.getAttribute('aria-hidden')).toBe('true')
      await act(async () => toggle.click())
      expect(actions.getAttribute('aria-hidden')).toBe('false')
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(actions.textContent).toContain('Restore backup')
      await act(async () => findButton('Export CSV').click())
      await act(async () => findButton('Backup JSON').click())
      expect(state.exportPortfolio.mock.calls).toEqual([['csv'], ['json']])
      await act(async () => findButton('Undo import').click())
      expect(state.undoLastImport).not.toHaveBeenCalled()
      await act(async () => findButton('Confirm undo').click())
      expect(state.undoLastImport).toHaveBeenCalledOnce()
      await act(async () => actions.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(actions.getAttribute('aria-hidden')).toBe('true')
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
      expect(buttons.map((button) => [button.textContent || button.getAttribute('aria-label'), button.disabled])).toEqual([
        ['Import holdings', false], ['More holdings actions', false], ['Export CSV', true], ['Backup JSON', false], ['Undo import', true], ['Restore backup', false],
      ])
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
