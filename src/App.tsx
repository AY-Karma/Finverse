import { Activity, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Position } from './types'
import type { View } from './useStore'
import { useStore } from './useStore'
import { applyTheme } from './theme'
import { entryRoute, pathForView } from './entryRoute'
import { ActionIcon } from './views/ActionIcon'

const loadOverview = () => import('./views/Overview')
const loadMonitorView = () => import('./views/MonitorView')
const loadResearchView = () => import('./views/ResearchView')
const loadSettingsView = () => import('./views/SettingsView')
const loadInsightsView = () => import('./views/InsightsView')

const Overview = lazy(() => loadOverview().then((module) => ({ default: module.Overview })))
const MonitorView = lazy(() => loadMonitorView().then((module) => ({ default: module.MonitorView })))
const ResearchView = lazy(() => loadResearchView().then((module) => ({ default: module.ResearchView })))
const SettingsView = lazy(() => loadSettingsView().then((module) => ({ default: module.SettingsView })))
const InsightsView = lazy(() => loadInsightsView().then((module) => ({ default: module.InsightsView })))
const PortfolioImportDialog = lazy(() => import('./views/PortfolioImportDialog').then((module) => ({ default: module.PortfolioImportDialog })))

const VIEW_LOADERS = { overview: loadOverview, holdings: loadMonitorView, research: loadResearchView, settings: loadSettingsView, insights: loadInsightsView }

function preloadView(view: View) {
  void VIEW_LOADERS[view]().catch(() => { /* Navigation can retry a failed preload. */ })
}

const NAV: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'insights', label: 'Insights' },
  { id: 'holdings', label: 'Monitor' },
  { id: 'research', label: 'Research' },
  { id: 'settings', label: 'Settings' },
]

export default function App({ initialView }: { initialView: View }) {
  const [view, setView] = useState<View>(initialView)
  const [importOpen, setImportOpen] = useState(false)
  const [importVisited, setImportVisited] = useState(false)
  const [importAccountId, setImportAccountId] = useState<string>()
  const [visitedViews, setVisitedViews] = useState(() => new Set<View>([initialView]))
  const [monitorQuery, setMonitorQuery] = useState('')
  const [researchReturn, setResearchReturn] = useState(false)
  const researchUrl = useRef(initialView === 'research' ? window.location.pathname + window.location.search : '/app/research')
  const rememberResearchUrl = useCallback((url: string) => { researchUrl.current = url }, [])
  const { settings } = useStore()

  const navigate = useCallback((nextView: View, anchor?: string) => {
    if (window.location.pathname === '/app/research') researchUrl.current = window.location.pathname + window.location.search
    const nextPath = (nextView === 'research' ? researchUrl.current : pathForView(nextView)) + (anchor ? `#${anchor}` : '')
    if (window.location.pathname + window.location.search + window.location.hash !== nextPath) window.history.pushState({}, '', nextPath)
    setVisitedViews((visited) => visited.has(nextView) ? visited : new Set([...visited, nextView]))
    if (nextView === 'holdings') setMonitorQuery('')
    setResearchReturn(false)
    setView(nextView)
  }, [])

  const openFromResearch = (nextView: View, position?: Position) => {
    navigate(nextView)
    if (nextView === 'holdings') setMonitorQuery(position?.name || position?.ticker || '')
    setResearchReturn(true)
  }

  const openPortfolioImport = (accountId?: string) => {
    setImportAccountId(accountId)
    setImportVisited(true)
    setImportOpen(true)
  }

  const requestPortfolioImport = () => {
    navigate('overview')
    openPortfolioImport()
  }

  useEffect(() => {
    const onPopState = () => {
      const route = entryRoute(window.location.pathname, window.location.search)
      if (route.redirectTo) window.history.replaceState({}, '', route.redirectTo)
      setVisitedViews((visited) => visited.has(route.view) ? visited : new Set([...visited, route.view]))
      setView(route.view)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Reflect theme + density across the whole app as soon as it loads or changes.
  useEffect(() => {
    applyTheme({
      density: settings.density,
      mode: settings.mode,
    })
  }, [settings.density, settings.mode])

  return (
    <AppShell view={view} navigate={navigate}>
      <main className="main">
        {researchReturn && view !== 'research' && <button className="btn btn--ghost btn--small" type="button" onClick={() => navigate('research')}><ActionIcon name="research" />Back to Research</button>}
        {NAV.filter((item) => item.id !== 'settings' && visitedViews.has(item.id)).map((item) => (
          <Activity key={item.id} mode={view === item.id ? 'visible' : 'hidden'}>
            <div className={item.id === 'overview' ? 'overview-sections' : undefined} hidden={view !== item.id}>
              <Suspense fallback={<div className="view-loading" role="status">Loading {item.label.toLowerCase()}…</div>}>
                {item.id === 'overview' && <Overview onGoTo={navigate} onRequestImport={requestPortfolioImport} />}
                {item.id === 'research' && <ResearchView active={view === 'research'} onUrlChange={rememberResearchUrl} onGoTo={openFromResearch} onRequestImport={requestPortfolioImport} />}
                {item.id === 'holdings' && <MonitorView initialQuery={monitorQuery} onRequestImport={requestPortfolioImport} />}
                {item.id === 'insights' && <InsightsView onRequestImport={requestPortfolioImport} />}
              </Suspense>
            </div>
          </Activity>
        ))}
        {view === 'settings' && <Suspense fallback={<div className="view-loading" role="status">Loading settings…</div>}><SettingsView onRequestImport={openPortfolioImport} /></Suspense>}
      </main>
      {importVisited && <Suspense fallback={<div className="view-loading" role="status">Opening import…</div>}><PortfolioImportDialog open={importOpen} accountId={importAccountId} onClose={() => setImportOpen(false)} /></Suspense>}
    </AppShell>
  )
}

function AppShell({ view, navigate, children }: { view: View; navigate: (view: View, anchor?: string) => void; children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { settings, setSettings } = useStore()
  return (
    <div className={`app-shell${sidebarCollapsed ? ' app-shell--collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <button className="brand brand--home" type="button" onClick={() => navigate('overview')} aria-label="Go to Overview">
            <img className="brand-mark" src="/favicon.svg?v=2" alt="" width={30} height={30} />
            <div>
              <div className="brand-name">Finverse</div>
              <div className="brand-sub">Portfolio workspace</div>
            </div>
          </button>
          <button
            type="button"
            className={`icon-btn shell-privacy-toggle${settings.hideValues ? ' icon-btn--active' : ''}`}
            onClick={() => setSettings({ ...settings, hideValues: !settings.hideValues })}
            title={settings.hideValues ? 'Reveal portfolio values' : 'Hide portfolio values'}
            aria-label={settings.hideValues ? 'Reveal portfolio values' : 'Hide portfolio values'}
            aria-pressed={settings.hideValues}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {settings.hideValues ? <><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M14.1 5.6A11.4 11.4 0 0 1 22 12c-.9 1.9-2.5 4.1-4.6 5.6M13.4 17A10.9 10.9 0 0 1 2 12c1.3-2.7 3.6-5.4 7.1-6.7" /><path d="M4 20 20 4" /></> : <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>}
            </svg>
          </button>
        </div>

        <nav className="nav" id="workspace-navigation" aria-label="Workspace">
          <div className="nav-heading">
            <span className="nav-label">Workspace</span>
            <button type="button" className="sidebar-toggle" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!sidebarCollapsed} aria-controls="workspace-navigation">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
            </button>
          </div>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item${view === item.id ? ' nav-item--active' : ''}`}
              aria-current={view === item.id ? 'page' : undefined}
              aria-label={item.label}
              title={sidebarCollapsed ? item.label : undefined}
              onPointerEnter={() => preloadView(item.id)}
              onFocus={() => preloadView(item.id)}
              onTouchStart={() => preloadView(item.id)}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-item-icon"><ActionIcon name={item.id} /></span>
              <span className="nav-item-label">
                {item.label}
              </span>
            </button>
          ))}
        </nav>

      </aside>
      {children}
    </div>
  )
}
