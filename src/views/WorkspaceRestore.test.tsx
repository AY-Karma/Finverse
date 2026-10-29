// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRestore, WorkspaceRestorePanel } from './WorkspaceRestore'
import { parseWorkspaceArchive, restoreWorkspaceArchive } from '../workspaceArchive'
import { useStore } from '../useStore'

vi.mock('../useStore', () => ({ useStore: vi.fn() }))
vi.mock('../workspaceArchive', () => ({
  MAX_WORKSPACE_ARCHIVE_BYTES: 20 * 1024 * 1024,
  captureWorkspaceRecords: () => ({}), hasWorkspaceRecovery: () => false,
  parseWorkspaceArchive: vi.fn(), restoreWorkspaceArchive: vi.fn(), restorePreviousWorkspace: vi.fn(),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useStore).mockReturnValue({ folios: [{ id: 'existing' }] } as ReturnType<typeof useStore>)
})

describe('workspace restore review', () => {
  it('keeps restore review outside the compact action target', async () => {
    const archive = { folios: [], snapshots: [], monitor: { rules: [], events: [], alerts: [] } }
    vi.mocked(parseWorkspaceArchive).mockReturnValue({ archive, legacy: false, warnings: [] } as unknown as ReturnType<typeof parseWorkspaceArchive>)
    const target = document.createElement('div')
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<WorkspaceRestore actionsTarget={target} />))
      expect(target.textContent).toContain('Restore backup')
      const file = new File(['{}'], 'backup.json')
      Object.defineProperty(file, 'text', { value: async () => '{}' })
      const input = container.querySelector<HTMLInputElement>('input')!
      Object.defineProperty(input, 'files', { value: [file] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      expect(container.querySelector('[aria-label="Review workspace restore"]')).not.toBeNull()
      expect(target.querySelector('[aria-label="Review workspace restore"]')).toBeNull()
      expect(target.textContent).not.toContain('Replace workspace')
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps the workspace unchanged until confirmation and preserves the preview after a save failure', async () => {
    const archive = { folios: [{ positions: [{}] }], snapshots: [{}], monitor: { rules: [], events: [], alerts: [] } }
    vi.mocked(parseWorkspaceArchive).mockReturnValue({ archive, legacy: true, warnings: ['Legacy backup contains holdings only.'] } as unknown as ReturnType<typeof parseWorkspaceArchive>)
    vi.mocked(restoreWorkspaceArchive).mockRejectedValue(new Error('Workspace changed in another tab. Review the backup again.'))
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<WorkspaceRestore />))
      const file = new File(['{}'], 'backup.json')
      Object.defineProperty(file, 'text', { value: async () => '{}' })
      const input = container.querySelector<HTMLInputElement>('input')!
      Object.defineProperty(input, 'files', { value: [file] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      expect(container.textContent).toContain('Legacy backup contains holdings only.')
      expect(container.textContent).toContain('External market data will be off.')
      expect(restoreWorkspaceArchive).not.toHaveBeenCalled()
      const replace = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Replace workspace')!
      await act(async () => replace.click())
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('another tab')
      expect(container.querySelector('[aria-label="Review workspace restore"]')).not.toBeNull()
      await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Cancel restore')!.click())
      expect(container.querySelector('[aria-label="Review workspace restore"]')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it('offers guarded backup replacement when the saved workspace cannot initialize StoreProvider', async () => {
    vi.mocked(useStore).mockImplementation(() => { throw new Error('StoreProvider is unavailable') })
    const archive = { folios: [{ positions: [{}, {}] }], snapshots: [], monitor: { rules: [], events: [], alerts: [] } }
    vi.mocked(parseWorkspaceArchive).mockReturnValue({ archive, legacy: false, warnings: [] } as unknown as ReturnType<typeof parseWorkspaceArchive>)
    vi.mocked(restoreWorkspaceArchive).mockRejectedValue(new Error('A workspace recovery is pending. Reload to recover it before making another change.'))
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<WorkspaceRestorePanel accountCount={null} />))
      const file = new File(['{}'], 'valid-backup.json')
      Object.defineProperty(file, 'text', { value: async () => '{}' })
      const input = container.querySelector<HTMLInputElement>('input')!
      Object.defineProperty(input, 'files', { value: [file] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      expect(useStore).not.toHaveBeenCalled()
      expect(container.textContent).toContain('Your current saved workspace could not be read.')
      expect(container.querySelector('[aria-label="Review workspace restore"]')).not.toBeNull()
      expect(restoreWorkspaceArchive).not.toHaveBeenCalled()
      await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Replace workspace')!.click())
      expect(restoreWorkspaceArchive).toHaveBeenCalledWith(archive, {})
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('recovery is pending')
      expect(container.querySelector('[aria-label="Review workspace restore"]')).not.toBeNull()
    } finally { await act(async () => root.unmount()) }
  })
})
