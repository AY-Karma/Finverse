// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const state = vi.hoisted(() => ({ render: vi.fn(), recover: vi.fn(), migrate: vi.fn() }))
vi.mock('react-dom/client', () => ({ default: { createRoot: () => ({ render: state.render }) } }))
vi.mock('./App', () => ({ default: () => null }))
vi.mock('./useStore', () => ({ StoreProvider: () => null }))
vi.mock('./ErrorBoundary', () => ({ ErrorBoundary: () => null }))
vi.mock('./NotFound', () => ({ NotFound: function NotFound() { return null } }))
vi.mock('./views/WorkspaceRestore', () => ({ WorkspaceRestorePanel: () => null }))
vi.mock('./workspaceArchive', () => ({ recoverWorkspaceWrite: state.recover }))
vi.mock('./identityMigration', () => ({ migrateWorkspaceIdentities: state.migrate }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  state.recover.mockResolvedValue({})
  state.migrate.mockResolvedValue({})
})

it('renders a direct unknown URL as 404 before accessing workspace storage', async () => {
  window.history.replaceState({}, '', '/app/not-a-page?query=missing')
  await import('./main')
  expect(state.render).toHaveBeenCalledOnce()
  const screen = state.render.mock.calls[0][0] as ReactElement
  expect((screen.type as { name: string }).name).toBe('NotFound')
  expect(state.recover).not.toHaveBeenCalled()
  expect(state.migrate).not.toHaveBeenCalled()
  expect(window.location.pathname + window.location.search).toBe('/app/not-a-page?query=missing')
})

it('preserves root redirects and workspace recovery for valid entry', async () => {
  window.history.replaceState({}, '', '/')
  await import('./main')
  await vi.waitFor(() => expect(state.render).toHaveBeenCalledOnce())
  expect(window.location.pathname).toBe('/app')
  expect(state.recover).toHaveBeenCalledOnce()
  expect(state.migrate).toHaveBeenCalledOnce()
})
