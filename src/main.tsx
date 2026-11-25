import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StoreProvider } from './useStore'
import { ErrorBoundary } from './ErrorBoundary'
import { NotFound } from './NotFound'
import { entryRoute } from './entryRoute'
import { recoverWorkspaceWrite } from './workspaceArchive'
import { migrateWorkspaceIdentities } from './identityMigration'
import { WorkspaceRestorePanel } from './views/WorkspaceRestore'
import { loadSampleWorkspace, SAMPLE_WORKSPACE_ENABLED } from './sampleWorkspace'
import { SampleWorkspaceBar } from './views/SampleWorkspaceBar'
import { loadView } from './viewModules'
import { isFirstVisit, markLandingSeen } from './landingVisit'
import './fonts.css'
import './design.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)
async function renderWorkspace() {
  const route = entryRoute(window.location.pathname, window.location.search, isFirstVisit())
  if (route.landing) {
    const { LandingPage } = await import('./landing/LandingPage')
    markLandingSeen()
    root.render(<React.StrictMode><LandingPage /></React.StrictMode>)
    return
  }
  if (route.notFound) {
    root.render(<NotFound />)
    return
  }
  if (route.redirectTo) window.history.replaceState({}, '', route.redirectTo)
  if (SAMPLE_WORKSPACE_ENABLED) {
    const params = new URLSearchParams(window.location.search)
    if (params.has('sample')) {
      if (!loadSampleWorkspace()) {
        try { sessionStorage.setItem('finverse:sample-notice', 'This browser already holds your workspace, so the sample was not loaded. Open this link in a private window.') } catch { /* the notice is optional */ }
      }
      params.delete('sample')
      window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
    }
  }

  // The first screen renders only once its code is ready; a failed load is retried from the screen itself.
  await loadView(route.view).catch(() => {})
  const recovery = await recoverWorkspaceWrite()
  const migration = recovery.error ? { error: recovery.error } : await migrateWorkspaceIdentities()
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
        {SAMPLE_WORKSPACE_ENABLED && <SampleWorkspaceBar />}
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
void renderWorkspace()
