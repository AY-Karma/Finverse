// @vitest-environment jsdom
import { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioImportDialog } from './PortfolioImportDialog'

const imports = vi.hoisted(() => {
  let finishLoading!: () => void
  const ready = new Promise<void>((resolve) => { finishLoading = resolve })
  return { loaded: vi.fn(), mounted: vi.fn(), unmounted: vi.fn(), ready, finishLoading }
})
vi.mock('./ImportView', async () => {
  imports.loaded()
  await imports.ready
  return {
    ImportView: ({ initialStep, onImported }: { initialStep: string; onImported: () => void }) => {
      const [step, setStep] = useState(initialStep)
      useEffect(() => {
        imports.mounted()
        return () => { imports.unmounted() }
      }, [])
      return <section aria-label="Import screen"><output>{step}</output><button type="button" onClick={() => setStep('files')}>Local files</button><button type="button" onClick={onImported}>Complete import</button></section>
    },
  }
})
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
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

describe('portfolio import dialog', () => {
  it('defers the import screen, keeps focus during loading, and preserves an unfinished import when reopened', async () => {
    function Workspace() {
      const [open, setOpen] = useState(false)
      return <><button type="button" onClick={() => setOpen(true)}>Import portfolio</button><PortfolioImportDialog open={open} onClose={() => setOpen(false)} /></>
    }
    await act(async () => root.render(<Workspace />))
    const trigger = container.querySelector<HTMLButtonElement>('button')!
    const dialog = container.querySelector('dialog')!
    const close = container.querySelector<HTMLButtonElement>('[aria-label="Close portfolio import"]')!
    expect(imports.loaded).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="Import screen"]')).toBeNull()
    expect(dialog.open).toBe(false)

    trigger.focus()
    await act(async () => trigger.click())
    expect(dialog.open).toBe(true)
    expect(document.activeElement).toBe(close)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading import...')
    imports.finishLoading()
    await act(async () => vi.dynamicImportSettled())
    expect(imports.loaded).toHaveBeenCalledOnce()
    expect(imports.mounted).toHaveBeenCalledOnce()
    expect(dialog.open).toBe(true)
    expect(document.activeElement).toBe(close)
    expect(container.querySelector('output')?.textContent).toBe('sources')
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Local files')!.click())
    expect(container.querySelector('output')?.textContent).toBe('files')

    await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
    expect(imports.unmounted).not.toHaveBeenCalled()
    expect(container.querySelector('output')?.textContent).toBe('files')

    await act(async () => trigger.click())
    expect(container.querySelector('dialog')).toBe(dialog)
    expect(imports.loaded).toHaveBeenCalledOnce()
    expect(imports.mounted).toHaveBeenCalledOnce()
    expect(container.querySelector('output')?.textContent).toBe('files')
    expect(document.activeElement).toBe(close)
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Complete import')!.click())
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps a failed load inside the dialog and retries after reopening', async () => {
    vi.doMock('./ImportView', () => { throw new Error('Import chunk unavailable') })
    const onClose = vi.fn()
    await act(async () => root.render(<PortfolioImportDialog open onClose={onClose} />))
    await act(async () => vi.dynamicImportSettled())
    const dialog = container.querySelector('dialog')!
    const close = container.querySelector<HTMLButtonElement>('[aria-label="Close portfolio import"]')!
    expect(dialog.open).toBe(true)
    expect(document.activeElement).toBe(close)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Close and reopen to try again')
    await act(async () => close.click())
    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => root.render(<PortfolioImportDialog open={false} onClose={onClose} />))
    vi.doMock('./ImportView', () => ({ ImportView: () => <section aria-label="Import screen" /> }))
    await act(async () => root.render(<PortfolioImportDialog open onClose={onClose} />))
    await act(async () => vi.dynamicImportSettled())
    expect(container.querySelector('dialog')).toBe(dialog)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[aria-label="Import screen"]')).not.toBeNull()
    expect(document.activeElement).toBe(close)
  })
})
