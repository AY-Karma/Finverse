import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StoreProvider } from './useStore'
import { ErrorBoundary } from './ErrorBoundary'
import { entryRoute } from './entryRoute'
import './design.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)
const route = entryRoute(window.location.pathname, window.location.search)
if (route.redirectTo) {
  window.history.replaceState({}, '', route.redirectTo)
}

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <App initialView={route.view} />
      </StoreProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
