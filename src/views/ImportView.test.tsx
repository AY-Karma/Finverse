// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Folio, LiveQuote, Position } from '../types'
import type { ImportPreview } from '../useStore'
import { normalizePosition } from '../instruments'
import { PRIVATE_VALUE_MASK } from '../privacy'
import { ImportView } from './ImportView'

const state = vi.hoisted(() => ({
  previewFile: vi.fn(), commitImport: vi.fn(), commitImports: vi.fn(),
  folios: [] as Folio[], positions: [] as Position[], liveQuotes: {} as Record<string, LiveQuote>, fxRate: null,
  settings: { currency: 'INR' as const, allowExternalData: false, hideValues: false },
  removeFolio: vi.fn(), undoLastImport: vi.fn(), undoImportFolioId: null, exportPortfolio: vi.fn(),
}))
vi.mock('../useStore', () => ({ useStore: () => state }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const holding = (quantity = 10, lastPrice = 120): Position => normalizePosition({
  id: 'holding', ticker: 'HDFCBANK', name: 'HDFC Bank', type: 'stock', currency: 'INR',
  quantity, buyPrice: 100, lastPrice, invested: quantity * 100,
})
const account = (): Folio => ({
  id: 'account-one', name: 'Main account', importedAt: 1234, positions: [holding()],
  statement: { id: 'statement-one', fileName: 'previous.csv', statementDate: '2020-10-01', completeness: 'complete' },
})
const preview = (overrides: Partial<ImportPreview> = {}): ImportPreview => ({
  id: 'preview', fileName: 'holdings.csv', positions: [holding(8, 130)],
  duplicateCount: 0, unmatchedCount: 0, rejectedCount: 0, issues: [], createdAt: Date.now(), ...overrides,
})
const roots: Root[] = []

beforeEach(() => {
  vi.resetAllMocks()
  state.folios = []
  state.positions = []
  state.liveQuotes = {}
  state.settings = { currency: 'INR', allowExternalData: false, hideValues: false }
  state.commitImport.mockResolvedValue(true)
  state.commitImports.mockResolvedValue(true)
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
})

async function renderImport(onImported?: () => void) {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(<ImportView compact onImported={onImported} />))
  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!
  const field = (label: string) => [...container.querySelectorAll('label')].find((item) => item.textContent?.startsWith(label))!.querySelector('input,select') as HTMLInputElement | HTMLSelectElement
  async function change(label: string, value: string) {
    const element = field(label)
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event(element instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true }))
    })
  }
  async function upload(files = [new File(['Ticker'], 'holdings.csv')]) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: files })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  }
  async function replace(date = '2020-10-02') {
    await change('Import operation', 'replace')
    await change('Target account', 'account-one')
    if (date) await change('Statement date', date)
    await act(async () => field('This is a complete account statement').click())
  }
  return { container, root, button, field, change, upload, replace }
}

describe('statement import review', () => {
  it('shows rejected rows and permits accepted holdings only as another account', async () => {
    const parsed = preview({ rejectedCount: 1, issues: [{ sheet: 'Sheet1', row: 3, field: 'Cost', message: 'Enter a numeric cost.' }] })
    state.folios = [account()]
    state.previewFile.mockResolvedValue(parsed)
    const view = await renderImport()
    await view.upload()
    expect(view.container.textContent).toContain('1 row rejected')
    expect(view.container.textContent).toContain('Sheet1, row 3, Cost: Enter a numeric cost.')
    expect(state.commitImport).not.toHaveBeenCalled()
    await view.change('Import operation', 'replace')
    await view.change('Target account', 'account-one')
    expect(view.button('Update account').disabled).toBe(true)
    expect(view.field('This is a complete account statement').disabled).toBe(true)
    await view.change('Import operation', 'add')
    await act(async () => view.button('Add accepted holdings').click())
    expect(state.commitImport).toHaveBeenCalledExactlyOnceWith(parsed, expect.objectContaining({ operation: 'add', complete: false, statementDate: null }))
  })

  it('previews an exact 10 to 8 share replacement, including removed holdings and resulting totals', async () => {
    const current = account()
    current.positions.push(normalizePosition({ id: 'sold', ticker: 'SOLD', name: 'Sold holding', type: 'stock', currency: 'INR', quantity: 2, buyPrice: 100, lastPrice: 120, invested: 200 }))
    state.folios = [current]
    state.liveQuotes = { [holding().instrumentKey!]: { price: 9999, at: Date.now(), source: 'yahoo' } }
    const parsed = preview()
    state.previewFile.mockResolvedValue(parsed)
    const onImported = vi.fn()
    const view = await renderImport(onImported)
    await view.upload()
    await view.change('Import operation', 'replace')
    await view.change('Target account', 'account-one')
    expect(view.button('Update account').disabled).toBe(true)
    await view.change('Statement date', '2020-10-02')
    await act(async () => view.field('This is a complete account statement').click())
    expect(view.container.textContent).toContain('Target account: Main account')
    expect(view.container.textContent).toContain('Quantity 10 → 8')
    expect(view.container.textContent).toContain('Removed · SOLD')
    expect(view.container.querySelector('[aria-label="Account holding changes"]')?.textContent).toBe('0holdings added1holdings removed1holdings changed')
    expect(view.container.querySelector('[aria-label="Resulting portfolio totals"]')?.textContent).toContain('₹800')
    expect(view.container.querySelector('[aria-label="Resulting portfolio totals"]')?.textContent).toContain('₹1,040')
    expect(state.folios[0].positions[0].quantity).toBe(10)
    await act(async () => view.button('Update account').click())
    expect(state.commitImport).toHaveBeenCalledExactlyOnceWith(parsed, expect.objectContaining({ operation: 'replace', accountId: 'account-one', statementDate: '2020-10-02', complete: true, expectedStatementId: 'statement-one' }))
    expect(onImported).toHaveBeenCalledOnce()
    expect(view.container.querySelector('.import-preview')).toBeNull()
  })

  it.each(['false', 'throw'])('retains the review and callback when persistence returns %s', async (failure) => {
    state.previewFile.mockResolvedValue(preview())
    if (failure === 'false') state.commitImport.mockResolvedValue(false)
    else state.commitImport.mockRejectedValue(new Error('Browser storage is full.'))
    const onImported = vi.fn()
    const view = await renderImport(onImported)
    await view.upload()
    await act(async () => view.button('Add to portfolio').click())
    expect(view.container.querySelector('.import-preview')).not.toBeNull()
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(failure === 'false' ? 'could not be saved' : 'storage is full')
    expect(onImported).not.toHaveBeenCalled()
  })

  it('reviews every removal and zero totals for an empty complete update, then awaits its save', async () => {
    const current = account()
    current.positions.push(normalizePosition({ ...holding(), id: 'sold', ticker: 'SOLD', name: 'Sold holding', providerSymbol: 'SOLD.NS' }))
    state.folios = [current]
    const parsed = preview({ positions: [] })
    state.previewFile.mockResolvedValue(parsed)
    let finish!: (saved: boolean) => void
    state.commitImport.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve }))
    const onImported = vi.fn()
    const view = await renderImport(onImported)
    await view.upload()
    expect(view.container.textContent).toContain('This statement contains no holdings')
    expect(view.button('Add to portfolio').disabled).toBe(true)
    await act(async () => view.button('Add to portfolio').click())
    expect(state.commitImport).not.toHaveBeenCalled()
    await view.change('Import operation', 'replace')
    expect(view.button('Update account').disabled).toBe(true)
    await view.change('Target account', 'account-one')
    await view.change('Statement date', '2020-10-02')
    expect(view.button('Update account').disabled).toBe(true)
    await act(async () => view.field('This is a complete account statement').click())
    expect(view.container.querySelector('[aria-label="Account holding changes"]')?.textContent).toBe('0holdings added2holdings removed0holdings changed')
    expect(view.container.textContent).toContain('Removed · HDFCBANK')
    expect(view.container.textContent).toContain('Removed · SOLD')
    expect(view.container.querySelector('[aria-label="Resulting portfolio totals"]')?.textContent).toBe('0resulting holdings₹0.00resulting cost₹0.00resulting portfolio value')
    expect(state.folios[0].positions).toHaveLength(2)
    expect(state.commitImport).not.toHaveBeenCalled()
    await act(async () => view.button('Update account').click())
    expect(state.commitImport).toHaveBeenCalledExactlyOnceWith(parsed, expect.objectContaining({ operation: 'replace', accountId: 'account-one', complete: true, statementDate: '2020-10-02', expectedStatementId: 'statement-one' }))
    expect(onImported).not.toHaveBeenCalled()
    expect(view.button('Saving import…').disabled).toBe(true)
    await act(async () => finish(true))
    expect(onImported).toHaveBeenCalledOnce()
    expect(view.container.querySelector('.import-preview')).toBeNull()
  })

  it('awaits one save and prevents repeated confirmation while saving', async () => {
    let finish!: (saved: boolean) => void
    state.commitImport.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve }))
    state.previewFile.mockResolvedValue(preview())
    const onImported = vi.fn()
    const view = await renderImport(onImported)
    await view.upload()
    const confirm = view.button('Add to portfolio')
    await act(async () => { confirm.click(); confirm.click() })
    expect(state.commitImport).toHaveBeenCalledOnce()
    expect(view.button('Saving import…').disabled).toBe(true)
    expect(onImported).not.toHaveBeenCalled()
    await act(async () => finish(true))
    expect(onImported).toHaveBeenCalledOnce()
  })

  it('requires explicit latest-statement acknowledgement for missing dates and blocks older or stale targets', async () => {
    state.folios = [account()]
    state.previewFile.mockResolvedValue(preview())
    const view = await renderImport()
    await view.upload()
    await view.replace('')
    expect(view.button('Update account').disabled).toBe(true)
    await act(async () => view.field('I have verified this is the latest statement').click())
    expect(view.button('Update account').disabled).toBe(false)
    await view.change('Statement date', '2020-09-30')
    expect(view.button('Update account').disabled).toBe(true)
    expect(view.container.textContent).toContain('older than')
    await view.change('Statement date', '2020-10-02')
    expect(view.button('Update account').disabled).toBe(false)
    state.folios = [{ ...account(), statement: { ...account().statement!, id: 'changed-statement' } }]
    await act(async () => view.root.render(<ImportView compact />))
    expect(view.button('Update account').disabled).toBe(true)
    expect(view.container.textContent).toContain('changed after the preview')
    expect(state.commitImport).not.toHaveBeenCalled()
  })

  it('requires the same acknowledgement for a legacy account even with an incoming date', async () => {
    const legacy = account()
    delete legacy.statement
    state.folios = [legacy]
    state.previewFile.mockResolvedValue(preview())
    const view = await renderImport()
    await view.upload()
    await view.replace()
    expect(view.button('Update account').disabled).toBe(true)
    await act(async () => view.field('I have verified this is the latest statement').click())
    expect(view.button('Update account').disabled).toBe(false)
    await act(async () => view.button('Update account').click())
    expect(state.commitImport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expectedStatementId: 'legacy:account-one', allowUndatedReplacement: true }))
  })

  it('saves multiple new accounts as one batch and refuses a multiple-file replacement', async () => {
    const parsed = [preview({ id: 'one', fileName: 'one.csv' }), preview({ id: 'two', fileName: 'two.csv' })]
    state.folios = [account()]
    state.previewFile.mockResolvedValueOnce(parsed[0]).mockResolvedValueOnce(parsed[1])
    const view = await renderImport()
    await view.upload([new File(['Ticker'], 'one.csv'), new File(['Ticker'], 'two.csv')])
    expect(view.container.textContent).toContain('This date applies to every selected file')
    await view.change('Import operation', 'replace')
    expect(view.button('Update account').disabled).toBe(true)
    expect(view.container.textContent).toContain('Choose one complete statement')
    await view.change('Import operation', 'add')
    await view.change('Statement date', '2020-10-02')
    await act(async () => view.button('Add 2 accounts').click())
    expect(state.commitImports).toHaveBeenCalledExactlyOnceWith(parsed, expect.objectContaining({ operation: 'add', statementDate: '2020-10-02', accountAlias: undefined }))
    expect(state.commitImport).not.toHaveBeenCalled()
  })

  it('masks financial values, preserves inferred metadata, and cancels without saving', async () => {
    state.folios = [account()]
    state.settings.hideValues = true
    state.liveQuotes = { [holding().instrumentKey!]: { price: 9999, at: Date.now(), source: 'yahoo' } }
    state.previewFile.mockResolvedValue(preview())
    const view = await renderImport()
    await view.upload()
    await view.replace()
    expect(view.container.textContent).toContain('exchange inferred')
    expect(view.container.textContent).toContain(PRIVATE_VALUE_MASK)
    expect(view.container.textContent).not.toContain('Quantity 10')
    expect(view.container.textContent).not.toContain('₹1,040')
    expect(view.container.textContent).toContain('External data is off')
    await act(async () => view.button('Cancel').click())
    expect(view.container.querySelector('.import-preview')).toBeNull()
    expect(state.commitImport).not.toHaveBeenCalled()
    expect(state.commitImports).not.toHaveBeenCalled()
    expect(state.folios[0].positions[0].quantity).toBe(10)
  })
})
