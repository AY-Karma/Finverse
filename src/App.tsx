import { lazy, Suspense, useEffect, useState } from 'react'
import type { View } from './useStore'
import { useStore } from './useStore'
import { applyTheme } from './theme'
import { Overview } from './views/Overview'

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

export default function App() {
  const [view, setView] = useState<View>('overview')
  const { positions, settings, quickMode } = useStore()

  // Reflect theme + density across the whole app as soon as it loads or changes.
  useEffect(() => {
    applyTheme({
      accent: settings.accent,
      density: settings.density,
      mode: settings.mode,
      customAccent: settings.customAccent,
    })
  }, [settings.accent, settings.density, settings.mode, settings.customAccent])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([loadHoldingsView(), loadResearchView(), loadAssistantView(), loadSettingsView(), loadInsightsView()])
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand brand--home" type="button" onClick={() => setView('overview')} aria-label="Go to Overview">
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
              onClick={() => setView(item.id)}
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
        {view === 'overview' && <Overview onGoTo={setView} />}
        {view !== 'overview' && (
          <Suspense fallback={<div className="view-loading">Loading workspace…</div>}>
            {view === 'holdings' && <HoldingsView />}
            {view === 'insights' && <InsightsView />}
            {view === 'research' && <ResearchView onOpenAssistant={() => setView('assistant')} />}
            {view === 'assistant' && <AssistantView onGoTo={setView} />}
            {view === 'settings' && <SettingsView />}
          </Suspense>
        )}
      </main>
    </div>
  )
}
