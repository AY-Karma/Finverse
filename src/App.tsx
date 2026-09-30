import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { Position } from './types'
import type { View } from './useStore'
import { useStore } from './useStore'
import { applyTheme } from './theme'
import { entryRoute, pathForView } from './entryRoute'
import { Overview } from './views/Overview'
import { PortfolioImportDialog } from './views/PortfolioImportDialog'

const loadHoldingsView = () => import('./views/HoldingsView')
const loadResearchView = () => import('./views/ResearchView')
const loadAssistantView = () => import('./views/AssistantView')
const loadSettingsView = () => import('./views/SettingsView')
const loadInsightsView = () => import('./views/InsightsView')

const HoldingsView = lazy(() => loadHoldingsView().then((module) => ({ default: module.HoldingsView })))
const ResearchView = lazy(() => loadResearchView().then((module) => ({ default: module.ResearchView })))
const AssistantView = lazy(() => loadAssistantView().then((module) => ({ default: module.AssistantView })))
const SettingsView = lazy(() => loadSettingsView().then((module) => ({ default: module.SettingsView })))
const InsightsView = lazy(() => loadInsightsView().then((module) => ({ default: module.InsightsView })))

const NAV: { id: View; label: string; index: string }[] = [
  { id: 'overview', label: 'Overview', index: '01' },
  { id: 'holdings', label: 'Monitor', index: '02' },
  { id: 'insights', label: 'Insights', index: '03' },
  { id: 'research', label: 'Research', index: '04' },
  { id: 'settings', label: 'Settings', index: '05' },
]

export default function App({ initialView }: { initialView: View }) {
  const [view, setView] = useState<View>(initialView)
  const [importOpen, setImportOpen] = useState(false)
  const [researchVisited, setResearchVisited] = useState(initialView === 'research')
  const [assistantDraft, setAssistantDraft] = useState('')
  const [monitorQuery, setMonitorQuery] = useState('')
  const [researchReturn, setResearchReturn] = useState(false)
  const researchUrl = useRef(initialView === 'research' ? window.location.pathname + window.location.search : '/app/research')
  const rememberResearchUrl = useCallback((url: string) => { researchUrl.current = url }, [])
  const { positions, settings, quickMode } = useStore()

  const navigate = useCallback((nextView: View) => {
    if (window.location.pathname === '/app/research') researchUrl.current = window.location.pathname + window.location.search
    const nextPath = nextView === 'research' ? researchUrl.current : pathForView(nextView)
    if (window.location.pathname + window.location.search !== nextPath) window.history.pushState({}, '', nextPath)
    if (nextView === 'research') setResearchVisited(true)
    if (nextView === 'holdings') setMonitorQuery('')
    if (nextView === 'assistant') setAssistantDraft('')
    setResearchReturn(false)
    setView(nextView)
  }, [])

  const openFromResearch = (nextView: View, position?: Position) => {
    navigate(nextView)
    if (nextView === 'assistant') setAssistantDraft(position ? `Help me review ${position.name || position.ticker} (${position.ticker}${position.exchange ? `, ${position.exchange}` : ''}). What evidence should I check, what is missing, and what would challenge the reason to own it?` : '')
    if (nextView === 'holdings') setMonitorQuery(position?.name || position?.ticker || '')
    setResearchReturn(true)
  }

  const requestPortfolioImport = () => {
    navigate('overview')
    setImportOpen(true)
  }

  useEffect(() => {
    const onPopState = () => {
      const route = entryRoute(window.location.pathname, window.location.search)
      if (route.page === 'landing') {
        window.location.reload()
        return
      }
      if (route.redirectTo) window.history.replaceState({}, '', route.redirectTo)
      if (route.view === 'research') setResearchVisited(true)
      setView(route.view)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Reflect theme + density across the whole app as soon as it loads or changes.
  useEffect(() => {
    applyTheme({
      accent: settings.accent,
      density: settings.density,
      mode: settings.mode,
      customAccent: settings.customAccent,
    })
  }, [settings.accent, settings.density, settings.mode, settings.customAccent])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand brand--home" type="button" onClick={() => navigate('overview')} aria-label="Go to Overview">
          <div className="brand-mark">₹</div>
          <div>
            <div className="brand-name">Finverse</div>
            <div className="brand-sub">Portfolio workspace</div>
          </div>
        </button>

        <nav className="nav">
          <span className="nav-label">Workspace</span>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item${view === item.id || (view === 'assistant' && item.id === 'research') ? ' nav-item--active' : ''}`}
              aria-current={view === item.id || (view === 'assistant' && item.id === 'research') ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-item-label">
                {item.label}
                {item.id === 'research' && quickMode && (
                  <span className="nav-quick-dot" aria-label="Quick mode on" title="Quick mode is on" />
                )}
              </span>
              <span className="nav-index">{item.index}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="hint">
            {positions.length > 0
              ? `${positions.length} position${positions.length === 1 ? '' : 's'} tracked`
              : 'No portfolio loaded'}
          </span>
        </div>
      </aside>

      <main className="main">
        {researchReturn && view !== 'research' && view !== 'assistant' && <button className="btn btn--ghost btn--small" type="button" onClick={() => navigate('research')}>← Back to Research</button>}
        {view === 'overview' && <Overview onGoTo={navigate} onRequestImport={requestPortfolioImport} />}
        {researchVisited && <div hidden={view !== 'research'}><Suspense fallback={<div className="view-loading">Loading research...</div>}><ResearchView active={view === 'research'} onUrlChange={rememberResearchUrl} onOpenAssistant={(position) => openFromResearch('assistant', position)} onGoTo={openFromResearch} onRequestImport={requestPortfolioImport} /></Suspense></div>}
        {view !== 'overview' && (
          <Suspense fallback={<div className="view-loading">Loading workspace…</div>}>
            {view === 'holdings' && <HoldingsView initialQuery={monitorQuery} onRequestImport={requestPortfolioImport} />}
            {view === 'insights' && <InsightsView onRequestImport={requestPortfolioImport} />}
            {view === 'assistant' && <AssistantView initialDraft={assistantDraft} onGoTo={navigate} onRequestImport={requestPortfolioImport} />}
            {view === 'settings' && <SettingsView />}
          </Suspense>
        )}
      </main>
      <PortfolioImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}
