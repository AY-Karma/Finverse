import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StoreProvider } from './useStore'
import { ErrorBoundary } from './ErrorBoundary'
import { entryRoute } from './entryRoute'
import { recoverWorkspaceWrite } from './workspaceArchive'
import { migrateWorkspaceIdentities } from './identityMigration'
import { WorkspaceRestorePanel } from './views/WorkspaceRestore'
import './design.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)
async function renderWorkspace() {
  const recovery = await recoverWorkspaceWrite()
  const migration = recovery.error ? { error: recovery.error } : await migrateWorkspaceIdentities()
  const route = entryRoute(window.location.pathname, window.location.search)
  if (route.redirectTo) window.history.replaceState({}, '', route.redirectTo)

  root.render(migration.error ?
    <main className="panel" role="alert">
      <h1>Workspace recovery needs attention</h1>
      <p>{migration.error}</p>
      <p>Your original records remain in browser storage or its recovery journal. Free some browser storage or allow local storage, then retry.</p>
      <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>Retry recovery</button>
      <p>You can also restore a valid workspace backup below. A pending recovery journal must be recovered before replacement can proceed.</p>
      <WorkspaceRestorePanel accountCount={null} />
    </main> :
    <React.StrictMode>
      <ErrorBoundary>
        <StoreProvider><App initialView={route.view} /></StoreProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
void renderWorkspace()
