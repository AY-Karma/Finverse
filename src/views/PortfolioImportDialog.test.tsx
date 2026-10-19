// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioImportDialog } from './PortfolioImportDialog'

const state = vi.hoisted(() => ({
  folios: [], positions: [], liveQuotes: {}, fxRate: null,
  settings: { currency: 'INR', allowExternalData: false, hideValues: false },
  previewFile: vi.fn(), commitImport: vi.fn(), commitImports: vi.fn(),
}))
vi.mock('../useStore', () => ({ useStore: () => state }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.clearAllMocks()
  state.previewFile.mockResolvedValue({
    id: 'preview', fileName: 'holdings.csv', duplicateCount: 0, unmatchedCount: 0,
    rejectedCount: 0, issues: [], createdAt: Date.now(),
    positions: [{ id: 'tcs', ticker: 'TCS', name: 'TCS', type: 'stock', quantity: 10, buyPrice: 100, lastPrice: 120, invested: 1000 }],
  })
  state.commitImport.mockResolvedValue(true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) {
      this.open = true
      this.querySelector<HTMLButtonElement>('button')?.focus()
    } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.open = false } },
  })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 0 })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

async function upload() {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['Ticker'], 'holdings.csv')] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!

describe('portfolio import dialog', () => {
  it('has every source ready before first open and preserves an unfinished review when reopened', async () => {
    function Workspace() {
      const [open, setOpen] = useState(false)
      return <><button type="button" onClick={() => setOpen(true)}>Import portfolio</button><PortfolioImportDialog open={open} onClose={() => setOpen(false)} /></>
    }
    await act(async () => root.render(<Workspace />))
    const trigger = button('Import portfolio')
    const dialog = container.querySelector('dialog')!
    const close = container.querySelector<HTMLButtonElement>('[aria-label="Close portfolio import"]')!
    expect(dialog.open).toBe(false)
    expect([...container.querySelectorAll('.import-source-card strong')].map((item) => item.textContent)).toEqual(['Zerodha', 'Groww', 'INDmoney', 'Angel One', 'Local files'])
    expect(container.querySelectorAll('.import-source-mark img')).toHaveLength(5)
    expect(container.textContent).not.toContain('Loading import')
    expect(state.previewFile).not.toHaveBeenCalled()

    trigger.focus()
    await act(async () => trigger.click())
    expect(dialog.open).toBe(true)
    expect(document.activeElement).toBe(close)
    await upload()
    expect(container.querySelector('.import-preview')).not.toBeNull()
    expect(state.commitImport).not.toHaveBeenCalled()

    await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
    await act(async () => trigger.click())
    expect(container.querySelector('dialog')).toBe(dialog)
    expect(container.querySelector('.import-preview')).not.toBeNull()
    expect(document.activeElement).toBe(close)
    await act(async () => button('Add to portfolio').click())
    expect(state.commitImport).toHaveBeenCalledOnce()
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps file and save failures inside the dialog without losing the review', async () => {
    const onClose = vi.fn()
    await act(async () => root.render(<PortfolioImportDialog open onClose={onClose} />))
    state.previewFile.mockRejectedValueOnce(new Error('Could not read holdings.'))
    await upload()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not read holdings.')
    expect(onClose).not.toHaveBeenCalled()

    await upload()
    state.commitImport.mockResolvedValue(false)
    await act(async () => button('Add to portfolio').click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be saved')
    expect(container.querySelector('.import-preview')).not.toBeNull()
    expect(container.querySelector('dialog')?.open).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })
})
