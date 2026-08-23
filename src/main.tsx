import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StoreProvider } from './useStore'
import { ErrorBoundary } from './ErrorBoundary'
import { entryRoute } from './entryRoute'
import './design.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)
const route = entryRoute(window.location.pathname, window.location.search)
if (route.page === 'workspace' && route.redirectTo) {
  window.history.replaceState({}, '', route.redirectTo)
}
const loadLanding = () => import('./landing/LandingPage')
const LandingPage = lazy(() => loadLanding().then((module) => ({ default: module.LandingPage })))

if (route.page === 'landing') {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <LandingPage />
        </Suspense>
      </ErrorBoundary>
    </React.StrictMode>,
  )
} else {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <StoreProvider>
          <App initialView={route.view} />
        </StoreProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
